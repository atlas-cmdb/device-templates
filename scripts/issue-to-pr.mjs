#!/usr/bin/env node
// Turn an approved "Add a device" or "Add photos" issue into template files.
// Run by .github/workflows/issue-to-pr.yml; the workflow handles git and the pull request.
//
//   ISSUE_BODY="$(cat body.md)" ISSUE_NUMBER=12 node scripts/issue-to-pr.mjs
//
// The issue body is untrusted input: it only ever reaches YAML through the yaml library, paths are
// slugified, and images are downloaded only from GitHub's own attachment hosts.
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { CATEGORIES } from './lib/categories.mjs';
import { convertImage, imageInfo } from './lib/images.mjs';
import { parsePorts, parsePowerConnectors } from './lib/ports.mjs';
import { ROOT, listManufacturers, readYaml, slugify, writeYaml } from './lib/repo.mjs';

const body = process.env.ISSUE_BODY ?? '';
const issue = process.env.ISSUE_NUMBER ?? '0';
const author = process.env.ISSUE_AUTHOR;

function output(key, value) {
	if (process.env.GITHUB_OUTPUT) {
		const delim = `EOF_${Math.random().toString(36).slice(2)}`;
		appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<${delim}\n${value}\n${delim}\n`);
	} else console.log(`[${key}]\n${value}\n`);
}
function fail(message) {
	output('error', message);
	console.error(message);
	process.exit(1);
}

/** Issue forms render as "### Label\n\nvalue"; empty fields are "_No response_". */
function parseForm(markdown) {
	const fields = {};
	const parts = markdown.replace(/\r\n/g, '\n').split(/^### /m).slice(1);
	for (const part of parts) {
		const nl = part.indexOf('\n');
		const label = part.slice(0, nl).trim();
		const value = part.slice(nl + 1).trim();
		fields[label] = value === '_No response_' || value === 'None' ? '' : value;
	}
	return fields;
}

const f = parseForm(body);
const get = (label) => (f[label] ?? '').trim();
const num = (v) => {
	const m = String(v ?? '').replace(',', '.').match(/-?\d+(\.\d+)?/);
	return m ? Number(m[0]) : undefined;
};
const nums = (v) => [...String(v ?? '').replace(/,(?=\d)/g, '.').matchAll(/\d+(\.\d+)?/g)].map((m) => Number(m[0]));
const url = (v) => {
	try {
		const u = new URL(String(v).trim());
		return /^https?:$/.test(u.protocol) ? u.href : undefined;
	} catch {
		return undefined;
	}
};

const ALLOWED_IMAGE_HOSTS = /^(github\.com|user-images\.githubusercontent\.com|private-user-images\.githubusercontent\.com|objects\.githubusercontent\.com)$/;
function imageUrls(text) {
	const found = [...String(text).matchAll(/https:\/\/[^\s)"'<>\]]+/g)].map((m) => m[0]);
	return found.filter((u) => {
		try {
			const { hostname, pathname } = new URL(u);
			return ALLOWED_IMAGE_HOSTS.test(hostname) && (hostname !== 'github.com' || pathname.startsWith('/user-attachments/'));
		} catch {
			return false;
		}
	});
}

async function downloadImage(link, dest) {
	const res = await fetch(link, { redirect: 'follow', headers: { 'user-agent': 'atlas-device-templates-bot' } });
	if (!res.ok) throw new Error(`download failed (${res.status}) for ${link}`);
	const finalHost = new URL(res.url).hostname;
	if (!/(^|\.)githubusercontent\.com$|^github\.com$/.test(finalHost)) throw new Error(`refusing redirect to ${finalHost}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length > 30 * 1024 * 1024) throw new Error('image larger than 30 MB');
	const tmp = join(tmpdir(), `issue-${issue}-${Date.now()}`);
	writeFileSync(tmp, buf);
	try {
		await imageInfo(tmp); // throws if it is not a decodable image
		await convertImage(tmp, dest);
	} finally {
		rmSync(tmp, { force: true });
	}
}

async function addImages(dir, data) {
	const added = [];
	for (const [side, label] of [['front', 'Front photo'], ['rear', 'Rear photo'], ['interior', 'Interior photo (lid off)']]) {
		const [link] = imageUrls(get(label));
		if (!link) continue;
		await downloadImage(link, join(dir, `${side}.webp`));
		data.images = { ...(data.images ?? {}), [side]: `${side}.webp` };
		added.push(side);
	}
	// "More photos": every attachment becomes a gallery entry; a text line above an image is its caption.
	const gallery = [...(data.images?.gallery ?? [])];
	let caption;
	for (const line of get('More photos').split('\n')) {
		const [link] = imageUrls(line);
		if (!link) {
			const text = line.replace(/!\[[^\]]*\]\([^)]*\)|<[^>]+>/g, '').trim();
			if (text) caption = text.slice(0, 120);
			continue;
		}
		if (gallery.length >= 12) break;
		const file = `gallery-${gallery.length + 1}.webp`;
		await downloadImage(link, join(dir, file));
		gallery.push(caption ? { file, caption } : { file });
		caption = undefined;
		added.push('gallery');
	}
	if (gallery.length) data.images = { ...(data.images ?? {}), gallery };
	if (added.length && author) data.images.credit = data.images.credit ?? `@${author} (issue #${issue})`;
	return [...new Set(added)];
}

/** Vendor viewer pages are linked, never downloaded. */
function addVendorMedia(data) {
	const link = url(get('Vendor 3D / 360° viewer link'));
	if (!link || (data.links?.media ?? []).some((m) => m.url === link)) return false;
	data.links = { ...(data.links ?? {}), media: [...(data.links?.media ?? []), { kind: '3d-viewer', url: link }] };
	return true;
}

function findManufacturer(name) {
	const needle = name.toLowerCase();
	for (const { slug, file } of listManufacturers()) {
		const m = readYaml(file);
		if (slug === slugify(name) || m.name?.toLowerCase() === needle || (m.aliases ?? []).some((a) => a.toLowerCase() === needle)) return slug;
	}
	return null;
}

// ---------------------------------------------------------------- photos for an existing device

if (f['Device id'] !== undefined && f['Front photo'] !== undefined && f['Manufacturer'] === undefined) {
	const id = get('Device id')
		.replace(/^https?:\/\/[^#]*#?/, '')
		.replace(/^devices\//, '')
		.replace(/\/device\.(yaml|json)$/, '')
		.trim()
		.toLowerCase();
	const [m, s] = id.split('/').map((p) => slugify(p ?? ''));
	const dir = join(ROOT, 'devices', m ?? '', s ?? '');
	const file = join(dir, 'device.yaml');
	if (!m || !s || !existsSync(file)) fail(`Device id \`${id}\` was not found. Use the id shown in the catalog, e.g. \`dell/poweredge-r650\`.`);
	const data = readYaml(file);
	const added = await addImages(dir, data).catch((e) => fail(`Could not process the photos: ${e.message}`));
	const linked = addVendorMedia(data);
	if (!added.length && !linked) fail('No photo attachments or viewer link found. Drag the image files into the photo fields.');
	writeYaml(file, data, 'device.schema.json');
	const what = [...added.map((a) => (a === 'gallery' ? 'gallery' : `${a} photo`)), ...(linked ? ['3D viewer link'] : [])];
	output('branch', `issue-${issue}-photos-${m}-${s}`);
	output('title', `Add ${what.join(' + ')} for ${data.manufacturer}/${data.model}`);
	output('path', relative(ROOT, dir).split('\\').join('/'));
	output('summary', `Adds ${what.join(', ')} to \`${m}/${s}\` from #${issue}.`);
	process.exit(0);
}

// ---------------------------------------------------------------- new device

const manufacturerName = get('Manufacturer');
const model = get('Model').replace(new RegExp(`^${manufacturerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '');
if (!manufacturerName || !model) fail('Manufacturer and Model are required.');

let manufacturer = findManufacturer(manufacturerName);
if (!manufacturer) {
	manufacturer = slugify(manufacturerName);
	writeYaml(join(ROOT, 'manufacturers', `${manufacturer}.yaml`), { name: manufacturerName, slug: manufacturer }, 'manufacturer.schema.json');
}
const slug = slugify(model);
const dir = join(ROOT, 'devices', manufacturer, slug);
if (existsSync(join(dir, 'device.yaml'))) fail(`\`${manufacturer}/${slug}\` already exists. Use the "Correct a device" or "Add photos" form instead.`);

const category = get('Category');
if (!CATEGORIES[category]) fail(`Unknown category \`${category}\`.`);
const u = num(get('Height in rack units (U)')) ?? 1;
const mounting = get('Mounting').split(' ')[0] || (u > 0 ? 'rack' : 'other');
const [width, height, depth] = nums(get('Dimensions W x H x D (mm)'));
const [typical, max] = nums(get('Power draw (W)'));
const psuText = get('Power supplies');
const psu = psuText.match(/(\d+)\s*[x×*]\s*(\d+)\s*w/i);
const capacity = get('PDU / UPS capacity');
const ports = parsePorts(get('Network & console ports'));
const power = parsePowerConnectors(get('Power inlets / outlets'));
const fullDepth = get('Full depth?');
const airflow = get('Airflow');

const data = {
	manufacturer,
	model,
	slug,
	category,
	form_factor: mounting,
	part_numbers: get('Part numbers / SKUs') ? [...new Set(get('Part numbers / SKUs').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))] : undefined,
	u_height: u,
	full_depth: fullDepth === 'yes' ? true : fullDepth === 'no' ? false : undefined,
	dimensions: width || height || depth ? { width_mm: width, height_mm: height, depth_mm: depth } : undefined,
	weight_kg: num(get('Weight (kg)')),
	airflow: airflow && airflow !== 'unknown' ? airflow : undefined,
	power: {
		typical_w: max !== undefined ? typical : undefined,
		max_w: max ?? typical,
		psu_count: psu ? Number(psu[1]) : num(psuText),
		psu_rating_w: psu ? Number(psu[2]) : undefined,
		psu_redundancy: psuText.match(/\b(\d\+\d|n\+n|n\+1)\b/i)?.[1]?.toUpperCase().replace(/^(\d)\+(\d)$/, '$1+$2'),
		capacity_va: num(capacity.match(/(\d[\d.,]*)\s*va/i)?.[1]),
		capacity_w: num(capacity.match(/(\d[\d.,]*)\s*w\b/i)?.[1]),
		input_current_a: num(capacity.match(/(\d[\d.,]*)\s*a\b/i)?.[1]),
		phase: /3[- ]?(phase|ph)|three/i.test(capacity) ? 'three' : /1[- ]?(phase|ph)|single/i.test(capacity) ? 'single' : undefined,
		outlet_count: power.power_outlets.length || undefined
	},
	...ports,
	...power,
	links: {
		datasheet: url(get('Datasheet URL')),
		product_page: url(get('Product page URL')),
		media: url(get('Vendor 3D / 360° viewer link')) ? [{ kind: '3d-viewer', url: url(get('Vendor 3D / 360° viewer link')) }] : undefined
	},
	comments: get('Anything else') || undefined,
	source: { origin: 'community', url: process.env.ISSUE_URL || undefined }
};

const prune = (o) => {
	for (const k of Object.keys(o)) {
		const v = o[k];
		if (v === undefined || v === '' || Number.isNaN(v) || (Array.isArray(v) && !v.length)) delete o[k];
		else if (v && typeof v === 'object' && !Array.isArray(v)) {
			prune(v);
			if (!Object.keys(v).length) delete o[k];
		}
	}
	return o;
};
prune(data);

mkdirSync(dir, { recursive: true });
try {
	await addImages(dir, data);
} catch (e) {
	rmSync(dir, { recursive: true, force: true });
	fail(`Could not process the photos: ${e.message}`);
}
writeYaml(join(dir, 'device.yaml'), data, 'device.schema.json');
if (!readdirSync(dir).length) rmSync(dir, { recursive: true });

output('branch', `issue-${issue}-${manufacturer}-${slug}`.slice(0, 100));
output('title', `Add ${manufacturerName} ${model}`);
output('path', `devices/${manufacturer}/${slug}`);
output('summary', `Adds \`${manufacturer}/${slug}\` from #${issue}. Port names are generic (Port 1..n); rename them to the labels printed on the device if you can.`);
