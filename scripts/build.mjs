#!/usr/bin/env node
// Build the published dataset that Atlas (and anyone else) consumes:
//
//   dist/manifest.json                         search index of every template (one request)
//   dist/devices/<mfr>/<slug>/device.json      full template, JSON, with absolute image URLs
//   dist/devices/<mfr>/<slug>/front.webp       images, same paths as in the repository
//   dist/modules/..., dist/racks/...           same layout for modules and racks
//   dist/manufacturers.json, dist/schema/*     manufacturer list and JSON schemas
//   dist/index.html                            small browser for humans
//
//   npm run build -- [--out dist] [--base-url https://atlas-cmdb.github.io/device-templates/] [--no-assets]
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CATEGORIES, atlasType } from './lib/categories.mjs';
import { IMAGE_SIDES, KINDS, ROOT, hashFile, hashOf, listManufacturers, listTemplates, readYaml } from './lib/repo.mjs';

const { values: opts } = parseArgs({
	options: {
		out: { type: 'string', default: 'dist' },
		'base-url': { type: 'string', default: process.env.BASE_URL ?? 'https://atlas-cmdb.github.io/device-templates/' },
		'no-assets': { type: 'boolean', default: false }
	}
});
const OUT = join(ROOT, opts.out);
const BASE = opts['base-url'].endsWith('/') ? opts['base-url'] : `${opts['base-url']}/`;
const FORMAT_VERSION = 1;
// The dataset is public domain; code (scripts/site/types) is MIT, see LICENSE-CODE.
const LICENSE = { data: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' };

let commit = process.env.GITHUB_SHA ?? 'unknown';
try {
	commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manufacturers = new Map();
for (const { slug, file } of listManufacturers()) manufacturers.set(slug, { ...readYaml(file), counts: { devices: 0, modules: 0, racks: 0 } });

const count = (list) => (Array.isArray(list) && list.length ? list.length : undefined);
const compact = (obj) => {
	for (const k of Object.keys(obj)) if (obj[k] === undefined || obj[k] === false || (typeof obj[k] === 'object' && obj[k] && !Array.isArray(obj[k]) && !Object.keys(obj[k]).length)) delete obj[k];
	return obj;
};
const searchText = (data, mfr) =>
	// Manufacturer aliases live once in manifest.manufacturers; consumers join on `manufacturer`.
	[mfr?.name, data.model, data.family, ...(data.part_numbers ?? []), ...(data.aliases ?? []), data.slug]
		.filter(Boolean)
		.join(' ')
		.toLowerCase()
		.replace(/[^a-z0-9.+ ]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		// Collapse duplicated words to keep the index small.
		.split(' ')
		.filter((w, i, a) => a.indexOf(w) === i)
		.join(' ');

/** Summary row for the manifest: just enough to search, filter and render a placeholder. */
function summarise(kind, t, data) {
	const id = `${t.manufacturer}/${t.slug}`;
	const dir = `${KINDS[kind].dir}/${id}`;
	const images = {};
	const fileHashes = [];
	for (const side of IMAGE_SIDES) {
		if (!data.images?.[side]) continue;
		images[side] = `${dir}/${data.images[side]}`;
		fileHashes.push(hashFile(join(t.dir, data.images[side])));
	}
	for (const g of data.images?.gallery ?? []) fileHashes.push(hashFile(join(t.dir, g.file)));
	if (data.model_3d) fileHashes.push(hashFile(join(t.dir, data.model_3d)));
	const mfr = manufacturers.get(t.manufacturer);
	const base = {
		id,
		manufacturer: t.manufacturer,
		model: data.model,
		path: `${dir}/${kind}.json`,
		rev: hashOf({ data, fileHashes }).slice(0, 10),
		part_numbers: data.part_numbers,
		images: Object.keys(images).length ? images : undefined,
		verified: data.verified || undefined,
		search: searchText(data, mfr)
	};
	if (kind === 'device') {
		const powerPorts = data.power_ports ?? [];
		const maxDraw = powerPorts.reduce((s, p) => s + (p.maximum_draw_w ?? 0), 0);
		return compact({
			...base,
			category: data.category,
			atlas_type: atlasType(data) ?? undefined,
			form_factor: data.form_factor,
			u_height: data.u_height,
			full_depth: data.full_depth,
			weight_kg: data.weight_kg,
			airflow: data.airflow,
			power_w: data.power?.max_w ?? data.power?.typical_w ?? (maxDraw || undefined),
			psu_count: data.power?.psu_count,
			outlets: data.power?.outlet_count ?? count(data.power_outlets),
			ports: compact({
				interfaces: count(data.interfaces),
				console: count(data.console_ports),
				console_server: count(data.console_server_ports),
				power: count(powerPorts),
				front: count(data.front_ports),
				rear: count(data.rear_ports),
				module_bays: count(data.module_bays),
				device_bays: count(data.device_bays)
			}),
			model_3d: data.model_3d ? `${dir}/${data.model_3d}` : undefined,
			gallery: count(data.images?.gallery),
			// Vendor-hosted media (3D viewers, CAD) is linked, not stored; list the kinds for badges.
			media: data.links?.media?.length ? [...new Set(data.links.media.map((m) => m.kind))] : undefined,
			inferred: data.source?.inferred
		});
	}
	if (kind === 'module') return compact({ ...base, kind: data.kind, power_w: data.power?.psu_rating_w });
	return compact({ ...base, form_factor: data.form_factor, u_height: data.u_height, rack_width: data.rack_width, outer_depth_mm: data.outer_depth_mm });
}

/** Full JSON document: the YAML as-is plus resolved URLs, so consumers never parse YAML. */
function detail(kind, t, data, summary) {
	const urls = {};
	for (const [side, path] of Object.entries(summary.images ?? {})) urls[side] = BASE + path;
	const { $schema, ...rest } = data;
	return {
		$schema: `${BASE}schema/${KINDS[kind].schema}`,
		id: summary.id,
		rev: summary.rev,
		...(kind === 'device' ? { atlas_type: summary.atlas_type ?? null } : {}),
		...rest,
		manufacturer_name: manufacturers.get(t.manufacturer)?.name ?? t.manufacturer,
		image_urls: Object.keys(urls).length ? urls : undefined,
		gallery_urls: data.images?.gallery?.length ? data.images.gallery.map((g) => ({ ...g, url: `${BASE}${KINDS[kind].dir}/${summary.id}/${g.file}` })) : undefined,
		model_3d_url: data.model_3d ? `${BASE}${KINDS[kind].dir}/${summary.id}/${data.model_3d}` : undefined,
		model_3d_lod_url: data.model_3d_info?.lod ? `${BASE}${KINDS[kind].dir}/${summary.id}/${data.model_3d_info.lod}` : undefined
	};
}

const collections = { device: [], module: [], rack: [] };
const categoryCounts = {};
for (const kind of Object.keys(KINDS)) {
	for (const t of listTemplates(kind)) {
		if (!existsSync(t.file)) continue;
		const data = readYaml(t.file);
		const summary = summarise(kind, t, data);
		collections[kind].push(summary);
		const m = manufacturers.get(t.manufacturer);
		if (m) m.counts[`${kind}s`]++;
		if (kind === 'device') categoryCounts[data.category] = (categoryCounts[data.category] ?? 0) + 1;

		const outDir = join(OUT, KINDS[kind].dir, t.manufacturer, t.slug);
		mkdirSync(outDir, { recursive: true });
		writeFileSync(join(outDir, `${kind}.json`), JSON.stringify(detail(kind, t, data, summary)));
		if (!opts['no-assets']) {
			for (const side of IMAGE_SIDES) if (data.images?.[side]) copyFileSync(join(t.dir, data.images[side]), join(outDir, data.images[side]));
			for (const g of data.images?.gallery ?? []) copyFileSync(join(t.dir, g.file), join(outDir, g.file));
			if (data.model_3d) copyFileSync(join(t.dir, data.model_3d), join(outDir, data.model_3d));
			if (data.model_3d_info?.lod) copyFileSync(join(t.dir, data.model_3d_info.lod), join(outDir, data.model_3d_info.lod));
		}
	}
}

const manufacturerList = [...manufacturers.values()]
	.filter((m) => m.counts.devices + m.counts.modules + m.counts.racks > 0)
	.map((m) => compact({ slug: m.slug, name: m.name, aliases: m.aliases, website: m.website, parent: m.parent, counts: m.counts }));

const manifest = {
	$schema: `${BASE}schema/manifest.schema.json`,
	format_version: FORMAT_VERSION,
	license: LICENSE,
	generated_at: new Date().toISOString(),
	commit,
	base_url: BASE,
	stats: {
		manufacturers: manufacturerList.length,
		devices: collections.device.length,
		modules: collections.module.length,
		racks: collections.rack.length,
		with_images: collections.device.filter((d) => d.images).length,
		verified: collections.device.filter((d) => d.verified).length
	},
	categories: Object.fromEntries(
		Object.entries(CATEGORIES)
			.filter(([key]) => categoryCounts[key])
			.map(([key, c]) => [key, { label: c.label, atlas_type: c.atlas, count: categoryCounts[key] }])
	),
	manufacturers: manufacturerList.map(({ slug, name, aliases }) => compact({ slug, name, aliases })),
	devices: collections.device,
	modules: collections.module,
	racks: collections.rack
};

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));
writeFileSync(join(OUT, 'manufacturers.json'), JSON.stringify({ format_version: FORMAT_VERSION, manufacturers: manufacturerList }));
writeFileSync(join(OUT, 'version.json'), JSON.stringify({ format_version: FORMAT_VERSION, license: LICENSE, commit, generated_at: manifest.generated_at, stats: manifest.stats }));
cpSync(join(ROOT, 'schema'), join(OUT, 'schema'), { recursive: true });
if (existsSync(join(ROOT, 'site'))) cpSync(join(ROOT, 'site'), OUT, { recursive: true });
if (existsSync(join(ROOT, 'manufacturers', 'logos'))) cpSync(join(ROOT, 'manufacturers', 'logos'), join(OUT, 'manufacturers', 'logos'), { recursive: true });
writeFileSync(join(OUT, '.nojekyll'), '');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`Built ${manifest.stats.devices} devices, ${manifest.stats.modules} modules, ${manifest.stats.racks} racks from ${manifest.stats.manufacturers} manufacturers.`);
console.log(`manifest.json: ${kb(JSON.stringify(manifest).length)} -> ${OUT}`);
