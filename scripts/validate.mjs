#!/usr/bin/env node
// Validate every template: schema, folder layout, images, references and duplicates.
//
//   npm run validate                 # whole repository
//   npm run validate -- devices/dell # only paths under a prefix (still checks global duplicates)
//   npm run validate -- --strict     # treat warnings as errors
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';
import { IMAGE_EXTENSIONS, IMAGE_SIDES, KINDS, ROOT, listManufacturers, listTemplates } from './lib/repo.mjs';
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, imageInfo } from './lib/images.mjs';

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: { strict: { type: 'boolean', default: false }, 'max-warnings': { type: 'string', default: '40' } }
});
const prefixes = positionals.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''));
const inScope = (file) => !prefixes.length || prefixes.some((p) => rel(file).startsWith(p));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const f of readdirSync(join(ROOT, 'schema')).filter((f) => f.endsWith('.schema.json'))) {
	ajv.addSchema(JSON.parse(readFileSync(join(ROOT, 'schema', f), 'utf8')));
}
const validators = Object.fromEntries(
	Object.entries({ ...KINDS, manufacturer: { schema: 'manufacturer.schema.json' } }).map(([k, v]) => [
		k,
		ajv.getSchema(`https://atlas-cmdb.github.io/device-templates/schema/${v.schema}`)
	])
);

const errors = [];
const warnings = [];
const rel = (file) => relative(ROOT, file).split(sep).join('/');
const gha = !!process.env.GITHUB_ACTIONS;
const error = (file, msg) => errors.push({ file: rel(file), msg });
const warn = (file, msg) => warnings.push({ file: rel(file), msg });

function load(file) {
	try {
		const doc = YAML.parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true });
		if (doc.errors.length) {
			for (const e of doc.errors) error(file, `YAML: ${e.message}`);
			return null;
		}
		return doc.toJS() ?? {};
	} catch (err) {
		error(file, `YAML: ${err.message}`);
		return null;
	}
}

function schemaErrors(kind, data, file) {
	const validate = validators[kind];
	if (validate(data)) return;
	for (const e of validate.errors) {
		const where = e.instancePath || '(root)';
		const extra = e.params?.additionalProperty ?? e.params?.unevaluatedProperty;
		const allowed = e.params?.allowedValues ? ` (allowed: ${e.params.allowedValues.join(', ')})` : '';
		error(file, `${where} ${e.message}${extra ? `: '${extra}'` : ''}${allowed}`);
	}
}

// ---------------------------------------------------------------- manufacturers

const manufacturerSlugs = new Set();
const manufacturerNames = new Map();
for (const { slug, file } of listManufacturers()) {
	manufacturerSlugs.add(slug);
	if (!inScope(file)) continue;
	const data = load(file);
	if (!data) continue;
	schemaErrors('manufacturer', data, file);
	if (data.slug !== slug) error(file, `slug '${data.slug}' must match the file name '${slug}'`);
	const key = String(data.name ?? '').toLowerCase();
	if (manufacturerNames.has(key)) error(file, `duplicate manufacturer name, also in ${manufacturerNames.get(key)}`);
	manufacturerNames.set(key, rel(file));
}
for (const { slug, file } of listManufacturers()) {
	if (!inScope(file)) continue;
	const data = load(file);
	if (data?.parent && !manufacturerSlugs.has(data.parent)) warn(file, `parent '${data.parent}' has no manufacturers/${data.parent}.yaml`);
}

// ---------------------------------------------------------------- 3D models

const MAX_GLB_BYTES = 8 * 1024 * 1024;
/** A .glb must be binary glTF 2.0 and small enough to stream into a VR scene full of racks. */
function checkGlb(path, data) {
	const buf = readFileSync(path);
	if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') return error(path, 'not a binary glTF (.glb) file');
	if (buf.readUInt32LE(4) !== 2) error(path, `glTF version ${buf.readUInt32LE(4)}; version 2 is required`);
	if (buf.length > MAX_GLB_BYTES) error(path, `${(buf.length / 1048576).toFixed(1)} MB is too large (max ${MAX_GLB_BYTES / 1048576} MB): decimate the mesh or compress textures (e.g. gltf-transform optimize)`);
	try {
		const jsonLength = buf.readUInt32LE(12);
		const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
		const nodes = gltf.nodes ?? [];
		const names = new Set(nodes.map((n) => n.name).filter(Boolean));
		for (const [layer, list] of Object.entries(data.model_3d_info?.layers ?? {}))
			for (const name of list) {
				if (!names.has(name)) error(path, `model_3d_info.layers.${layer}: no node named '${name}' in the model`);
				// three.js (Atlas) strips these characters from node names on load, so lookups by name would miss.
				else if (/[\s.:/[\]]/.test(name)) error(path, `model_3d_info.layers.${layer}: rename node '${name}' without spaces or . : / [ ] (three.js rewrites those names)`);
			}
		for (const name of Object.values(data.model_3d_info?.views ?? {}))
			if (/[\s.:/[\]]/.test(name)) error(path, `model_3d_info.views: rename camera node '${name}' without spaces or . : / [ ]`);
		for (const [view, name] of Object.entries(data.model_3d_info?.views ?? {})) {
			const node = nodes.find((n) => n.name === name);
			if (!node) error(path, `model_3d_info.views.${view}: no node named '${name}' in the model`);
			else if (node.camera === undefined) error(path, `model_3d_info.views.${view}: node '${name}' has no camera`);
		}
		if (data.model_3d_info?.includes_interior && !data.model_3d_info?.layers?.top_cover) warn(path, 'includes_interior is set but layers.top_cover is missing, so viewers cannot open it');
		if (!data.model_3d_info?.method) warn(path, 'add model_3d_info.method (scan, modelled or generated)');
	} catch (err) {
		error(path, `cannot read glTF JSON chunk: ${err.message}`);
	}
}

// ---------------------------------------------------------------- templates

const ALLOWED_EXTRA = /^(README\.md|model\.glb|[a-z0-9_-]+\.(webp|png|jpg|glb))$/;
const seenModels = new Map();
const seenPartNumbers = new Map();
const imageChecks = [];
let count = 0;

for (const kind of Object.keys(KINDS)) {
	const base = join(ROOT, KINDS[kind].dir);
	if (!existsSync(base)) continue;
	// Stray files directly under devices/<manufacturer>/ are a common mistake.
	for (const m of readdirSync(base)) {
		const mdir = join(base, m);
		if (!statSync(mdir).isDirectory()) {
			error(mdir, `unexpected file; templates live in ${KINDS[kind].dir}/<manufacturer>/<slug>/${KINDS[kind].file}`);
			continue;
		}
		for (const s of readdirSync(mdir)) {
			if (!statSync(join(mdir, s)).isDirectory()) error(join(mdir, s), `unexpected file; move it into ${KINDS[kind].dir}/${m}/<slug>/`);
		}
	}

	for (const { manufacturer, slug, dir, file } of listTemplates(kind)) {
		const scoped = inScope(dir);
		if (!existsSync(file)) {
			if (scoped) error(dir, `missing ${KINDS[kind].file}`);
			continue;
		}
		const data = load(file);
		if (!data) continue;
		count++;

		const modelKey = `${kind}:${manufacturer}:${String(data.model ?? '').toLowerCase()}`;
		if (seenModels.has(modelKey)) (scoped ? error : warn)(file, `model '${data.model}' already exists at ${seenModels.get(modelKey)}`);
		seenModels.set(modelKey, rel(file));
		for (const pn of data.part_numbers ?? []) {
			const key = `${kind}:${manufacturer}:${String(pn).toLowerCase()}`;
			if (seenPartNumbers.has(key) && scoped) warn(file, `part number '${pn}' also used by ${seenPartNumbers.get(key)}`);
			seenPartNumbers.set(key, rel(file));
		}
		if (!scoped) continue;

		schemaErrors(kind, data, file);
		if (data.manufacturer !== manufacturer) error(file, `manufacturer '${data.manufacturer}' must match the folder '${manufacturer}'`);
		if (data.slug !== slug) error(file, `slug '${data.slug}' must match the folder '${slug}'`);
		if (!manufacturerSlugs.has(manufacturer)) error(file, `unknown manufacturer: add manufacturers/${manufacturer}.yaml`);

		// Files in the template folder.
		const referenced = new Set([KINDS[kind].file]);
		for (const side of IMAGE_SIDES) {
			const img = data.images?.[side];
			if (!img) continue;
			referenced.add(img);
			const imgPath = join(dir, img);
			if (!existsSync(imgPath)) error(file, `images.${side}: ${img} does not exist`);
			else imageChecks.push({ file: imgPath, side, data });
		}
		for (const [i, g] of (data.images?.gallery ?? []).entries()) {
			referenced.add(g.file);
			const imgPath = join(dir, g.file);
			if (!existsSync(imgPath)) error(file, `images.gallery[${i}]: ${g.file} does not exist`);
			else imageChecks.push({ file: imgPath, side: 'gallery', data });
		}
		if (data.model_3d) {
			referenced.add(data.model_3d);
			const glb = join(dir, data.model_3d);
			if (!existsSync(glb)) error(file, `model_3d: ${data.model_3d} does not exist`);
			else checkGlb(glb, data);
			const lod = data.model_3d_info?.lod;
			if (lod) {
				referenced.add(lod);
				if (!existsSync(join(dir, lod))) error(file, `model_3d_info.lod: ${lod} does not exist`);
				else checkGlb(join(dir, lod), { model_3d_info: { method: 'lod' } });
			}
		} else if (data.model_3d_info) error(file, 'model_3d_info without model_3d');
		for (const f of readdirSync(dir)) {
			if (referenced.has(f) || f === 'README.md') continue;
			if (!ALLOWED_EXTRA.test(f)) error(join(dir, f), 'unexpected file name (lower-case, e.g. front.webp / rear.webp)');
			else if (IMAGE_EXTENSIONS.includes(extname(f).slice(1))) error(join(dir, f), `image is not referenced from ${KINDS[kind].file} (add it under images:)`);
		}

		// Internal consistency.
		for (const list of ['interfaces', 'console_ports', 'console_server_ports', 'power_ports', 'power_outlets', 'front_ports', 'rear_ports', 'module_bays', 'device_bays']) {
			const names = new Set();
			for (const c of data[list] ?? []) {
				if (names.has(c.name)) warn(file, `${list}: duplicate name '${c.name}'`);
				names.add(c.name);
			}
		}
		const rearNames = new Set((data.rear_ports ?? []).map((p) => p.name));
		for (const fp of data.front_ports ?? []) if (fp.rear_port && !rearNames.has(fp.rear_port)) error(file, `front_ports '${fp.name}' maps to unknown rear port '${fp.rear_port}'`);
		const inlets = new Set((data.power_ports ?? []).map((p) => p.name));
		for (const o of data.power_outlets ?? []) if (o.power_port && !inlets.has(o.power_port)) error(file, `power_outlets '${o.name}' references unknown power port '${o.power_port}'`);
		for (const h of data.images?.hotspots ?? []) if (!data.images?.[h.side]) error(file, `hotspot '${h.label}' is on the ${h.side} side, which has no image`);
		if (kind === 'device') {
			if (data.form_factor === 'rack' && !(data.u_height > 0)) error(file, "form_factor 'rack' needs u_height > 0");
			if (data.form_factor !== 'rack' && data.u_height > 0) warn(file, `form_factor '${data.form_factor}' with u_height ${data.u_height}`);
			if (data.subdevice_role === 'child' && data.u_height > 0) warn(file, 'child devices (blades) normally have u_height 0');
		}
	}
}

// ---------------------------------------------------------------- images

const U_MM = 44.45;
const FACE_WIDTH_MM = { 10: 222, 19: 447, 21: 527, 23: 549 };
await Promise.all(
	imageChecks.map(async ({ file, side, data }) => {
		const bytes = statSync(file).size;
		if (bytes > MAX_IMAGE_BYTES) error(file, `${(bytes / 1048576).toFixed(1)} MB is too large (max ${MAX_IMAGE_BYTES / 1048576} MB): run npm run images`);
		let info;
		try {
			info = await imageInfo(file);
		} catch (err) {
			return error(file, `cannot read image: ${err.message}`);
		}
		const ext = extname(file).slice(1);
		const expected = ext === 'jpg' ? 'jpeg' : ext;
		if (info.format !== expected) error(file, `file is ${info.format} but named .${ext}`);
		if (Math.max(info.width, info.height) > MAX_IMAGE_SIDE) warn(file, `${info.width}x${info.height} is larger than ${MAX_IMAGE_SIDE}px: run npm run images`);
		if (ext !== 'webp') warn(file, 'stored images should be WebP: run npm run images');
		// A faceplate photo should roughly match the rack-unit aspect ratio; flags uncropped photos.
		if ((side === 'front' || side === 'rear') && data.form_factor === 'rack' && data.u_height >= 1 && !data.images?.includes_ears) {
			const expectedRatio = (FACE_WIDTH_MM[data.rack_width ?? 19] ?? 447) / (data.u_height * U_MM);
			const ratio = info.width / info.height;
			if (ratio / expectedRatio < 0.6 || ratio / expectedRatio > 1.6)
				warn(file, `aspect ratio ${ratio.toFixed(2)} looks off for ${data.u_height}U (expected ~${expectedRatio.toFixed(2)}); is it cropped to the faceplate?`);
		}
	})
);

// ---------------------------------------------------------------- report

const limit = Number(opts['max-warnings']);
for (const { file, msg } of errors) console.log(gha ? `::error file=${file}::${msg}` : `✖ ${file}: ${msg}`);
for (const { file, msg } of warnings.slice(0, limit)) console.log(gha ? `::warning file=${file}::${msg}` : `⚠ ${file}: ${msg}`);
if (warnings.length > limit) console.log(`… and ${warnings.length - limit} more warnings (--max-warnings ${warnings.length} to show all)`);
console.log(`\nChecked ${count} templates and ${imageChecks.length} images: ${errors.length} errors, ${warnings.length} warnings.`);
if (errors.length || (opts.strict && warnings.length)) process.exit(1);
