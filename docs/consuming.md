# Consuming the dataset

All data is static JSON plus images under `https://atlas-cmdb.github.io/device-templates/` (GitHub Pages, `Access-Control-Allow-Origin: *`). Types: [`types/index.d.ts`](../types/index.d.ts). Schemas: [`schema/`](../schema).

## Files

| Path | Notes |
|---|---|
| `version.json` | `{ format_version, commit, generated_at, stats }`. Poll this (tiny) and refetch the manifest when `commit` changes. |
| `manifest.json` | Every device, module and rack as a summary row, plus `categories` and `manufacturers` (with aliases). |
| `<path>` from a row | Full template JSON. Image paths are relative to `base_url`; `image_urls` has them absolute. |
| `manufacturers.json` | Manufacturers with website, parent and per-kind counts. |

`format_version` is bumped only for breaking changes; new optional fields can appear at any time.

## Searching

Each row has a `search` string (lower-case manufacturer name, model, part numbers, aliases, slug). Manufacturer aliases (`HP` → `hpe`, `Liebert` → `vertiv`) are in `manifest.manufacturers`; join on `manufacturer`. A simple, fast search over ~8k rows:

```ts
const aliases = new Map(manifest.manufacturers.map((m) => [m.slug, [m.name, ...(m.aliases ?? [])].join(' ').toLowerCase()]));
function search(q: string, category?: string) {
	const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
	return manifest.devices.filter((d) =>
		(!category || d.category === category) &&
		terms.every((t) => d.search.includes(t) || aliases.get(d.manufacturer)!.includes(t))
	);
}
```

Sort photographed (`images`) and `verified` rows first; they give the best result in a rack view.

## Caching and updates

- Each row's `rev` changes when the template **or any of its files** changes. Store `{ id, rev }` with whatever you copy into your own database and compare on sync.
- Prefer copying images into your own storage when a user picks a template, rather than hot-linking them for every render.
- Offline / air-gapped: download the `.tar.gz` from a [release](https://github.com/atlas-cmdb/device-templates/releases) and serve it from any static host; set your base URL accordingly.

## Atlas CMDB mapping

`atlas_type` on device rows and documents is the Atlas DCIM type (`src/lib/client/types/dcim.types.ts`). Categories without an Atlas equivalent (patch panels, blanks, shelves, media converters) have no `atlas_type`.

| Template field | Atlas `dcim` field |
|---|---|
| `atlas_type` | `type` |
| `manufacturer_name`, `model` | `manufacturer`, `model` |
| `u_height` | `rack_units` |
| `power.typical_w` → `power.max_w` → Σ `power_ports[].allocated_draw_w` | `power_consumption` (planned draw) |
| `weight_kg` | `weight` |
| `interfaces.length` (non-mgmt) | `port_count` |
| `power.capacity_w` | `power_capacity` (PDU / UPS) |
| `power.outlet_count` | `outlet_count` |
| `image_urls.front` / `.rear` | `images.front` / `images.back` (copy into Atlas storage) |
| `full_depth`, `airflow`, `dimensions.depth_mm` | depth and thermal hints for the 3D view |
| `images.hotspots` | clickable regions (drive bays, PSUs, blade slots) |
| `images.interior` | texture for the top face while the lid is "open" |
| `model_3d_url` (+ `model_3d_lod_url`) | replace the procedural box in the 3D/VR view; hide `model_3d_info.layers.top_cover` to show the interior and fly to `model_3d_info.views.*` cameras |
| `links.media[]` | "View in 3D on dell.com"-style buttons that open the vendor page; don't embed or proxy vendor media |

Manifest rows carry `model_3d`, `gallery` (photo count) and `media` (e.g. `["3d-viewer"]`), so a picker can badge "3D" / "inside" without fetching every template.

Suggested flow in Atlas: when adding a DCIM asset, offer a "Pick from library" search backed by `manifest.json`. On selection, fetch the template, prefill the fields above, download the images into the asset's files, and remember `template_id` + `template_rev` so Atlas can offer updates later.
