// Category metadata and the mapping onto Atlas CMDB DCIM types (src/lib/client/types/dcim.types.ts).

export const CATEGORIES = {
	server: { label: 'Server', atlas: 'server' },
	gpu_server: { label: 'GPU Server', atlas: 'server' },
	compute_blade: { label: 'Compute Blade', atlas: 'compute_blade' },
	blade_chassis: { label: 'Blade Chassis', atlas: 'server' },
	storage_array: { label: 'Storage Array', atlas: 'storage_array' },
	storage_shelf: { label: 'Storage Shelf / JBOD', atlas: 'storage_array' },
	tape_library: { label: 'Tape Library', atlas: 'tape_library' },
	backup_appliance: { label: 'Backup Appliance', atlas: 'backup_appliance' },
	database_appliance: { label: 'Database Appliance', atlas: 'database_appliance' },
	network_switch: { label: 'Network Switch', atlas: 'network_switch' },
	router: { label: 'Router', atlas: 'router' },
	firewall: { label: 'Firewall', atlas: 'firewall' },
	load_balancer: { label: 'Load Balancer', atlas: 'load_balancer' },
	wireless_access_point: { label: 'Wireless Access Point', atlas: 'wireless_access_point' },
	network_controller: { label: 'Network Controller', atlas: 'network_controller' },
	sdn_controller: { label: 'SDN Controller', atlas: 'sdn_controller' },
	network_tap: { label: 'Network TAP', atlas: 'network_tap' },
	optical_transport: { label: 'Optical Transport', atlas: 'fiber_switch' },
	media_converter: { label: 'Media Converter', atlas: null },
	security_appliance: { label: 'Security Appliance', atlas: 'security_appliance' },
	kvm_switch: { label: 'KVM Switch', atlas: 'kvm_switch' },
	kvm_extender: { label: 'KVM Extender', atlas: 'kvm_extender' },
	console_server: { label: 'Console Server', atlas: 'console_server' },
	ipmi_controller: { label: 'IPMI Controller', atlas: 'ipmi_controller' },
	pdu: { label: 'PDU', atlas: 'rack_mount_pdu' },
	ups: { label: 'UPS', atlas: 'ups' },
	ups_battery_pack: { label: 'UPS Battery Pack', atlas: 'ups' },
	ats: { label: 'Automatic Transfer Switch', atlas: 'rack_mount_pdu' },
	power_meter: { label: 'Power Meter', atlas: 'power_meter' },
	environmental_monitor: { label: 'Environmental Monitor', atlas: 'environmental_monitor' },
	patch_panel: { label: 'Patch Panel', atlas: null },
	cable_management: { label: 'Cable Management', atlas: null },
	blank_panel: { label: 'Blank Panel', atlas: null },
	shelf: { label: 'Shelf', atlas: null },
	appliance: { label: 'Appliance', atlas: 'server' },
	other: { label: 'Other', atlas: null }
};

/**
 * Atlas DCIM type for a template. Zero-U PDUs are their own Atlas type (drawn procedurally in the
 * rack's side channel); rack-mount PDUs with a management interface map to smart_pdu.
 */
export function atlasType(device) {
	if (device.category === 'pdu') {
		if (device.form_factor === 'zero-u' || device.u_height === 0) return 'pdu';
		const managed = (device.interfaces ?? []).length > 0 || device.management?.protocols?.length;
		return managed ? 'smart_pdu' : 'rack_mount_pdu';
	}
	return CATEGORIES[device.category]?.atlas ?? null;
}
