# Contributing

Thanks for helping build an open library of data center hardware! There are two ways to contribute.

## 1. Without git: issue forms

| I want to… | Use |
|---|---|
| Add a device that is missing | [Add a device](../../issues/new?template=1-new-device.yml) |
| Add front/rear photos to an existing device | [Add photos](../../issues/new?template=2-add-photos.yml) |
| Fix wrong data | [Correct a device](../../issues/new?template=3-fix-device.yml) |
| Suggest a field, category or tool | [Feature request](../../issues/new?template=4-feature-request.yml) |

For **Add a device** and **Add photos**, a maintainer reviews the issue and adds the `approved` label. A bot then converts the form into template files, validates them, and opens a pull request that closes your issue. You can follow along there.

## 2. With git: pull requests

Requirements: Node.js 20+.

```sh
git clone https://github.com/atlas-cmdb/device-templates && cd device-templates
npm install

npm run new                         # asks manufacturer, model, category, U height
# edit devices/<manufacturer>/<model>/device.yaml (your editor autocompletes from the schema)
# drop photos next to it as front.jpg / rear.jpg

npm run images                      # converts photos to WebP, caps the size, updates the YAML
npm run validate                    # same checks CI runs
npm run build                       # optional: builds dist/ (open dist/index.html via a local server)
```

Then open a pull request. CI validates it and a maintainer reviews it.

### Rules of thumb

- **One folder per model**: `devices/<manufacturer>/<slug>/device.yaml`. The folder names must match `manufacturer` and `slug` in the file. Slugs are lowercase, digits and dashes (`poweredge-r650`).
- **Model names without the manufacturer**: `model: PowerEdge R650`, not `Dell PowerEdge R650`.
- **Check the manufacturer exists** in `manufacturers/` (by name *or* alias) before creating a new one. `npm run new` does this for you.
- **Variants**: if two SKUs differ only in PSU/optics/licence, keep one template and list the SKUs in `part_numbers`. If they differ physically (U height, ports, faceplate), make separate templates.
- **Numbers come from datasheets or the device**. Put the datasheet in `links.datasheet`.
- **Power**: `power.typical_w` / `max_w` are whole-device draw. Per-inlet ratings go on `power_ports[].maximum_draw_w`. PDUs and UPSes use `capacity_va` / `capacity_w` / `outlet_count`.
- **Ports**: use NetBox type slugs (`1000base-t`, `10gbase-x-sfpp`, `25gbase-x-sfp28`, `100gbase-x-qsfp28`, `iec-60320-c14`…). Name ports as printed on the device (`Gi1/0/1`, `Ethernet1`, `PSU1`).
- **Imported templates**: when you verify a guessed category, remove `category` from `source.inferred`. Adding fields (`verified`, `power.typical_w`, photos, hotspots…) never blocks the weekly NetBox sync. Correcting a field NetBox owns (listed in `source.upstream_fields`) makes the sync leave that file alone. Please also fix it upstream in NetBox if you can.
- Set `verified: true` only after checking the template against a datasheet **and** a photo or the device itself.

### Bulk: your openDCIM library

Running openDCIM? Its template library can be imported in one go, through the API or from template exports: `npm run import:opendcim -- --url https://your-opendcim`. Existing templates are only enriched, never overwritten. See [docs/opendcim.md](docs/opendcim.md).

### Photos

Photos make the biggest difference to the 3D/VR view. See **[docs/photography.md](docs/photography.md)**. In short: straight-on, crop to the faceplate *without* rack ears, sharp, evenly lit, front and rear. Only submit photos you took yourself; no vendor marketing images. Add yourself to `images.credit` if you'd like to be credited.

### Licence of contributions

Everything in the dataset is public domain under [CC0 1.0](LICENSE), the same as the NetBox library it builds on. By opening a pull request or issue with data or photos, you confirm that you created them (or that they are factual data from public datasheets) and that you dedicate them to the public domain under CC0. Code contributions to `scripts/`, `site/` and `types/` are MIT ([LICENSE-CODE](LICENSE-CODE)).

### 3D models, interior photos and vendor viewers

- **Interior photos** (lid off, top-down) and **gallery photos** are easy wins; see [docs/photography.md](docs/photography.md).
- **3D models**: a `model.glb` you scanned or modelled yourself, with toggleable layers (`top_cover`, `front_bezel`…) and camera views, like vendor viewers have. Conventions and tooling are in [docs/3d-models.md](docs/3d-models.md).
- **Vendor 3D/360°/AR viewers and CAD downloads**: add the URL under `links.media`. Never download or convert vendor media into the repository; it is copyrighted.

### Schema changes

Open a [feature request](../../issues/new?template=4-feature-request.yml) first. Schema changes must stay backwards compatible for consumers of `manifest.json` (add fields; don't rename or remove them). `format_version` only changes for breaking changes.

## Maintainers

- Triage: remove `needs-triage`, add `approved` to device/photo issues that are complete enough. The bot does the rest. If conversion fails it comments on the issue with the reason.
- Bot PRs (created with the workflow token) don't trigger CI themselves; the conversion workflow validates before opening them. Push an empty commit or close/reopen the PR if you want the full CI run.
- `sync-netbox.yml` opens a weekly `Sync NetBox devicetype-library` PR. Spot-check new categories before merging.
- To release an offline bundle: `git tag v2026.11.0 && git push --tags`.

## Code of conduct

Be kind and assume good intent. Maintainers may remove content or contributors that make the project unwelcoming.
