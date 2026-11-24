// Types for the published dataset (https://atlas-cmdb.github.io/device-templates/).
// Copy into a consumer or reference via the raw GitHub URL. Mirrors schema/*.schema.json.

export type Category =
	| 'server' | 'compute_blade' | 'blade_chassis' | 'gpu_server'
	| 'storage_array' | 'storage_shelf' | 'tape_library' | 'backup_appliance' | 'database_appliance'
	| 'network_switch' | 'router' | 'firewall' | 'load_balancer' | 'wireless_access_point' | 'network_controller'
	| 'sdn_controller' | 'network_tap' | 'optical_transport' | 'media_converter' | 'security_appliance'
	| 'kvm_switch' | 'kvm_extender' | 'console_server' | 'ipmi_controller'
	| 'pdu' | 'ups' | 'ups_battery_pack' | 'ats' | 'power_meter' | 'environmental_monitor'
	| 'patch_panel' | 'cable_management' | 'blank_panel' | 'shelf'
	| 'appliance' | 'other';

export type FormFactor = 'rack' | 'zero-u' | 'blade' | 'tower' | 'desktop' | 'wall' | 'din-rail' | 'other';
export type Airflow =
	| 'front-to-rear' | 'rear-to-front' | 'left-to-right' | 'right-to-left' | 'side-to-rear'
	| 'rear-to-side' | 'bottom-to-top' | 'top-to-bottom' | 'passive' | 'mixed';
export type ImageSide = 'front' | 'rear' | 'top' | 'left' | 'right' | 'interior';

/** Fractions (0-1) of the image width/height, origin top-left. */
export interface Rect { x: number; y: number; w: number; h: number }

// ------------------------------------------------------------------ manifest.json

export interface ManifestEntryBase {
	/** `<manufacturer>/<slug>`: stable id, use as foreign key. */
	id: string;
	manufacturer: string;
	model: string;
	/** Full JSON document, relative to `base_url`. */
	path: string;
	/** Changes whenever the template or one of its files changes; use for cache invalidation. */
	rev: string;
	part_numbers?: string[];
	/** Image paths relative to `base_url`. */
	images?: Partial<Record<ImageSide, string>>;
	verified?: boolean;
	/** Lower-case haystack of manufacturer, model, part numbers and aliases. */
	search: string;
}

export interface ManifestDevice extends ManifestEntryBase {
	category: Category;
	/** Matching Atlas DCIM type (dcim.types.ts) or undefined when Atlas has none. */
	atlas_type?: string;
	form_factor: FormFactor;
	u_height: number;
	full_depth?: boolean;
	weight_kg?: number;
	airflow?: Airflow;
	power_w?: number;
	psu_count?: number;
	outlets?: number;
	ports?: Partial<Record<'interfaces' | 'console' | 'console_server' | 'power' | 'front' | 'rear' | 'module_bays' | 'device_bays', number>>;
	model_3d?: string;
	/** Photos beyond front/rear. */
	gallery?: number;
	/** Kinds of vendor media linked from the template, e.g. ['3d-viewer']. */
	media?: MediaLink['kind'][];
	/** Fields guessed by an importer that still need a human check. */
	inferred?: string[];
}

export interface ManifestModule extends ManifestEntryBase { kind: ModuleKind; power_w?: number }
export interface ManifestRack extends ManifestEntryBase { form_factor?: string; u_height: number; rack_width?: number; outer_depth_mm?: number }

export interface Manifest {
	format_version: 1;
	/** Dataset licence: CC0-1.0 (public domain). */
	license: { data: 'CC0-1.0'; url: string };
	generated_at: string;
	commit: string;
	base_url: string;
	stats: Record<'manufacturers' | 'devices' | 'modules' | 'racks' | 'with_images' | 'verified', number>;
	categories: Partial<Record<Category, { label: string; atlas_type: string | null; count: number }>>;
	manufacturers: { slug: string; name: string; aliases?: string[] }[];
	devices: ManifestDevice[];
	modules: ManifestModule[];
	racks: ManifestRack[];
}

// ------------------------------------------------------------------ full documents

export interface Component { name: string; label?: string; description?: string; side?: 'front' | 'rear'; position?: Rect }
export interface Interface extends Component { type: string; mgmt_only?: boolean; poe_mode?: 'pd' | 'pse'; poe_type?: string; enabled?: boolean }
export interface Port extends Component { type?: string }
export interface PowerPort extends Component { type?: string; maximum_draw_w?: number; allocated_draw_w?: number }
export interface PowerOutlet extends Component { type?: string; power_port?: string; feed_leg?: 'A' | 'B' | 'C' }
export interface PassThroughPort extends Component { type?: string; rear_port?: string; rear_port_position?: number; positions?: number; color?: string }
export interface Bay extends Component { bay_position?: string }

export interface Hotspot {
	label: string;
	side: ImageSide;
	rect: Rect;
	kind?: 'drive_bay' | 'psu' | 'fan' | 'blade_slot' | 'module_bay' | 'port_group' | 'display' | 'led' | 'other';
	component?: string;
}

export interface GalleryImage { file: string; caption?: string; view?: 'front' | 'rear' | 'top' | 'interior' | 'left' | 'right' | 'angle' | 'detail' }

/** Vendor-hosted media. Linked, never stored (copyright). */
export interface MediaLink { kind: '3d-viewer' | '360-view' | 'gallery' | 'cad' | 'video' | 'interior-tour' | 'ar'; url: string; label?: string; format?: string }

export interface Model3dInfo {
	method?: 'scan' | 'modelled' | 'generated';
	includes_interior?: boolean;
	/** Toggleable parts as glTF node names; hide top_cover to show the interior. */
	layers?: Partial<Record<'top_cover' | 'front_bezel' | 'internal' | 'heatsinks' | 'air_shroud' | 'cables' | 'dimensions', string[]>>;
	/** Camera bookmarks as glTF camera node names. */
	views?: Partial<Record<'hero' | 'front' | 'rear' | 'top' | 'left' | 'right' | 'interior' | 'processor' | 'memory' | 'storage' | 'fans' | 'psu' | 'io', string>>;
	lod?: string;
	triangles?: number;
	credit?: string;
	license?: string;
}

export interface Images extends Partial<Record<ImageSide, string>> {
	gallery?: GalleryImage[];
	includes_ears?: boolean;
	hotspots?: Hotspot[];
	credit?: string;
	license?: string;
}

export interface Power {
	idle_w?: number; typical_w?: number; max_w?: number;
	psu_count?: number; psu_redundancy?: string; psu_rating_w?: number;
	input_voltage?: string; phase?: 'single' | 'three' | 'dc'; input_current_a?: number;
	capacity_va?: number; capacity_w?: number; outlet_count?: number;
	switched?: boolean; metered?: 'none' | 'unit' | 'phase' | 'bank' | 'outlet';
	runtime_full_load_min?: number; runtime_half_load_min?: number;
	battery_type?: string; topology?: 'standby' | 'line-interactive' | 'online-double-conversion' | 'delta-conversion';
}

export interface Links { product_page?: string; datasheet?: string; manual?: string; media?: MediaLink[]; other?: { label?: string; url: string }[] }

export interface Source {
	origin?: 'community' | 'manufacturer' | 'netbox-devicetype-library' | 'opendcim';
	url?: string; license?: string; upstream_path?: string; upstream_commit?: string;
	imported_at?: string; import_hash?: string; inferred?: string[];
	/** Fields owned by the importer; everything else survives re-imports. */
	upstream_fields?: string[];
	also_from?: Source['origin'][];
}

interface ResolvedUrls {
	id: string;
	rev: string;
	manufacturer_name: string;
	/** Absolute image URLs. */
	image_urls?: Partial<Record<ImageSide, string>>;
	model_3d_url?: string;
	model_3d_lod_url?: string;
	gallery_urls?: (GalleryImage & { url: string })[];
}

export interface DeviceTemplate extends ResolvedUrls {
	atlas_type: string | null;
	manufacturer: string;
	model: string;
	slug: string;
	category: Category;
	form_factor: FormFactor;
	family?: string;
	description?: string;
	part_numbers?: string[];
	aliases?: string[];
	u_height: number;
	full_depth?: boolean;
	rack_width?: 10 | 19 | 21 | 23;
	subdevice_role?: 'parent' | 'child';
	dimensions?: { width_mm?: number; height_mm?: number; depth_mm?: number; width_with_ears_mm?: number; depth_with_handles_mm?: number };
	weight_kg?: number;
	weight_max_kg?: number;
	airflow?: Airflow;
	color?: string;
	power?: Power;
	thermal?: { max_btu_hr?: number; typical_btu_hr?: number; operating_temp_min_c?: number; operating_temp_max_c?: number; noise_dba?: number };
	interfaces?: Interface[];
	console_ports?: Port[];
	console_server_ports?: Port[];
	power_ports?: PowerPort[];
	power_outlets?: PowerOutlet[];
	front_ports?: PassThroughPort[];
	rear_ports?: PassThroughPort[];
	module_bays?: Bay[];
	device_bays?: Bay[];
	inventory_items?: (Component & { manufacturer?: string; part_id?: string })[];
	images?: Images;
	model_3d?: string;
	model_3d_info?: Model3dInfo;
	lifecycle?: { status?: 'active' | 'end-of-sale' | 'end-of-life' | 'announced'; released?: string; end_of_sale?: string; end_of_support?: string };
	management?: {
		bmc?: string;
		protocols?: string[];
		snmp?: { sys_object_id?: string; mibs?: string[]; oids?: Record<string, { oid: string; multiplier?: number; unit?: string }> };
	};
	links?: Links;
	comments?: string;
	verified?: boolean;
	source?: Source;
}

export type ModuleKind = 'psu' | 'fan' | 'nic' | 'line_card' | 'supervisor' | 'transceiver' | 'controller' | 'storage' | 'gpu' | 'battery' | 'management' | 'other';

export interface ModuleTemplate extends ResolvedUrls {
	manufacturer: string; model: string; slug: string; kind: ModuleKind;
	description?: string; part_numbers?: string[]; weight_kg?: number; airflow?: Airflow; power?: Power;
	interfaces?: Interface[]; console_ports?: Port[]; power_ports?: PowerPort[]; power_outlets?: PowerOutlet[];
	front_ports?: PassThroughPort[]; rear_ports?: PassThroughPort[]; module_bays?: Bay[];
	images?: Images; links?: Links; comments?: string; verified?: boolean; source?: Source;
}

export interface RackTemplate extends ResolvedUrls {
	manufacturer: string; model: string; slug: string; description?: string; part_numbers?: string[];
	form_factor?: '4-post-cabinet' | '4-post-frame' | '2-post-frame' | 'wall-cabinet' | 'wall-frame' | 'wall-frame-vertical' | 'wall-cabinet-vertical';
	rack_width?: 10 | 19 | 21 | 23; u_height: number; starting_unit?: number; desc_units?: boolean;
	outer_width_mm?: number; outer_height_mm?: number; outer_depth_mm?: number; mounting_depth_mm?: number;
	weight_kg?: number; max_load_kg?: number; color?: string;
	doors?: { front?: string; rear?: string; perforation_percent?: number };
	zero_u_channels?: number; images?: Images; links?: Links; comments?: string; verified?: boolean; source?: Source;
}
