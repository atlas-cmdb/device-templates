#!/usr/bin/env node
// Import the NetBox community device-type library (CC0-1.0) into this repository.
//
//   git clone --depth 1 https://github.com/netbox-community/devicetype-library ../netbox-dtl
//   npm run import:netbox -- ../netbox-dtl [--all] [--no-images] [--only Dell,APC] [--dry-run]
//
// Safe to re-run: only the fields NetBox owns (source.upstream_fields) are updated, and only while
// nobody has edited them. Fields added by people or other importers are always kept.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import YAML from 'yaml';
import { convertImage } from './lib/images.mjs';
import { CATEGORIES } from './lib/categories.mjs';
import { IMAGE_SIDES, KINDS, ROOT, readYaml, slugify, writeYaml } from './lib/repo.mjs';
import { restamp, upsertTemplate } from './lib/upsert.mjs';
import { inferCategory, inferFormFactor, inferModuleKind, isDatacenterRelevant } from './lib/infer.mjs';
import { MANUFACTURER_EXTRAS } from './lib/manufacturers.mjs';

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		all: { type: 'boolean', default: false },
		'no-images': { type: 'boolean', default: false },
		'dry-run': { type: 'boolean', default: false },
		only: { type: 'string' },
		concurrency: { type: 'string', default: '8' }
	}
});

const SRC = positionals[0] ? resolve(positionals[0]) : null;
if (!SRC || !existsSync(join(SRC, 'device-types'))) {
	console.error('usage: npm run import:netbox -- <path-to-devicetype-library-checkout> [--all] [--no-images] [--only Vendor,Vendor] [--dry-run]');
	process.exit(1);
}

const UPSTREAM = 'https://github.com/netbox-community/devicetype-library';
const today = new Date().toISOString().slice(0, 10);
let commit = 'unknown';
try {
	commit = execFileSync('git', ['-C', SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}
const onlyVendors = opts.only ? new Set(opts.only.split(',').map((v) => v.trim().toLowerCase())) : null;

const stats = {
	devices: { written: 0, unchanged: 0, kept_local_edits: 0, skipped_not_dc: 0, failed: 0 },
	modules: { written: 0, unchanged: 0, kept_local_edits: 0, failed: 0 },
	racks: { written: 0, unchanged: 0, kept_local_edits: 0, failed: 0 },
	images: { written: 0, failed: 0 },
	categories: {},
	skippedSample: []
};
const manufacturers = new Map(); // slug -> name
const imageJobs = [];

// ---------------------------------------------------------------- helpers

const toKg = (value, unit) => {
	if (value == null || Number(value) <= 0) return undefined;
	const factor = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523 }[unit ?? 'kg'] ?? 1;
	const kg = Math.round(Number(value) * factor * 1000) / 1000;
	return kg > 0 ? kg : undefined;
};
const toMm = (value, unit) => (value == null || Number(value) <= 0 ? undefined : Math.round(Number(value) * (unit === 'in' ? 25.4 : 1) * 10) / 10);
const clean = (obj) => {
	for (const key of Object.keys(obj)) {
		const v = obj[key];
		if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)) delete obj[key];
	}
	return obj;
};
const str = (v) => (v == null ? undefined : String(v).trim() || undefined);

function normaliseUrl(raw) {
	const trimmed = String(raw).replace(/[\])>.,;:'"]+$/, '');
	try {
		const url = new URL(trimmed);
		if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null;
		return url.href;
	} catch {
		return null;
	}
}

/** Pull markdown/bare links out of NetBox comments into structured links. */
function extractLinks(comments) {
	const links = {};
	const other = [];
	if (!comments) return { links, rest: undefined };
	let rest = String(comments);
	const found = [];
	rest = rest.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) => (found.push({ label: label.trim(), url }), ''));
	// Reversed markdown, "(label)[url]", is common in upstream comments.
	rest = rest.replace(/\(([^)]*)\)\[(https?:\/\/[^\]\s]+)\]/g, (_m, label, url) => (found.push({ label: label.trim(), url }), ''));
	rest = rest.replace(/(?<![(\w])(https?:\/\/[^\s)<>"]+)/g, (_m, url) => (found.push({ label: '', url }), ''));
	for (const item of found) {
		const url = normaliseUrl(item.url);
		const label = item.label;
		if (!url) continue;
		const hint = `${label} ${url}`.toLowerCase();
		if (!links.datasheet && /datasheet|data-sheet|data sheet|spec ?sheet|specsheet|spec-sheet|specification|\bds\b/.test(hint)) links.datasheet = url;
		else if (!links.manual && /manual|guide|install|handbook|reference|\.pdf/.test(hint)) links.manual = url;
		else if (!links.product_page && /product|overview|\/products?\//.test(hint)) links.product_page = url;
		else if (!other.some((o) => o.url === url)) other.push(clean({ label: label || undefined, url }));
	}
	if (other.length) links.other = other;
	rest = rest
		.split('\n')
		.map((l) => l.replace(/^\s*[-*]\s*$/, '').trimEnd())
		.filter((l) => l.trim() && !/^[\s|:,-]*$/.test(l))
		.join('\n')
		.trim();
	return { links, rest: rest || undefined };
}

const component = (c, extra = {}) =>
	clean({ name: str(c.name), label: str(c.label), description: str(c.description), ...extra });

function mapComponents(src) {
	const mappings = new Map();
	for (const m of src['port-mappings'] ?? []) mappings.set(m.front_port, m);
	return clean({
		interfaces: (src.interfaces ?? []).map((c) =>
			component(c, { type: str(c.type) ?? 'other', mgmt_only: c.mgmt_only || undefined, poe_mode: c.poe_mode, poe_type: c.poe_type, enabled: c.enabled === false ? false : undefined })
		),
		console_ports: (src['console-ports'] ?? []).map((c) => component(c, { type: str(c.type) })),
		console_server_ports: (src['console-server-ports'] ?? []).map((c) => component(c, { type: str(c.type) })),
		power_ports: (src['power-ports'] ?? []).map((c) =>
			component(c, { type: str(c.type), maximum_draw_w: Number(c.maximum_draw) > 0 ? Number(c.maximum_draw) : undefined, allocated_draw_w: Number(c.allocated_draw) > 0 ? Number(c.allocated_draw) : undefined })
		),
		power_outlets: (src['power-outlets'] ?? []).map((c) => component(c, { type: str(c.type), power_port: str(c.power_port), feed_leg: c.feed_leg }))
			.map((o) => (['A', 'B', 'C'].includes(o.feed_leg) ? o : (delete o.feed_leg, o))),
		front_ports: (src['front-ports'] ?? []).map((c) => {
			const m = mappings.get(c.name);
			return component(c, {
				type: str(c.type),
				color: str(c.color),
				positions: Number(c.positions) > 1 ? Number(c.positions) : undefined,
				rear_port: str(m?.rear_port ?? c.rear_port),
				rear_port_position: Number(m?.rear_port_position ?? c.rear_port_position) || undefined
			});
		}),
		rear_ports: (src['rear-ports'] ?? []).map((c) => component(c, { type: str(c.type), color: str(c.color), positions: Number(c.positions) > 1 ? Number(c.positions) : undefined })),
		module_bays: (src['module-bays'] ?? []).map((c) => component(c, { bay_position: str(c.position) })),
		device_bays: (src['device-bays'] ?? []).map((c) => component(c)),
		inventory_items: (src['inventory-items'] ?? []).map((c) => component(c, { manufacturer: str(c.manufacturer), part_id: str(c.part_id) }))
	});
}

function registerManufacturer(name) {
	const slug = slugify(name);
	if (!manufacturers.has(slug)) manufacturers.set(slug, name);
	return slug;
}

/**
 * Write a template, updating only the fields this importer owns (see lib/upsert.mjs).
 * Templates that belong to another origin, or whose NetBox fields someone edited, are kept.
 */
function upsert(kind, manufacturer, slug, data, statBucket) {
	const { status } = upsertTemplate(kind, manufacturer, slug, data, { dryRun: opts['dry-run'] });
	if (status === 'written') statBucket.written++;
	else if (status === 'unchanged') statBucket.unchanged++;
	else statBucket.kept_local_edits++;
	return status === 'foreign' ? 'kept' : status;
}

function findImage(dir, base, side) {
	if (!existsSync(dir)) return null;
	for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']) {
		const p = join(dir, `${base}.${side}.${ext}`);
		if (existsSync(p)) return p;
	}
	return null;
}

function sourceBlock(upstreamPath, inferred) {
	return clean({
		origin: 'netbox-devicetype-library',
		url: UPSTREAM,
		license: 'CC0-1.0',
		upstream_path: upstreamPath,
		upstream_commit: commit,
		imported_at: today,
		inferred: inferred?.length ? inferred : undefined
	});
}

function yamlFiles(dir) {
	if (!existsSync(dir)) return [];
	const out = [];
	for (const vendor of readdirSync(dir).sort()) {
		if (onlyVendors && !onlyVendors.has(vendor.toLowerCase())) continue;
		const vdir = join(dir, vendor);
		let entries;
		try {
			entries = readdirSync(vdir);
		} catch {
			continue;
		}
		for (const f of entries.sort()) if (/\.ya?ml$/.test(f)) out.push({ vendor, file: join(vdir, f), rel: `${vendor}/${f}` });
	}
	return out;
}

function parse(file) {
	try {
		return YAML.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		console.warn(`! cannot parse ${file}: ${err.message}`);
		return null;
	}
}

/** Pick a slug from the model name, falling back to the NetBox slug on collisions. */
function makeSlugPicker() {
	const taken = new Map();
	return (manufacturer, model, fallback) => {
		const key = (s) => `${manufacturer}/${s}`;
		let slug = slugify(model) || slugify(fallback);
		if (taken.has(key(slug)) && taken.get(key(slug)) !== model) slug = slugify(fallback);
		let n = 2;
		const base = slug;
		while (taken.has(key(slug)) && taken.get(key(slug)) !== model) slug = `${base}-${n++}`;
		taken.set(key(slug), model);
		return slug;
	};
}

// ---------------------------------------------------------------- devices

const pickDeviceSlug = makeSlugPicker();
for (const { vendor, file, rel } of yamlFiles(join(SRC, 'device-types'))) {
	const src = parse(file);
	if (!src?.model || !src.manufacturer) continue;
	try {
		const components = mapComponents(src);
		const u = Number(src.u_height ?? 1);
		const { category, confident } = inferCategory(src, components);
		const formFactor = inferFormFactor(u, src, category);

		if (!opts.all && !isDatacenterRelevant({ category, formFactor, src })) {
			stats.devices.skipped_not_dc++;
			if (stats.skippedSample.length < 15) stats.skippedSample.push(`${src.manufacturer} ${src.model}`);
			continue;
		}

		const manufacturer = registerManufacturer(src.manufacturer);
		const slug = pickDeviceSlug(manufacturer, src.model, src.slug ?? src.model);
		const { links, rest } = extractLinks(src.comments);
		const powerOutlets = components.power_outlets?.length ?? 0;
		const psuBays = (components.module_bays ?? []).filter((b) => /psu|power supply|^ps ?\d/i.test(b.name)).length;
		const power = clean({
			psu_count: category === 'pdu' || category === 'ats' ? undefined : components.power_ports?.length || psuBays || undefined,
			outlet_count: powerOutlets || undefined
		});

		const data = clean({
			manufacturer,
			model: String(src.model).trim(),
			slug,
			category,
			form_factor: formFactor,
			description: str(src.description),
			part_numbers: src.part_number ? [String(src.part_number).trim()] : undefined,
			u_height: u,
			full_depth: src.is_full_depth === undefined ? undefined : Boolean(src.is_full_depth),
			subdevice_role: ['parent', 'child'].includes(src.subdevice_role) ? src.subdevice_role : undefined,
			weight_kg: toKg(src.weight, src.weight_unit),
			airflow: src.airflow,
			power,
			...components,
			links,
			comments: rest,
			source: sourceBlock(`device-types/${rel}`, confident ? undefined : ['category'])
		});

		const imgDir = join(SRC, 'elevation-images', vendor);
		const images = {};
		for (const side of ['front', 'rear']) {
			if (!src[`${side}_image`] || opts['no-images']) continue;
			const img = findImage(imgDir, src.slug, side);
			if (img) images[side] = { from: img, to: `${side}.webp` };
		}
		if (Object.keys(images).length) {
			data.images = Object.fromEntries(Object.entries(images).map(([side, v]) => [side, v.to]));
			data.images.credit = 'NetBox devicetype-library contributors';
		}

		const status = upsert('device', manufacturer, slug, data, stats.devices);
		if (status === 'written' || status === 'unchanged') {
			for (const { from, to } of Object.values(images)) imageJobs.push({ from, to: join(ROOT, 'devices', manufacturer, slug, to), force: status === 'written' });
		}
		stats.categories[category] = (stats.categories[category] ?? 0) + 1;
	} catch (err) {
		stats.devices.failed++;
		console.warn(`! ${rel}: ${err.message}`);
	}
}

// ---------------------------------------------------------------- modules

const pickModuleSlug = makeSlugPicker();
for (const { vendor, file, rel } of yamlFiles(join(SRC, 'module-types'))) {
	const src = parse(file);
	if (!src?.model || !src.manufacturer) continue;
	try {
		const manufacturer = registerManufacturer(src.manufacturer);
		const slug = pickModuleSlug(manufacturer, src.model, src.part_number ?? src.model);
		const components = mapComponents(src);
		delete components.device_bays;
		delete components.inventory_items;
		delete components.console_server_ports;
		const { links, rest } = extractLinks(src.comments);
		const attr = src.attribute_data ?? {};
		const kind = inferModuleKind(src, components);
		const data = clean({
			manufacturer,
			model: String(src.model).trim(),
			slug,
			kind,
			description: str(src.description),
			part_numbers: src.part_number ? [String(src.part_number).trim()] : undefined,
			weight_kg: toKg(src.weight, src.weight_unit),
			airflow: src.airflow,
			power: clean({
				psu_rating_w: Number(attr.wattage) > 0 ? Number(attr.wattage) : undefined,
				input_voltage: attr.input_voltage ? `${attr.input_voltage}V ${attr.input_current ?? ''}`.trim() : undefined
			}),
			...components,
			links,
			comments: rest,
			source: sourceBlock(`module-types/${rel}`, ['kind'])
		});
		const img = opts['no-images'] ? null : findImage(join(SRC, 'module-images', vendor), src.model, 'front') ?? (src.part_number ? findImage(join(SRC, 'module-images', vendor), src.part_number, 'front') : null);
		if (img) data.images = { front: 'front.webp', credit: 'NetBox devicetype-library contributors' };
		const status = upsert('module', manufacturer, slug, data, stats.modules);
		if (img && status !== 'kept') imageJobs.push({ from: img, to: join(ROOT, 'modules', manufacturer, slug, 'front.webp'), force: status === 'written' });
	} catch (err) {
		stats.modules.failed++;
		console.warn(`! ${rel}: ${err.message}`);
	}
}

// ---------------------------------------------------------------- racks

const pickRackSlug = makeSlugPicker();
for (const { file, rel } of yamlFiles(join(SRC, 'rack-types'))) {
	const src = parse(file);
	if (!src?.model || !src.manufacturer) continue;
	try {
		const manufacturer = registerManufacturer(src.manufacturer);
		const slug = pickRackSlug(manufacturer, src.model, src.slug ?? src.model);
		const { links, rest } = extractLinks(src.comments);
		const data = clean({
			manufacturer,
			model: String(src.model).trim(),
			slug,
			description: str(src.description),
			form_factor: src.form_factor,
			rack_width: [10, 19, 21, 23].includes(Number(src.width)) ? Number(src.width) : undefined,
			u_height: Number(src.u_height),
			starting_unit: src.starting_unit != null ? Number(src.starting_unit) : undefined,
			desc_units: src.desc_units || undefined,
			outer_width_mm: toMm(src.outer_width, src.outer_unit),
			outer_height_mm: toMm(src.outer_height, src.outer_unit),
			outer_depth_mm: toMm(src.outer_depth, src.outer_unit),
			mounting_depth_mm: toMm(src.mounting_depth, 'mm'),
			weight_kg: toKg(src.weight, src.weight_unit),
			max_load_kg: toKg(src.max_weight, src.weight_unit),
			links,
			comments: rest,
			source: sourceBlock(`rack-types/${rel}`)
		});
		upsert('rack', manufacturer, slug, data, stats.racks);
	} catch (err) {
		stats.racks.failed++;
		console.warn(`! ${rel}: ${err.message}`);
	}
}

// ---------------------------------------------------------------- manufacturers

for (const [slug, name] of [...manufacturers].sort()) {
	const file = join(ROOT, 'manufacturers', `${slug}.yaml`);
	if (existsSync(file) || opts['dry-run']) continue;
	writeYaml(file, clean({ name, slug, ...(MANUFACTURER_EXTRAS[slug] ?? {}) }), 'manufacturer.schema.json');
}

// ---------------------------------------------------------------- images

/** A source image that cannot be decoded must not leave a dangling reference behind. */
function dropImageReference(imagePath) {
	const dir = dirname(imagePath);
	const kind = Object.keys(KINDS).find((k) => existsSync(join(dir, KINDS[k].file)));
	if (!kind) return;
	const file = join(dir, KINDS[kind].file);
	const data = readYaml(file);
	const side = basename(imagePath).split('.')[0];
	if (!data.images?.[side]) return;
	delete data.images[side];
	if (!IMAGE_SIDES.some((s) => data.images[s])) delete data.images;
	writeYaml(file, restamp(data), KINDS[kind].schema);
}

if (!opts['dry-run']) {
	const queue = imageJobs.filter((j) => j.force || !existsSync(j.to));
	const limit = Math.max(1, Number(opts.concurrency) || 8);
	let done = 0;
	const worker = async () => {
		while (queue.length) {
			const job = queue.shift();
			try {
				await convertImage(job.from, job.to);
				stats.images.written++;
			} catch (err) {
				stats.images.failed++;
				console.warn(`! image ${job.from}: ${err.message}`);
				rmSync(job.to, { force: true });
				dropImageReference(job.to);
			}
			if (++done % 250 === 0) console.log(`  images: ${done}`);
		}
	};
	await Promise.all(Array.from({ length: limit }, worker));
}

const known = Object.keys(CATEGORIES);
for (const c of Object.keys(stats.categories)) if (!known.includes(c)) console.warn(`! unknown category ${c}`);
console.log(JSON.stringify({ upstream_commit: commit, manufacturers: manufacturers.size, ...stats }, null, 2));
