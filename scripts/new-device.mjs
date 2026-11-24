#!/usr/bin/env node
// Scaffold a new template so contributors only fill in values.
//
//   npm run new                                              # asks questions
//   npm run new -- --manufacturer "Dell" --model "PowerEdge R760" --category server --u 2
//   npm run new -- --kind rack --manufacturer "APC" --model "NetShelter SX 42U" --u 42
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { CATEGORIES } from './lib/categories.mjs';
import { KINDS, ROOT, listManufacturers, readYaml, slugify, writeYaml } from './lib/repo.mjs';

const { values: opts } = parseArgs({
	options: {
		kind: { type: 'string', default: 'device' },
		manufacturer: { type: 'string' },
		model: { type: 'string' },
		category: { type: 'string' },
		u: { type: 'string' },
		'part-number': { type: 'string' }
	}
});

const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
async function ask(question, current, fallback) {
	if (current) return current;
	if (!rl) {
		if (fallback !== undefined) return fallback;
		console.error(`missing --${question.toLowerCase().split(' ')[0]}`);
		process.exit(1);
	}
	const answer = (await rl.question(`${question}${fallback !== undefined ? ` [${fallback}]` : ''}: `)).trim();
	return answer || fallback;
}

const kind = opts.kind;
if (!KINDS[kind]) {
	console.error(`--kind must be one of ${Object.keys(KINDS).join(', ')}`);
	process.exit(1);
}

// Match existing manufacturers by slug, name or alias so people don't create duplicates.
const manufacturerInput = await ask('Manufacturer', opts.manufacturer);
const known = listManufacturers().map(({ slug, file }) => ({ slug, ...readYaml(file) }));
const needle = manufacturerInput.toLowerCase();
const match = known.find((m) => m.slug === slugify(manufacturerInput) || m.name.toLowerCase() === needle || (m.aliases ?? []).some((a) => a.toLowerCase() === needle));
const manufacturer = match?.slug ?? slugify(manufacturerInput);
if (!match) {
	writeYaml(join(ROOT, 'manufacturers', `${manufacturer}.yaml`), { name: manufacturerInput, slug: manufacturer }, 'manufacturer.schema.json');
	console.log(`+ manufacturers/${manufacturer}.yaml (new manufacturer; add website/aliases if you can)`);
} else if (match.slug !== slugify(manufacturerInput)) {
	console.log(`Using existing manufacturer '${match.name}' (${match.slug}).`);
}

const model = await ask('Model (without manufacturer name)', opts.model);
const slug = slugify(model);
const dir = join(ROOT, KINDS[kind].dir, manufacturer, slug);
const file = join(dir, KINDS[kind].file);
if (existsSync(file)) {
	console.error(`${relative(ROOT, file)} already exists; edit it instead.`);
	process.exit(1);
}

let data;
if (kind === 'device') {
	const category = await ask(`Category (${Object.keys(CATEGORIES).join(', ')})`, opts.category, 'server');
	if (!CATEGORIES[category]) {
		console.error(`unknown category '${category}'`);
		process.exit(1);
	}
	const u = Number(await ask('Rack units (0 for zero-U / blades)', opts.u, '1'));
	data = {
		manufacturer,
		model,
		slug,
		category,
		form_factor: u > 0 ? 'rack' : category === 'pdu' ? 'zero-u' : 'other',
		part_numbers: opts['part-number'] ? [opts['part-number']] : undefined,
		u_height: u,
		full_depth: true,
		airflow: 'front-to-rear',
		power: category === 'pdu' || category === 'ups' ? { capacity_va: undefined, outlet_count: undefined } : { typical_w: undefined, max_w: undefined, psu_count: undefined },
		interfaces: [],
		power_ports: [],
		links: { datasheet: undefined },
		source: { origin: 'community' }
	};
} else if (kind === 'rack') {
	data = { manufacturer, model, slug, form_factor: '4-post-cabinet', rack_width: 19, u_height: Number(await ask('Rack units', opts.u, '42')), source: { origin: 'community' } };
} else {
	data = { manufacturer, model, slug, kind: await ask('Module kind (psu, fan, nic, line_card, transceiver, ...)', opts.category, 'other'), source: { origin: 'community' } };
}
rl?.close();

// Drop placeholders that would fail validation, but leave empty lists as hints.
const prune = (o) => {
	for (const k of Object.keys(o)) {
		if (o[k] === undefined) delete o[k];
		else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) {
			prune(o[k]);
			if (!Object.keys(o[k]).length) delete o[k];
		}
	}
	return o;
};
prune(data);
for (const k of ['interfaces', 'power_ports']) if (Array.isArray(data[k]) && !data[k].length) delete data[k];

writeYaml(file, data, KINDS[kind].schema);
console.log(`+ ${relative(ROOT, file).split('\\').join('/')}

Next:
  1. Fill in what you know (see docs/schema.md). Your editor autocompletes fields from the schema.
  2. Add photos as front.jpg / rear.jpg next to it and reference them under images:
  3. npm run images   (converts to WebP and caps the size)
  4. npm run validate`);
