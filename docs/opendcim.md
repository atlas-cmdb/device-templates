# Importing from openDCIM

openDCIM's shared template repository (`repository.opendcim.org`) is offline, and its contents were never published elsewhere. Only the list of manufacturer names survives in the Internet Archive. What *does* still exist is the template library inside every openDCIM installation. Many sites have years of carefully measured templates and photos there. This importer brings them into this library, or into your own fork for an Atlas migration.

## Run it

```sh
npm install

# Live, read-only, through the openDCIM REST API (v1)
OPENDCIM_USER=apiuser OPENDCIM_APIKEY=xxxxx npm run import:opendcim -- --url https://dcim.example.org

# Or from template export files (Device Templates → select template → Export).
# One JSON file per template, pictures embedded. Pass files or folders:
npm run import:opendcim -- ~/Downloads/opendcim-exports/

npm run validate
```

| Option | |
|---|---|
| `--units english\|metric` | openDCIM stores weight in the site's units (*Configuration → mUnits*). Default `english` (lbs). |
| `--images` | Also import front/rear pictures. **Only for photos you are allowed to publish under CC0** (taken by your team). Leave it off for pictures that came from vendor sites or the old shared repository. |
| `--credit "Example Corp DC team"` | `images.credit` for imported pictures. |
| `--dry-run` | Report what would change without writing. |

If your openDCIM authenticates through Apache/LDAP/SAML, use an API key user (`UserID` + `APIKey` headers); the importer only issues `GET` requests.

## What gets converted

| openDCIM | Template |
|---|---|
| Manufacturer name | matched against `manufacturers/` by name **and alias** (`HP` → `hpe` when the model lives there) |
| Model, Height | `model`, `u_height` (0 → `zero-u` for CDUs, `blade` otherwise) |
| DeviceType | `category`: Server → `server`, Appliance → `appliance`, Storage Array → `storage_array`, Switch → `network_switch`, Chassis → `blade_chassis`, Patch Panel → `patch_panel`, CDU → `pdu`, Sensor → `environmental_monitor`. *Physical Infrastructure* is guessed (blank, shelf, cable management…) and flagged in `source.inferred`. |
| Weight | `weight_kg` (converted from lbs unless `--units metric`) |
| Wattage | `power.typical_w` |
| PSCount, power ports | `power.psu_count`, `power_ports` |
| Data ports (connector, rate, protocol, colour) | `interfaces` with NetBox types (`CAT6` + `10 Gbps` → `10gbase-t`, `LC` + `10 Gbps` → `10gbase-x-sfpp`); management ports detected by label. Patch panels become `front_ports` + `rear_ports` (`8p8c`, `lc`, `sc`, `mpo`…). |
| NumPorts without port definitions | generic `Port 1..n` of type `other`, flagged in `source.inferred` |
| ChassisSlots / RearChassisSlots | `device_bays` (`Slot n`, `Rear slot n`) |
| Slot X/Y/W/H (pixels on the picture) | `images.hotspots` (fractions), only next to the picture they were drawn on |
| Front/Rear picture | `front.webp` / `rear.webp` (with `--images`) |
| Notes | `comments` |

Not available through the API or exports, so not imported: CDU (PDU) SNMP OID profiles and sensor templates. Add those by hand under `management.snmp`.

## Existing templates are enriched, not duplicated

Most openDCIM templates describe hardware that is already here (usually from NetBox). The importer matches on manufacturer + model (and aliases/part numbers) and then **only fills fields that are still empty**: typically `power.typical_w`, weight, photos and blade-slot hotspots. It never overwrites existing values. The file records `source.also_from: [opendcim]`.

When the model only matches *variants* (openDCIM `DCS-7050SX-64`, library `DCS-7050SX-64-F` and `-R`), nothing is imported for it. The run lists these as `?` lines so you can add the name as an `alias` to the right variant and run it again.

Templates that are new to the library are created with `source.origin: opendcim`. Re-running the import updates only the fields it owns (`source.upstream_fields`) and leaves anything you edited alone, exactly like the NetBox sync.

## Contributing the result

1. Run the import on a branch and check `git status` / the `+`, `~` and `?` lines in the output.
2. `npm run validate`, then fix categories flagged in `source.inferred`.
3. Open a pull request. Mention which organisation's openDCIM it came from if you want credit in [CREDITS.md](../CREDITS.md).

Template data is factual (dimensions, power, ports) and fine to share. Photos are only fine if your team took them; the CC0 licence of this repository applies to everything you submit.
