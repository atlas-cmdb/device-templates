#!/usr/bin/env node
// Convert contributed images to the stored format (WebP, capped size) and update the YAML references.
//
//   npm run images                     # every template
//   npm run images -- devices/dell/poweredge-r760
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, convertImage, imageInfo } from './lib/images.mjs';
import { IMAGE_SIDES, KINDS, ROOT, listTemplates, readYaml, writeYaml } from './lib/repo.mjs';

const { positionals } = parseArgs({ allowPositionals: true });
const prefixes = positionals.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''));
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const SOURCE_EXT = /\.(png|jpe?g|webp|gif|tiff?|heic|avif|bmp)$/i;
let changed = 0;

for (const kind of Object.keys(KINDS)) {
	for (const t of listTemplates(kind)) {
		if (prefixes.length && !prefixes.some((p) => rel(t.dir).startsWith(p))) continue;
		if (!existsSync(t.file)) continue;
		const data = readYaml(t.file);
		let dirty = false;

		// Pick up photos dropped in as front.jpg / Rear.PNG / etc. even if not referenced yet.
		for (const f of readdirSync(t.dir)) {
			const side = IMAGE_SIDES.find((s) => f.toLowerCase().startsWith(`${s}.`));
			if (side && SOURCE_EXT.test(f) && !data.images?.[side]) {
				data.images = { ...(data.images ?? {}), [side]: f };
				dirty = true;
			}
			// Extra photos dropped in as gallery-*.jpg / photo-*.jpg go to the gallery.
			const isGallery = /^(gallery|photo)[-_]?[\w-]*\.[a-z]+$/i.test(f) && SOURCE_EXT.test(f);
			if (isGallery && !(data.images?.gallery ?? []).some((g) => g.file === f)) {
				data.images = { ...(data.images ?? {}), gallery: [...(data.images?.gallery ?? []), { file: f }] };
				dirty = true;
			}
		}

		// Gallery photos are stored as gallery-<n>.webp, in list order.
		for (const [i, g] of (data.images?.gallery ?? []).entries()) {
			const src = join(t.dir, g.file);
			if (!existsSync(src)) continue;
			const target = `gallery-${i + 1}.webp`;
			if (g.file !== target && data.images.gallery.some((o) => o !== g && o.file === target)) {
				console.warn(`! ${rel(src)}: ${target} is used by another gallery entry; reorder the gallery list and run again`);
				continue;
			}
			const info = await imageInfo(src).catch(() => null);
			if (g.file === target && info?.format === 'webp' && Math.max(info.width, info.height) <= MAX_IMAGE_SIDE && statSync(src).size <= MAX_IMAGE_BYTES) continue;
			const tmp = join(t.dir, `.gallery-${i + 1}.tmp.webp`);
			await convertImage(src, tmp);
			if (src !== join(t.dir, target)) rmSync(src);
			renameSync(tmp, join(t.dir, target));
			g.file = target;
			dirty = true;
			console.log(`~ ${rel(src)} -> ${target}`);
		}

		for (const side of IMAGE_SIDES) {
			const name = data.images?.[side];
			if (!name) continue;
			const src = join(t.dir, name);
			if (!existsSync(src)) continue;
			const target = `${side}.webp`;
			const info = await imageInfo(src).catch(() => null);
			const ok = name === target && info?.format === 'webp' && Math.max(info.width, info.height) <= MAX_IMAGE_SIDE && statSync(src).size <= MAX_IMAGE_BYTES;
			if (ok) continue;
			const tmp = join(t.dir, `.${side}.tmp.webp`);
			await convertImage(src, tmp);
			if (src !== join(t.dir, target)) rmSync(src);
			renameSync(tmp, join(t.dir, target));
			data.images[side] = target;
			dirty = true;
			console.log(`~ ${rel(src)} -> ${target}${info ? ` (${info.width}x${info.height} ${info.format})` : ''}`);
		}

		if (dirty) {
			writeYaml(t.file, data, KINDS[kind].schema);
			changed++;
		}
	}
}
console.log(changed ? `Updated ${changed} template(s).` : 'All images are already optimised.');
