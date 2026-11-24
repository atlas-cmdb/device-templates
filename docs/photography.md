# Photo guidelines

Faceplate photos are drawn directly onto the front and rear of devices in rack elevations and the 3D/VR view. A good photo makes a rack look like the real thing; a skewed or uncropped one stands out immediately.

## Checklist

1. **Straight on.** Stand directly in front of the device at its height. Use your phone's grid lines; avoid wide-angle (0.5×) lenses, use 1× or 2× from a little further away.
2. **Whole face, nothing else.** Crop exactly to the faceplate edges. **No rack ears**, no neighbouring devices, no rails.
   - If you can't remove the ears, set `images.includes_ears: true` so viewers can compensate.
3. **Even light, no flash glare.** Turn off the flash; overhead DC lighting is fine. Avoid reflections on glossy bezels.
4. **Sharp and level.** Correct perspective/keystone in any photo editor (Snapseed, Lightroom, GIMP "Perspective"). The top and bottom edges must be horizontal.
5. **Typical configuration.** Bezel on or off: choose what operators usually see and mention it in the PR/issue. Blank drive slots are fine.
6. **Both sides if you can.** The rear (PSUs, ports) matters as much as the front for cabling and VR.
7. **Your own photos only.** Everything here is public domain ([CC0](../LICENSE)), so we can only accept photos you took yourself; vendor marketing renders are copyrighted. Photos of devices in your own rack are ideal. Blur or crop asset tags and hostnames if they are sensitive. You're credited in `images.credit`.

## Interior and extra photos

- **Interior (`images.interior`)**: lid off, shot from straight above, **front of the device at the bottom of the photo**, cropped to the chassis outline. Viewers use it to "open" the server without a 3D model. Drop it in as `interior.jpg`.
- **Gallery (`images.gallery`)**: up to 12 extra photos (angled hero shot, port close-ups, labels, internals). Drop them in as `gallery-*.jpg` or `photo-*.jpg`; add a `caption` afterwards if you like.

3D models and vendor viewers are covered in [3d-models.md](3d-models.md).

## Size and format

- Any common format works for submissions. `npm run images` (or the issue bot) converts to **WebP**, longest side at most **2400 px**, under 1.5 MB.
- Aim for at least **1200 px wide** for a 1U device so port labels stay readable in VR.
- Expected aspect ratio for a 19" device is about `10 : U-height`, e.g. ~10:1 for 1U, ~5:1 for 2U. The validator warns when a photo is far off, which usually means it isn't cropped.

## Hotspots (optional)

Mark clickable regions such as drive bays, PSUs and blade slots as fractions (0–1) of the image, so viewers can highlight them:

```yaml
images:
  front: front.webp
  rear: rear.webp
  hotspots:
    - { label: PSU1, side: rear, kind: psu, component: PSU1, rect: { x: 0.86, y: 0.08, w: 0.13, h: 0.42 } }
    - { label: Bay 0, side: front, kind: drive_bay, rect: { x: 0.12, y: 0.10, w: 0.07, h: 0.80 } }
```

`x`/`y` is the top-left corner. Any image editor that shows pixel coordinates works: divide by the image width/height.
