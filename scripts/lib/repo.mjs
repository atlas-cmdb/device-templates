// Shared helpers for reading/writing the template library.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The three template kinds and where they live. */
export const KINDS = {
	device: { dir: 'devices', file: 'device.yaml', schema: 'device.schema.json' },
	module: { dir: 'modules', file: 'module.yaml', schema: 'module.schema.json' },
	rack: { dir: 'racks', file: 'rack.yaml', schema: 'rack.schema.json' }
};

// Single-image views. 'interior' is the lid-off top view. Gallery photos are listed separately.
export const IMAGE_SIDES = ['front', 'rear', 'top', 'left', 'right', 'interior'];
export const IMAGE_EXTENSIONS = ['webp', 'png', 'jpg'];

/** Lower-case, ASCII, dash separated. Keeps dots between digits (e.g. "2.5"). */
export function slugify(value) {
	return String(value)
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/\+/g, '-plus')
		.replace(/&/g, '-and-')
		.replace(/(\d)\.(\d)/g, '$1_DOT_$2')
		.replace(/[^a-z0-9_]+/g, '-')
		.replace(/_DOT_/g, '.')
		.replace(/_/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

export function readYaml(file) {
	return YAML.parse(readFileSync(file, 'utf8')) ?? {};
}

/** Canonical key order so diffs stay readable regardless of who wrote the file. */
const KEY_ORDER = [
	'manufacturer', 'model', 'slug', 'name', 'kind', 'category', 'form_factor', 'family', 'description',
	'part_numbers', 'aliases', 'website', 'support_url', 'parent', 'logo',
	'u_height', 'starting_unit', 'desc_units', 'full_depth', 'rack_width', 'subdevice_role',
	'dimensions', 'outer_width_mm', 'outer_height_mm', 'outer_depth_mm', 'mounting_depth_mm',
	'weight_kg', 'weight_max_kg', 'max_load_kg', 'airflow', 'color', 'doors', 'zero_u_channels',
	'power', 'thermal',
	'interfaces', 'console_ports', 'console_server_ports', 'power_ports', 'power_outlets',
	'front_ports', 'rear_ports', 'module_bays', 'device_bays', 'inventory_items',
	'images', 'model_3d', 'model_3d_info', 'lifecycle', 'management', 'links', 'comments', 'verified', 'source'
];

export function sortKeys(obj) {
	const ordered = {};
	for (const key of KEY_ORDER) if (obj[key] !== undefined) ordered[key] = obj[key];
	for (const key of Object.keys(obj).sort()) if (!(key in ordered) && obj[key] !== undefined) ordered[key] = obj[key];
	return ordered;
}

/** Write YAML with a yaml-language-server hint so editors autocomplete against the schema. */
export function writeYaml(file, data, schemaName) {
	mkdirSync(dirname(file), { recursive: true });
	const schemaPath = relative(dirname(file), join(ROOT, 'schema', schemaName)).split(sep).join('/');
	const body = YAML.stringify(sortKeys(data), { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
	writeFileSync(file, `# yaml-language-server: $schema=${schemaPath}\n${body}`);
}

/** Stable short hash of a value (key order independent). */
export function hashOf(value) {
	const canonical = JSON.stringify(value, (_k, v) =>
		v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v
	);
	return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function hashFile(file) {
	return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
}

/** List every template of a kind: { manufacturer, slug, dir, file }. */
export function listTemplates(kind) {
	const { dir, file } = KINDS[kind];
	const base = join(ROOT, dir);
	if (!existsSync(base)) return [];
	const out = [];
	for (const manufacturer of readdirSync(base).sort()) {
		const mdir = join(base, manufacturer);
		if (!statSync(mdir).isDirectory()) continue;
		for (const slug of readdirSync(mdir).sort()) {
			const tdir = join(mdir, slug);
			if (!statSync(tdir).isDirectory()) continue;
			out.push({ manufacturer, slug, dir: tdir, file: join(tdir, file) });
		}
	}
	return out;
}

export function listManufacturers() {
	const base = join(ROOT, 'manufacturers');
	if (!existsSync(base)) return [];
	return readdirSync(base)
		.filter((f) => f.endsWith('.yaml'))
		.sort()
		.map((f) => ({ slug: f.slice(0, -5), file: join(base, f) }));
}
