# Template field reference

The authoritative definition is [`schema/device.schema.json`](../schema/device.schema.json). Editors with the YAML language server (VS Code "YAML" extension, JetBrains IDEs) autocomplete and validate from it through the `# yaml-language-server` line at the top of each file. Only the **bold** fields are required.

## Identity

| Field | Example | Notes |
|---|---|---|
| **`manufacturer`** | `dell` | Slug of `manufacturers/<slug>.yaml`; equals the parent folder. |
| **`model`** | `PowerEdge R650` | As printed by the vendor, without the manufacturer name. |
| **`slug`** | `poweredge-r650` | Equals the folder name. Unique per manufacturer. |
| **`category`** | `server` | See [categories](#categories). |
| **`form_factor`** | `rack` | `rack`, `zero-u` (vertical, side channel), `blade`, `tower`, `desktop`, `wall`, `din-rail`, `other`. |
| `family` | `PowerEdge` | Product line. |
| `part_numbers` | `[210-AYJZ]` | Orderable SKUs. Searchable. |
| `aliases` | `[R650]` | Other names, OEM rebrands. Searchable. |
| `description` | | One line. |

## Physical

| Field | Notes |
|---|---|
| **`u_height`** | Rack units; `0` for zero-U and blades; halves allowed. |
| `full_depth` | `true` if it blocks the rear of its units (servers); `false` for front-only (most switches, patch panels). |
| `rack_width` | `19` (default), `10`, `21` (OCP), `23`. |
| `dimensions` | `width_mm`, `height_mm`, `depth_mm` (body), `width_with_ears_mm`, `depth_with_handles_mm`. |
| `weight_kg`, `weight_max_kg` | Typical and fully loaded weight. |
| `airflow` | `front-to-rear`, `rear-to-front`, `left-to-right`, `right-to-left`, `side-to-rear`, `rear-to-side`, `bottom-to-top`, `top-to-bottom`, `passive`, `mixed`. |
| `color` | `#rrggbb` chassis colour, used when no photo exists. |
| `subdevice_role` | `parent` (chassis with `device_bays`) or `child` (blade). |

## Power and thermal

`power`:

| Field | Applies to | Notes |
|---|---|---|
| `idle_w`, `typical_w`, `max_w` | everything | Whole-device draw in watts. |
| `psu_count`, `psu_rating_w`, `psu_redundancy` | servers, switches | e.g. `2`, `1400`, `1+1`. |
| `input_voltage`, `phase`, `input_current_a` | | `100-240V AC`, `single`/`three`/`dc`, `16`. |
| `capacity_va`, `capacity_w` | PDU, UPS | Rated capacity. |
| `outlet_count`, `switched`, `metered` | PDU | `metered`: `none`, `unit`, `phase`, `bank`, `outlet`. |
| `runtime_full_load_min`, `runtime_half_load_min`, `battery_type`, `topology` | UPS | `topology`: `standby`, `line-interactive`, `online-double-conversion`, `delta-conversion`. |

`thermal`: `max_btu_hr`, `typical_btu_hr`, `operating_temp_min_c`, `operating_temp_max_c`, `noise_dba`.

## Components

Lists of objects with at least `name`; all accept `label`, `description`, `side` (`front`/`rear`) and `position` (a rect on the image, see hotspots).

| List | Extra fields |
|---|---|
| `interfaces` | **`type`** (`1000base-t`, `10gbase-x-sfpp`, `25gbase-x-sfp28`, `100gbase-x-qsfp28`, `400gbase-x-qsfpdd`…), `mgmt_only`, `poe_mode`, `poe_type` |
| `console_ports`, `console_server_ports` | `type` (`rj-45`, `de-9`, `usb-c`…) |
| `power_ports` | `type` (`iec-60320-c14`, `iec-60320-c20`, `iec-60309-p-n-e-6h`, `nema-5-15p`…), `maximum_draw_w`, `allocated_draw_w` |
| `power_outlets` | `type`, `power_port` (inlet name), `feed_leg` (`A`/`B`/`C`) |
| `front_ports`, `rear_ports` | `type` (`8p8c`, `lc`, `mpo`…), `positions`, `color`; front ports map to `rear_port` + `rear_port_position` |
| `module_bays`, `device_bays` | `bay_position` |
| `inventory_items` | `manufacturer`, `part_id` |

Type slugs follow the [NetBox conventions](https://github.com/netbox-community/devicetype-library/blob/master/schema/generated_schema.json) so data moves freely between tools.

## Images and 3D

```yaml
images:
  front: front.webp
  rear: rear.webp            # also: top, left, right
  includes_ears: false
  hotspots: [{ label: PSU1, side: rear, kind: psu, component: PSU1, rect: { x: 0.86, y: 0.08, w: 0.13, h: 0.42 } }]
  credit: "@octocat"
  interior: interior.webp    # lid off, top-down
  gallery:
    - { file: gallery-1.webp, caption: Hero shot, view: angle }
model_3d: model.glb
model_3d_info:
  method: scan               # scan | modelled | generated
  includes_interior: true
  layers: { top_cover: [Lid], front_bezel: [Bezel] }   # glTF node names viewers can hide
  views: { interior: Cam_Interior, memory: Cam_DIMM }   # glTF camera nodes
  lod: model-lod1.glb
```

See [photography.md](photography.md) and [3d-models.md](3d-models.md).

Vendor 3D/360° viewers, galleries and CAD downloads are **linked**, never stored:

```yaml
links:
  media:
    - { kind: 3d-viewer, url: https://www.dell.com/.../poweredge-r750, label: 3D & AR viewer }
```

## Lifecycle, management, links

```yaml
lifecycle: { status: active, released: 2021-05, end_of_sale: 2025, end_of_support: 2028 }
management:
  bmc: iDRAC9
  protocols: [redfish, ipmi, snmp, ssh]
  snmp:
    sys_object_id: .1.3.6.1.4.1.674.10892.5
    mibs: [IDRAC-MIB-SMIv2]
    oids:
      total_power_w: { oid: .1.3.6.1.4.1.674.10892.5.4.600.30.1.6.1.3, unit: W }
links: { product_page: https://…, datasheet: https://…, manual: https://…, other: [{ label: Spec sheet, url: https://… }] }
comments: free text
verified: true
```

`management.snmp.oids` is how live metrics (PDU load, UPS runtime, temperatures) can be read without per-site configuration. It is the equivalent of openDCIM's CDU/sensor templates.

## Provenance

`source` is written by importers; leave it out for hand-made templates (or set `origin: community`).

| Field | Notes |
|---|---|
| `origin` | `community`, `manufacturer`, `netbox-devicetype-library`, `opendcim` |
| `inferred` | Fields guessed by an importer. Remove entries once you have checked them; re-imports won't add them back. |
| `upstream_fields` | Fields the importer owns. Re-imports update only these; every other field is yours and is always kept. |
| `import_hash` | Hash of the owned fields. If you edit one of them, the importer stops updating that file and keeps your version. Revert the edit and updates resume. |
| `also_from` | Other sources that filled in missing fields, e.g. `[opendcim]`. |

## Categories

| Category | Atlas type | | Category | Atlas type |
|---|---|---|---|---|
| `server` | server | | `pdu` | pdu / rack_mount_pdu / smart_pdu |
| `gpu_server` | server | | `ups` | ups |
| `compute_blade` | compute_blade | | `ups_battery_pack` | ups |
| `blade_chassis` | server | | `ats` | rack_mount_pdu |
| `storage_array` | storage_array | | `power_meter` | power_meter |
| `storage_shelf` | storage_array | | `environmental_monitor` | environmental_monitor |
| `tape_library` | tape_library | | `kvm_switch` | kvm_switch |
| `backup_appliance` | backup_appliance | | `kvm_extender` | kvm_extender |
| `database_appliance` | database_appliance | | `console_server` | console_server |
| `network_switch` | network_switch | | `ipmi_controller` | ipmi_controller |
| `router` | router | | `patch_panel` | – |
| `firewall` | firewall | | `cable_management` | – |
| `load_balancer` | load_balancer | | `blank_panel` | – |
| `wireless_access_point` | wireless_access_point | | `shelf` | – |
| `network_controller` | network_controller | | `media_converter` | – |
| `sdn_controller` | sdn_controller | | `appliance` | server |
| `network_tap` | network_tap | | `other` | – |
| `optical_transport` | fiber_switch | | `security_appliance` | security_appliance |

PDUs map to `pdu` when zero-U, `smart_pdu` when rack-mounted with a network interface, otherwise `rack_mount_pdu`.

Module `kind`: `psu`, `fan`, `nic`, `line_card`, `supervisor`, `transceiver`, `controller`, `storage`, `gpu`, `battery`, `management`, `other`.
