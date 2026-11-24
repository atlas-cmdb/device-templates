#!/usr/bin/env node
// Import device templates from an openDCIM installation.
//
// openDCIM's public template repository is gone, but every openDCIM install has its own template
// library. This reads it either live through the REST API or from template export files
// (Device Templates → Export, one JSON file per template, pictures embedded).
//
//   # live, read-only (API user needs read access)
//   OPENDCIM_USER=me OPENDCIM_APIKEY=... npm run import:opendcim -- --url https://dcim.example.org
//
//   # from exported template files or folders of them
//   npm run import:opendcim -- exports/*.json
//
// Options:
//   --units english|metric   openDCIM stores weight in the site's units (default: english = lbs)
//   --images                 also import front/rear pictures. Only use this for photos you are
//                            allowed to publish: this repository is public domain (CC0)
//   --credit "text"          images.credit for imported pictures
//   --dry-run                report only
//
// Templates already in the library (from NetBox or the community) are matched on manufacturer +
// model and only *enriched*: openDCIM fills fields that are still empty (typical wattage, weight,
// pictures, blade-slot hotspots) and never overwrites existing values.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { convertImage } from './lib/images.mjs';
import { inferCategory } from './lib/infer.mjs';
import { interfaceTypeFrom, passThroughType } from './lib/ports.mjs';
import { KINDS, ROOT, listManufacturers, listTemplates, readYaml, slugify, writeYaml } from './lib/repo.mjs';
import { enrichTemplate, restamp, upsertTemplate } from './lib/upsert.mjs';

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		url: { type: 'string' },
		user: { type: 'string', default: process.env.OPENDCIM_USER },
		'api-key': { type: 'string', default: process.env.OPENDCIM_APIKEY },
		units: { type: 'string', default: 'english' },
		images: { type: 'boolean', default: false },
		credit: { type: 'string' },
		'dry-run': { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false }
	}
});
if (opts.help || (!opts.url && !positionals.length)) {
	console.error('usage: npm run import:opendcim -- --url https://dcim.example.org   |   npm run import:opendcim -- <export.json|folder> ...');
	process.exit(1);
}
if (!['english', 'metric'].includes(opts.units)) {
	console.error('--units must be english or metric');
	process.exit(1);
}

const ORIGIN = 'opendcim';
const today = new Date().toISOString().slice(0, 10);
const stats = { templates: 0, created: 0, updated: 0, unchanged: 0, enriched: 0, kept_local_edits: 0, ambiguous: 0, skipped: 0, images: 0, failed: 0 };
const log = [];

// ---------------------------------------------------------------- reading openDCIM

const baseUrl = opts.url?.replace(/\/+$/, '');
const headers = { accept: 'application/json', 'user-agent': 'atlas-device-templates-importer' };
if (opts.user) headers.UserID = opts.user;
if (opts['api-key']) headers.APIKey = opts['api-key'];

async function api(path) {
	const res = await fetch(`${baseUrl}/api/v1${path}`, { headers });
	const body = await res.json().catch(() => ({}));
	if (res.status === 404 || body.errorcode === 404) return null; // openDCIM uses 404 for "no ports"
	if (!res.ok || body.error) throw new Error(`${path}: HTTP ${res.status} ${body.message ?? ''}`.trim());
	return body;
}

async function fetchPicture(file) {
	if (!file) return null;
	for (const dir of ['assets/pictures', 'pictures']) {
		const res = await fetch(`${baseUrl}/${dir}/${encodeURIComponent(file)}`, { headers: { ...headers, accept: 'image/*' } });
		if (res.ok && /^image\//.test(res.headers.get('content-type') ?? '')) return Buffer.from(await res.arrayBuffer());
	}
	return null;
}

/** Lookup tables used by data ports (names differ per install, so resolve them by id). */
async function lookups() {
	const list = async (path, key, id, name) => Object.fromEntries(((await api(path).catch(() => null))?.[key] ?? []).map((r) => [r[id], r[name]]));
	return {
		connectors: await list('/mediaconnectors', 'mediaconnectors', 'ConnectorID', 'ConnectorType'),
		protocols: await list('/mediaprotocols', 'mediaprotocols', 'ProtocolID', 'ProtocolName'),
		rates: await list('/mediadatarates', 'mediadatarates', 'RateID', 'RateText'),
		colors: await list('/colorcode', 'colorcode', 'ColorID', 'Name')
	};
}

async function* fromApi() {
	const [mfgBody, tables] = await Promise.all([api('/manufacturer'), lookups()]);
	const mfgs = mfgBody?.manufacturer ?? [];
	const mfgName = Object.fromEntries(mfgs.map((m) => [m.ManufacturerID, m.Name]));
	const { devicetemplate: templates = [] } = (await api('/devicetemplate')) ?? {};
	for (const t of templates) {
		const id = t.TemplateID;
		const [dp, pp, sl] = await Promise.all([api(`/devicetemplate/${id}/dataport`), api(`/devicetemplate/${id}/powerport`), api(`/devicetemplate/${id}/slot`)]);
		const ports = (dp?.dataport ?? []).map((p) => ({
			...p,
			MediaType: [tables.connectors[p.ConnectorID], tables.rates[p.RateID], tables.protocols[p.ProtocolID]].filter(Boolean).join(' ') || p.MediaType,
			Name: tables.colors[p.ColorID] ?? p.Name
		}));
		yield {
			...t,
			ManufacturerName: mfgName[t.ManufacturerID] ?? t.ManufacturerName,
			ports,
			powerports: pp?.powerport ?? [],
			slots: sl?.slot ?? [],
			front: opts.images ? await fetchPicture(t.FrontPictureFile) : null,
			rear: opts.images ? await fetchPicture(t.RearPictureFile) : null
		};
	}
}

function* fromFiles(paths) {
	const files = [];
	for (const p of paths.map((p) => resolve(p))) {
		if (!existsSync(p)) {
			console.warn(`! ${p} does not exist`);
			continue;
		}
		if (statSync(p).isDirectory()) for (const f of readdirSync(p)) if (f.toLowerCase().endsWith('.json')) files.push(join(p, f));
		if (statSync(p).isFile()) files.push(p);
	}
	const dataUrl = (v) => {
		const m = typeof v === 'string' && v.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
		return m ? Buffer.from(m[1], 'base64') : null;
	};
	for (const file of files) {
		let t;
		try {
			t = JSON.parse(readFileSync(file, 'utf8'));
		} catch (err) {
			console.warn(`! ${file}: ${err.message}`);
			continue;
		}
		if (!t?.ManufacturerName || !t.Model) {
			console.warn(`! ${file}: not an openDCIM template export`);
			continue;
		}
		yield { ...t, front: opts.images ? dataUrl(t.FrontPictureFile) : null, rear: opts.images ? dataUrl(t.RearPictureFile) : null };
	}
}

// ---------------------------------------------------------------- matching existing templates

const manufacturers = listManufacturers().map(({ slug, file }) => ({ slug, ...readYaml(file) }));
/** Exact slug/name matches first, then manufacturers listing the name as an alias ("HP" → hpe). */
function manufacturerCandidates(name) {
	const needle = String(name).trim().toLowerCase();
	const exact = manufacturers.filter((m) => m.slug === slugify(name) || m.name?.toLowerCase() === needle);
	const alias = manufacturers.filter((m) => !exact.includes(m) && (m.aliases ?? []).some((a) => a.toLowerCase() === needle));
	return [...exact, ...alias].map((m) => m.slug);
}
function manufacturerSlug(name) {
	const [hit] = manufacturerCandidates(name);
	if (hit) return hit;
	const slug = slugify(name);
	const created = { name: String(name).trim(), slug };
	manufacturers.push(created);
	if (!opts['dry-run']) writeYaml(join(ROOT, 'manufacturers', `${slug}.yaml`), created, 'manufacturer.schema.json');
	return slug;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const existing = new Map();
const byManufacturer = new Map(); // mfr -> [{ key, t }] for variant detection
for (const t of listTemplates('device')) {
	if (!existsSync(t.file)) continue;
	const d = readYaml(t.file);
	for (const key of [d.model, d.slug, ...(d.aliases ?? []), ...(d.part_numbers ?? [])]) {
		const k = `${t.manufacturer}|${norm(key)}`;
		if (!existing.has(k)) existing.set(k, t);
	}
	if (!byManufacturer.has(t.manufacturer)) byManufacturer.set(t.manufacturer, []);
	byManufacturer.get(t.manufacturer).push({ key: norm(d.model), t });
}
function findExisting(mfr, mfrName, model) {
	const stripped = norm(model).replace(new RegExp(`^${norm(mfrName)}`), '');
	return existing.get(`${mfr}|${norm(model)}`) ?? existing.get(`${mfr}|${stripped}`) ?? null;
}
/**
 * Templates that look like suffixed variants of this model (Arista "-F"/"-R" airflow, Cisco "-E"/"-S"
 * licences...). Importing the bare model would create a near-duplicate, so those are reported instead.
 */
function findVariants(mfr, model) {
	const key = norm(model);
	if (key.length < 4) return [];
	return (byManufacturer.get(mfr) ?? []).filter((e) => e.key !== key && e.key.startsWith(key) && e.key.length - key.length <= 4).map((e) => e.t);
}

// ---------------------------------------------------------------- conversion

const CATEGORY = {
	Server: 'server',
	Appliance: 'appliance',
	'Storage Array': 'storage_array',
	Switch: 'network_switch',
	Chassis: 'blade_chassis',
	'Patch Panel': 'patch_panel',
	CDU: 'pdu',
	Sensor: 'environmental_monitor'
};
const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const stripHtml = (s) => String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() || undefined;
const clean = (o) => {
	for (const k of Object.keys(o)) {
		const v = o[k];
		if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) delete o[k];
		else if (typeof v === 'object' && !Array.isArray(v)) {
			clean(v);
			if (!Object.keys(v).length) delete o[k];
		}
	}
	return o;
};

function convert(t, mfr) {
	const model = String(t.Model).trim();
	const height = int(t.Height);
	const notes = stripHtml(t.Notes);
	const inferred = [];

	let category = CATEGORY[t.DeviceType];
	if (!category) {
		// "Physical Infrastructure" covers blanks, shelves, cable managers... ask the shared heuristics.
		category = inferCategory({ model, manufacturer: t.ManufacturerName, description: notes, u_height: height }, {}).category;
		inferred.push('category');
	}
	const formFactor = height > 0 ? 'rack' : category === 'pdu' ? 'zero-u' : category === 'environmental_monitor' ? 'other' : 'blade';

	const ports = [...(t.ports ?? [])].sort((a, b) => int(a.PortNumber) - int(b.PortNumber));
	const label = (p, prefix) => String(p.Label ?? '').trim() || `${prefix}${int(p.PortNumber)}`;
	const media = (p) => `${p.MediaType ?? ''} ${p.ConnectorType ?? ''} ${p.Label ?? ''}`;
	let interfaces, front_ports, rear_ports;
	if (category === 'patch_panel') {
		front_ports = ports.map((p) => clean({ name: label(p, 'Front '), type: passThroughType(media(p)), color: p.Name ? String(p.Name).toLowerCase() : undefined, rear_port: `Rear ${int(p.PortNumber)}`, rear_port_position: 1 }));
		rear_ports = ports.map((p) => ({ name: `Rear ${int(p.PortNumber)}`, type: passThroughType(media(p)) }));
	} else {
		interfaces = ports.map((p) =>
			clean({
				name: label(p, 'Port '),
				type: interfaceTypeFrom(media(p)),
				mgmt_only: /mgmt|management|idrac|ilo\b|ipmi|bmc|xcc|imm\b|oob/i.test(`${p.Label} ${p.Notes ?? p.PortNotes ?? ''}`) || undefined,
				description: stripHtml(p.Notes ?? p.PortNotes)
			})
		);
		if (!interfaces.length && int(t.NumPorts) > 0) {
			interfaces = Array.from({ length: int(t.NumPorts) }, (_, i) => ({ name: `Port ${i + 1}`, type: 'other' }));
			inferred.push('interfaces');
		}
	}

	const powerports = [...(t.powerports ?? [])].sort((a, b) => int(a.PortNumber) - int(b.PortNumber));
	const psCount = int(t.PSCount);
	const power_ports = powerports.length
		? powerports.map((p) => clean({ name: String(p.Label ?? '').trim() || `PSU${int(p.PortNumber)}`, description: stripHtml(p.Notes ?? p.PortNotes) }))
		: Array.from({ length: psCount }, (_, i) => ({ name: `PSU${i + 1}` }));

	const slotsFront = int(t.ChassisSlots);
	const slotsRear = int(t.RearChassisSlots);
	const bays = [
		...Array.from({ length: slotsFront }, (_, i) => ({ name: `Slot ${i + 1}`, side: 'front' })),
		...Array.from({ length: slotsRear }, (_, i) => ({ name: `Rear slot ${i + 1}`, side: 'rear' }))
	];

	const weight = Number(t.Weight) > 0 ? Math.round(Number(t.Weight) * (opts.units === 'english' ? 0.45359237 : 1) * 100) / 100 : undefined;

	return clean({
		manufacturer: mfr,
		model,
		slug: slugify(model),
		category,
		form_factor: formFactor,
		u_height: height,
		subdevice_role: bays.length ? 'parent' : formFactor === 'blade' ? 'child' : undefined,
		weight_kg: weight,
		power: { typical_w: Number(t.Wattage) > 0 ? Number(t.Wattage) : undefined, psu_count: category === 'pdu' ? undefined : psCount || undefined },
		interfaces,
		front_ports,
		rear_ports,
		power_ports: category === 'pdu' ? undefined : power_ports,
		device_bays: category === 'blade_chassis' || bays.length ? bays : undefined,
		comments: notes,
		source: clean({
			origin: ORIGIN,
			url: 'https://opendcim.org',
			upstream_path: int(t.GlobalID) > 0 ? `repository/template/${int(t.GlobalID)}` : undefined,
			imported_at: today,
			inferred: inferred.length ? inferred : undefined
		})
	});
}

/** openDCIM chassis slots are pixel rectangles on the picture; we store fractions. */
async function hotspots(t, pictures) {
	const out = [];
	for (const s of t.slots ?? []) {
		const side = int(s.BackSide) ? 'rear' : 'front';
		const pic = pictures[side];
		const [x, y, w, h] = [s.X, s.Y, s.W, s.H].map(Number);
		if (!pic || !(w > 0 && h > 0)) continue;
		const r = (v) => Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));
		out.push({
			label: side === 'rear' ? `Rear slot ${int(s.Position)}` : `Slot ${int(s.Position)}`,
			side,
			kind: 'blade_slot',
			component: side === 'rear' ? `Rear slot ${int(s.Position)}` : `Slot ${int(s.Position)}`,
			rect: { x: r(x / pic.width), y: r(y / pic.height), w: r(w / pic.width), h: r(h / pic.height) }
		});
	}
	return out;
}

async function writeImages(dir, pictures) {
	const written = {};
	for (const [side, pic] of Object.entries(pictures)) {
		if (!pic || opts['dry-run']) continue;
		const tmp = join(await mkdtemp(join(tmpdir(), 'odcim-')), 'img');
		try {
			await writeFile(tmp, pic.buffer);
			await convertImage(tmp, join(dir, `${side}.webp`));
			written[side] = `${side}.webp`;
			stats.images++;
		} finally {
			await rm(join(tmp, '..'), { recursive: true, force: true });
		}
	}
	return written;
}

// ---------------------------------------------------------------- main

const source = opts.url ? fromApi() : fromFiles(positionals);
try {
	for await (const t of source) {
		stats.templates++;
		try {
			// Prefer the manufacturer that already has this model (old "HP" ProLiants live under hpe).
			const owner = manufacturerCandidates(t.ManufacturerName).find((slug) => findExisting(slug, t.ManufacturerName, t.Model));
			const mfr = owner ?? manufacturerSlug(t.ManufacturerName);
			const data = convert(t, mfr);
			if (!data.slug) {
				stats.skipped++;
				continue;
			}
			const pictures = {};
			for (const side of ['front', 'rear']) {
				if (!t[side]) continue;
				const meta = await sharp(t[side]).metadata().catch(() => null);
				if (meta?.width) pictures[side] = { buffer: t[side], width: meta.width, height: meta.height };
			}
			const spots = await hotspots(t, pictures);
			const imageFields = clean({
				front: pictures.front ? 'front.webp' : undefined,
				rear: pictures.rear ? 'rear.webp' : undefined,
				hotspots: spots.length ? spots : undefined,
				credit: Object.keys(pictures).length ? opts.credit ?? 'openDCIM template library' : undefined
			});

			const match = findExisting(mfr, t.ManufacturerName, data.model);
			const variants = match ? [] : findVariants(mfr, data.model);
			if (variants.length) {
				stats.ambiguous++;
				log.push(`? ${mfr}/${data.slug}: not imported, matches variants ${variants.map((v) => v.slug).join(', ')}. Add it as an alias to the right one.`);
				continue;
			}
			if (match) {
				// Someone else's template: only fill what is missing.
				const current = readYaml(match.file);
				const missingSides = Object.keys(pictures).filter((s) => !current.images?.[s]);
				const extra = structuredClone(data);
				for (const key of ['manufacturer', 'model', 'slug', 'category', 'form_factor', 'source']) delete extra[key];
				// Placeholder ports guessed from a bare port count are not worth adding to curated data.
				if (data.source.inferred?.includes('interfaces')) delete extra.interfaces;
				if (missingSides.length) {
					extra.images = clean({
						...Object.fromEntries(missingSides.map((s) => [s, `${s}.webp`])),
						// Slot rectangles are pixels on openDCIM's picture: only valid next to that picture.
						hotspots: current.images?.hotspots ? undefined : spots.filter((h) => missingSides.includes(h.side)),
						credit: current.images?.credit ? undefined : imageFields.credit
					});
				}
				if (current.source?.origin === ORIGIN) {
					// Our own earlier import: go through the normal update path below.
				} else {
					const { filled } = enrichTemplate('device', match.file, extra, ORIGIN, { dryRun: opts['dry-run'] });
					if (filled.some((p) => p.startsWith('images.') && p !== 'images.hotspots' && p !== 'images.credit')) {
						await writeImages(match.dir, Object.fromEntries(missingSides.map((s) => [s, pictures[s]])));
					}
					if (filled.length) {
						stats.enriched++;
						log.push(`~ ${match.manufacturer}/${match.slug}: ${filled.join(', ')}`);
					} else stats.unchanged++;
					continue;
				}
			}

			if (Object.keys(imageFields).length) data.images = imageFields;
			const slug = match?.slug ?? data.slug;
			data.slug = slug;
			const result = upsertTemplate('device', mfr, slug, data, { dryRun: opts['dry-run'] });
			if (result.status === 'written') {
				const isNew = !match;
				isNew ? stats.created++ : stats.updated++;
				log.push(`${isNew ? '+' : '~'} ${mfr}/${slug}`);
				const dir = join(ROOT, KINDS.device.dir, mfr, slug);
				const written = await writeImages(dir, pictures);
				// A picture that failed to convert must not stay referenced.
				if (!opts['dry-run'] && Object.keys(pictures).some((s) => !written[s])) {
					const d = readYaml(result.file);
					for (const s of Object.keys(pictures)) if (!written[s] && d.images) delete d.images[s];
					writeYaml(result.file, restamp(d), 'device.schema.json');
				}
			} else if (result.status === 'unchanged') stats.unchanged++;
			else stats.kept_local_edits++;
		} catch (err) {
			stats.failed++;
			console.warn(`! ${t.ManufacturerName} ${t.Model}: ${err.message}`);
		}
	}
} catch (err) {
	// Connection or authentication problems with the openDCIM API end the run.
	const hint = /401|403/.test(err.message) ? ' (check OPENDCIM_USER / OPENDCIM_APIKEY and that the user may read templates)' : '';
	const cause = err.cause ? ` (${err.cause.code ?? err.cause.errors?.[0]?.code ?? err.cause.message})` : '';
	console.error(`openDCIM: ${err.message}${cause}${hint}`);
	process.exit(1);
}

for (const line of log.slice(0, 200)) console.log(line);
if (log.length > 200) console.log(`… ${log.length - 200} more`);
console.log(JSON.stringify(stats, null, 2));
if (!opts.images) console.log('Pictures were not imported. Re-run with --images only for photos you may publish under CC0.');
