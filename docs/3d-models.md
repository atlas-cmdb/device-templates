# 3D models, interior photos and vendor viewers

Atlas' 3D/VR view looks best with real geometry and real photos: a server you can open to see DIMMs, CPUs, fans and PSUs. This page explains what we store, what we only link to, and how to make models that work like the polished vendor viewers.

## What we store and what we only link

| | Stored here (CC0 unless marked) | Linked only |
|---|---|---|
| Photos you took (front, rear, **interior**, gallery) | ✔ `images.*` | |
| 3D models you scanned or modelled | ✔ `model_3d` + `model_3d_info` | |
| Models generated from template data | ✔ `model_3d_info.method: generated` | |
| Vendor 3D / 360° / AR viewers, product photos, CAD downloads | ✘ copyrighted | ✔ `links.media` |

Vendor media (Dell, HPE, Cisco, Lenovo…) is owned by the vendor or their agency. Republishing it here would infringe their copyright and mislabel it as public domain, so we **link to it** instead. Files that are stored here under another licence (for example manufacturer renders) must say so in `images.license` / `model_3d_info.license` with a `credit`; everything without such a field is CC0:

```yaml
links:
  media:
    - kind: 3d-viewer          # 3d-viewer | 360-view | gallery | cad | video | interior-tour | ar
      label: 3D & AR viewer (exterior + interior)
      url: https://www.dell.com/.../poweredge-r750
    - kind: cad
      format: step
      url: https://vendor.example/downloads/r750-step
```

The catalog shows these as external buttons ("hosted by dell.com, not part of this library"), and Atlas can do the same.

## How vendor 3D viewers work (and how we mirror it with open formats)

We looked at how Dell's product page does it (PowerEdge R750). Their viewer is a separate web app by a 3D agency, embedded in an iframe, running a proprietary WebGL2 engine. In outline:

- **Geometry is split into many parts.** A few hundred small binary chunks, one per part, plus an XML scene tree with ~400 materials. Parts load progressively.
- **Textures arrive in two levels of detail.** A low-resolution WebP set first, then a sharp set, so the model appears quickly and then gets crisp.
- **"See inside" is display layers, not magic.** The full interior is modelled, and the viewer toggles named layers on and off: `Top_Cover`, `Front_Bezel`, `Internal`, `Heatsink`, `Dimensions`.
- **Guided tour = camera bookmarks.** Named camera positions such as Front, Rear, Interior, Memory, Processor and Fans, which the side menu flies to.
- **AR** via WebXR on supported phones.
- In total about 7 MB for one server.

Our open equivalent uses **one glTF 2.0 `.glb`** and two metadata fields:

| Vendor viewer | Our `.glb` + `model_3d_info` |
|---|---|
| Part chunks + XML scene tree | One `.glb` with **named nodes** (Draco or Meshopt compression welcome) |
| Display layers (`Top_Cover_ON/OFF`…) | `layers: { top_cover: [Lid], front_bezel: [Bezel], heatsinks: [...] }` |
| Camera bookmarks | `views: { interior: Cam_Interior, memory: Cam_DIMM, ... }`: glTF camera nodes |
| Low-res then high-res textures | Optional `lod: model-lod1.glb` for racks seen from afar; KTX2/WebP textures |
| WebXR AR | Atlas' three.js scene supports WebXR; any `.glb` also works in `<model-viewer>` |

```yaml
model_3d: model.glb
model_3d_info:
  method: scan                 # scan | modelled | generated
  includes_interior: true
  layers:
    top_cover: [Lid]
    front_bezel: [Bezel]
    air_shroud: [Shroud]
  views:
    hero: Cam_Hero
    interior: Cam_Interior
    memory: Cam_DIMM
    psu: Cam_PSU
  lod: model-lod1.glb
  triangles: 180000
  credit: "@octocat"
```

`npm run validate` checks that the file is real glTF 2.0 binary, at most 8 MB, and that every layer node and view camera exists in the model.

## Model conventions

- **Units:** metres. **Origin:** front-bottom-left corner of the chassis. **+Z:** towards the rear, **+Y:** up. The front face sits at z = 0, so Atlas can drop it into a rack unit without adjustment.
- The **body** matches the template's `dimensions`. Rack ears are a separate node (`Ears`) so viewers can hide them.
- Name nodes after the components in the template where possible (`PSU1`, `Slot_1`, `Fan_3`). Viewers can then link 3D parts to hotspots and ports.
- Node names used in `layers`/`views` must not contain spaces or `. : / [ ]`: three.js rewrites such names on load (Blender's `Cube.001` becomes `Cube001`), so lookups by name would fail. The validator checks this.
- **Closed from every side.** Atlas users orbit around devices and look up at them in VR, so the bottom, sides and rear must have outward-facing surfaces. A product-page viewer never shows the underside; models made for one often have a single-sided bottom pan that disappears from below. Fix the normals, or set the material to `doubleSided`.
- **Decals** (labels, slot numbers, perforation masks) that lie exactly on another surface need a depth offset, or they flicker or vanish. Either lift them about 0.2 mm off the surface, or set node `extras: { "polygonOffset": -5 }`, which Atlas applies.
- **Size budget:** under 8 MB and preferably under 200k triangles; provide an `lod` model under 20k triangles for full-room VR. Compress with [gltf-transform](https://gltf-transform.dev): `gltf-transform optimize in.glb model.glb --compress draco --texture-compress webp`.
- **Textures:** PBR metal/roughness, 2048 px maximum. Reuse the template's own `front.webp` / `rear.webp` on the faceplates where you can.

## Making a model

- **Scan it.** A phone LiDAR or photogrammetry app (Polycam, Scaniverse, RealityScan, or Meshroom on desktop) gives a textured mesh in minutes. Scan with the lid on, then again with the lid off, and split the lid into its own node in Blender.
- **Model it.** Blender with the template dimensions; use the faceplate photos as textures. Low-poly with good textures beats high-poly without them.
- **Generated.** Boxes from `dimensions`/`u_height` with the front/rear photos mapped on. Atlas already does this at runtime; a generator that writes these `.glb` files is planned.

Never trace or convert a vendor's 3D model or CAD file into a contribution. That is still their work.

## Interior and gallery photos

Interior photos are just as valuable as 3D models, and much easier to make:

- `images.interior`: top-down, straight on, lid off, **front of the server at the bottom of the photo**, cropped to the chassis outline. Viewers can map it on the top face when the lid is hidden: a convincing "open server" without a 3D model.
- `images.gallery`: up to 12 extra photos (angled shots, port close-ups, labels, internals), each with an optional `caption` and `view`.

Drop files named `interior.jpg`, `gallery-*.jpg` or `photo-*.jpg` next to `device.yaml` and run `npm run images`. Or use the [Add photos](../../../issues/new?template=2-add-photos.yml) form. See [photography.md](photography.md).
