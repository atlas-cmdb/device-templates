// Field-level ownership for imported templates.
//
// An importer "owns" the fields it wrote (source.upstream_fields) and hashes only those
// (source.import_hash). That gives three guarantees:
//   - re-importing unchanged upstream data writes nothing;
//   - fields added by people or by other importers (verified, power.typical_w, hotspots, ...)
//     survive every re-import, and do not stop upstream updates;
//   - if someone edits an owned field, the importer stops touching that file and reports it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { KINDS, ROOT, hashOf, readYaml, writeYaml } from './repo.mjs';

/** Objects whose keys are owned individually, so two sources can each fill part of them. */
const NESTED = new Set(['power', 'images', 'links', 'dimensions', 'thermal', 'lifecycle', 'management']);
/** Set when a template is created, never changed by later imports (humans curate these). */
const CREATE_ONLY = new Set(['category', 'form_factor', 'kind']);

export function getPath(obj, path) {
	return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
	const keys = path.split('.');
	let o = obj;
	for (const k of keys.slice(0, -1)) o = o[k] ??= {};
	o[keys.at(-1)] = value;
}
function deletePath(obj, path) {
	const keys = path.split('.');
	const parent = keys.length > 1 ? getPath(obj, keys.slice(0, -1).join('.')) : obj;
	if (parent) delete parent[keys.at(-1)];
	if (keys.length > 1 && parent && !Object.keys(parent).length) delete obj[keys[0]];
}

/** Leaf paths an importer writes for this data (nested objects split per key). */
export function ownedPaths(data) {
	const paths = [];
	for (const [key, value] of Object.entries(data)) {
		if (key === 'source' || key === '$schema' || CREATE_ONLY.has(key)) continue;
		if (NESTED.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
			for (const sub of Object.keys(value)) paths.push(`${key}.${sub}`);
		} else paths.push(key);
	}
	return paths.sort();
}

export const ownedHash = (data, paths) => hashOf(Object.fromEntries(paths.map((p) => [p, getPath(data, p) ?? null])));

/** Recompute ownership after a script changes owned data itself (e.g. drops a broken image). */
export function restamp(data) {
	const src = data.source;
	if (!src?.upstream_fields) return data;
	src.upstream_fields = src.upstream_fields.filter((p) => getPath(data, p) !== undefined);
	src.import_hash = ownedHash(data, src.upstream_fields);
	return data;
}

/**
 * Create or update a template owned by `incoming.source.origin`.
 * Returns 'written' | 'unchanged' | 'kept' (owned fields edited by a person) | 'foreign'
 * (the file belongs to another origin; the caller may enrich it instead).
 */
export function upsertTemplate(kind, manufacturer, slug, incoming, { dryRun = false } = {}) {
	const file = join(ROOT, KINDS[kind].dir, manufacturer, slug, KINDS[kind].file);
	const origin = incoming.source.origin;
	const paths = ownedPaths(incoming);
	const newHash = ownedHash(incoming, paths);

	if (!existsSync(file)) {
		incoming.source = { ...incoming.source, upstream_fields: paths, import_hash: newHash };
		if (!dryRun) writeYaml(file, incoming, KINDS[kind].schema);
		return { status: 'written', file, data: incoming };
	}

	const current = readYaml(file);
	const src = current.source ?? {};
	if (src.origin !== origin) return { status: 'foreign', file, data: current };

	let oldPaths = src.upstream_fields;
	if (!oldPaths) {
		// Files from before field-level ownership hashed the whole body.
		const { source, ...body } = current;
		if (src.import_hash !== hashOf(body)) return { status: 'kept', file, data: current };
		oldPaths = ownedPaths(current);
	} else if (ownedHash(current, oldPaths) !== src.import_hash) {
		return { status: 'kept', file, data: current };
	}
	const samePaths = oldPaths.length === paths.length && oldPaths.every((p, i) => p === paths[i]);
	if (src.upstream_fields && samePaths && src.import_hash === newHash) return { status: 'unchanged', file, data: current };

	const merged = structuredClone(current);
	for (const p of oldPaths) deletePath(merged, p);
	for (const p of paths) setPath(merged, p, structuredClone(getPath(incoming, p)));
	for (const key of CREATE_ONLY) if (merged[key] === undefined && incoming[key] !== undefined) merged[key] = incoming[key];
	merged.source = {
		...incoming.source,
		// Keep a person's review: once they removed a field from `inferred`, don't add it back.
		inferred: src.inferred,
		also_from: src.also_from,
		upstream_fields: paths,
		import_hash: newHash
	};
	if (!merged.source.inferred?.length) delete merged.source.inferred;
	if (!merged.source.also_from?.length) delete merged.source.also_from;
	if (!dryRun) writeYaml(file, merged, KINDS[kind].schema);
	return { status: 'written', file, data: merged };
}

/**
 * Fill gaps in a template owned by someone else with data from `origin`. Never overwrites a
 * value that is already there. Returns the list of paths that were filled.
 */
export function enrichTemplate(kind, file, extra, origin, { dryRun = false } = {}) {
	const current = readYaml(file);
	const filled = [];
	for (const p of ownedPaths(extra)) {
		if (getPath(current, p) !== undefined) continue;
		setPath(current, p, structuredClone(getPath(extra, p)));
		filled.push(p);
	}
	if (!filled.length) return { filled, data: current };
	current.source ??= { origin: 'community' };
	current.source.also_from = [...new Set([...(current.source.also_from ?? []), origin])];
	if (!dryRun) writeYaml(file, current, KINDS[kind].schema);
	return { filled, data: current };
}
