<p align="center">
  <a href="https://atlas-cmdb.github.io/device-templates/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/atlas-mark-dark.svg">
      <img src=".github/assets/atlas-mark-light.svg" alt="Atlas" width="64">
    </picture>
  </a>
</p>

<h1 align="center">Atlas Device Library</h1>

<p align="center">
  Open hardware templates and faceplate photos for <a href="https://github.com/atlas-cmdb">Atlas CMDB</a><br>
  <a href="https://atlas-cmdb.github.io/device-templates/"><b>Browse the catalog</b></a> ·
  <a href="docs/consuming.md">Use the data</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">
  <a href="https://github.com/atlas-cmdb/device-templates/actions/workflows/publish.yml"><img src="https://github.com/atlas-cmdb/device-templates/actions/workflows/publish.yml/badge.svg" alt="Publish catalog"></a>
  <a href="https://github.com/atlas-cmdb/device-templates/commits/main"><img src="https://img.shields.io/github/last-commit/atlas-cmdb/device-templates?label=last%20updated" alt="Last updated"></a>
  <a href="https://atlas-cmdb.github.io/device-templates/"><img src="https://img.shields.io/badge/catalog-atlas--cmdb.github.io-4DB6AC" alt="Catalog"></a>
</p>

An open library of data center hardware for DCIM tools: **servers, switches, routers, firewalls, storage, PDUs, UPSes, KVMs, patch panels, racks and modules**, with physical dimensions, power, ports and **front/rear faceplate images**. It is the central template repository for the [Atlas CMDB](https://github.com/atlas-cmdb) rack elevations and 3D/VR data center view, and is free for any other tool to use.

| | |
|---|---|
| Device templates | 6,100+ (1,600+ with photos) |
| Modules (PSUs, NICs, line cards, transceivers…) | 2,000+ |
| Rack / cabinet templates | 150+ |
| Manufacturers | 330+ |

## Use the data

Everything is published as static files on GitHub Pages (CORS enabled), rebuilt on every merge:

| URL | What |
|---|---|
| [`/manifest.json`](https://atlas-cmdb.github.io/device-templates/manifest.json) | **Search index** of every template in one request (~370 KB gzipped): id, model, category, U height, power, port counts, image paths, `rev` for caching. |
| `/devices/<manufacturer>/<slug>/device.json` | Full template as JSON, with absolute `image_urls`. Same layout for `/modules/…/module.json` and `/racks/…/rack.json`. |
| `/devices/<manufacturer>/<slug>/front.webp`, `rear.webp` | Faceplate images, cropped to the device face (no rack ears). |
| [`/version.json`](https://atlas-cmdb.github.io/device-templates/version.json) | Commit and stats, cheap to poll for updates. |
| `/schema/*.schema.json` | JSON Schemas. TypeScript types are in [`types/index.d.ts`](types/index.d.ts). |

Tagged releases attach the whole dataset as a `.tar.gz` for air-gapped installs. See [docs/consuming.md](docs/consuming.md) for search, caching and the Atlas integration.

```ts
const base = 'https://atlas-cmdb.github.io/device-templates/';
const manifest = await fetch(base + 'manifest.json').then((r) => r.json());
const hits = manifest.devices.filter((d) => d.search.includes('r650'));
const r650 = await fetch(base + hits[0].path).then((r) => r.json());
r650.u_height;          // 1
r650.atlas_type;        // "server"
r650.image_urls?.front; // https://…/devices/dell/poweredge-r650/front.webp
```

## Contribute

You don't need git to help:

- **[Add a device](../../issues/new?template=1-new-device.yml)**: fill in a form (only manufacturer and model are required). When a maintainer approves it, a bot opens the pull request for you.
- **[Add photos](../../issues/new?template=2-add-photos.yml)**: drag in front/rear photos of a device you have. This is the single most valuable contribution for 3D views.
- **[Correct a device](../../issues/new?template=3-fix-device.yml)**: wrong U height, depth, power or category.

Comfortable with git? Run `npm install`, then `npm run new` to scaffold a template, then `npm run validate`, and open a PR. See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Layout

```
manufacturers/<slug>.yaml                  name, aliases (HP ↔ HPE, Liebert ↔ Vertiv…), website
devices/<manufacturer>/<slug>/
    device.yaml                            the template (schema/device.schema.json)
    front.webp, rear.webp                  faceplate images (optional)
    interior.webp, gallery-*.webp          lid-off photo and extra photos (optional)
    model.glb                              3D model with an openable lid for VR (optional, see docs/3d-models.md)
modules/<manufacturer>/<slug>/module.yaml  PSUs, fans, NICs, line cards, transceivers
racks/<manufacturer>/<slug>/rack.yaml      cabinets and frames
schema/                                    JSON Schemas (your editor autocompletes from them)
scripts/                                   validate, build, import, scaffold, image tools
site/                                      the catalog page
```

A device template is plain YAML (trimmed example):

```yaml
manufacturer: dell
model: PowerEdge R650
slug: poweredge-r650
category: server          # maps onto Atlas DCIM types (server, network_switch, pdu, ups, …)
form_factor: rack         # rack | zero-u | blade | tower | …
u_height: 1
full_depth: true
weight_kg: 21
airflow: front-to-rear
power: { typical_w: 350, max_w: 1100, psu_count: 2, psu_redundancy: 1+1 }
interfaces:
  - { name: iDRAC9, type: 1000base-t, mgmt_only: true }
power_ports:
  - { name: PSU1, type: iec-60320-c14, maximum_draw_w: 1100 }
images: { front: front.webp, rear: rear.webp }
links: { datasheet: https://… }
```

Field reference: [docs/schema.md](docs/schema.md). Photo guidelines: [docs/photography.md](docs/photography.md).

## Where the data comes from

- **[NetBox devicetype-library](https://github.com/netbox-community/devicetype-library)** (CC0-1.0): the bulk of the templates and images, imported weekly by [`sync-netbox.yml`](.github/workflows/sync-netbox.yml). NetBox has no "what kind of device is this" field, so categories are inferred and marked `source.inferred: [category]` until someone checks them ([catalog filter "needs review"](https://atlas-cmdb.github.io/device-templates/)). The sync only updates the fields NetBox owns (`source.upstream_fields`): anything added here (`verified`, typical power, photos, hotspots) is kept, and a template whose NetBox fields someone corrected is left alone.
- **openDCIM installations**: the shared openDCIM template repository is offline, but every openDCIM install has its own template library. `npm run import:opendcim` reads one through the REST API or from template exports. New models are added, and existing ones are only *enriched* (typical wattage, photos, blade-slot hotspots), never overwritten. Run it on your openDCIM and send a PR. See [docs/opendcim.md](docs/opendcim.md).
- **The community**: you. Templates you add carry `source.origin: community`.

See [CREDITS.md](CREDITS.md).

## License

- **Data and images** (`devices/`, `modules/`, `racks/`, `manufacturers/`, `schema/`, and the published dataset): **[CC0 1.0](LICENSE)**, public domain. Use them for anything, commercial or not, without asking and without attribution. This is the same licence as the NetBox library, so data flows freely both ways.
- **Code** (`scripts/`, `site/`, `types/`): [MIT](LICENSE-CODE).
- **Images and 3D models may have a different licence.** When a template sets `images.license` or `model_3d_info.license` (with `credit`), those files keep that licence and are **not** CC0: for example manufacturer renders that are the vendor's copyright. Check these fields before reusing an image or model; the template data itself is still CC0. Currently: the front/rear renders of `ubiquiti/enterprise-firewall-core` and `ubiquiti/unifi-wan-switch` (© Ubiquiti Inc.).

Contributions are accepted under these terms: by contributing you dedicate your templates, photos and models to the public domain under CC0, unless you mark an image or model with its own licence as described above. Your own photos and models are always preferred; third-party files must carry `credit` and `license`, and are removed if the rights holder asks. Attribution isn't required, but it's welcome: photographers are credited in `images.credit`, and the sources are listed in [CREDITS.md](CREDITS.md).
