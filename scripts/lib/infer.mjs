// Heuristics that turn a NetBox device type (which has no "what is this" field) into our category.
// Every imported template keeps `source.inferred: [category]` until a human confirms it.

/** Ordered: the first matching rule wins, so specific patterns come before generic ones. */
const TEXT_RULES = [
	['blank_panel', /\bblank(ing)?[ -]?(panel|plate)|\bfiller panel|\bblind panel/],
	['cable_management', /cable[ -]?(manag|mgr)|grommet|cable organi[sz]er|brush (panel|strip)|finger duct|lacing bar|\bwire manager|horizontal manager/],
	['shelf', /\b(cantilever |sliding |fixed |vented )?shelf\b(?!.*(disk|drive|storage))|\brack tray\b|keyboard tray/],
	['ups_battery_pack', /battery (pack|module|cabinet|extension)|extended battery|\bebm\b|\bxlbp\b|\bsrt\w*bp|rmbp|\bxbp\d|\bbp\d{2,}v/],
	['ats', /transfer switch|\bats\b|\bap44\d\d|\bsts\b/],
	['ups', /\bups\b|uninterruptible|smart-?ups|symmetra|\bgalaxy (vs|vx|vm|pw)|\beaton (5p|5px|5sc|9px|9sx|9pxm|9130|93)|\b9px\b|\b5px\b|liebert (gxt|psi|apm|exs)|\bgxt\d|\bpsi5|\bsrt\d|\bsmt\d|\bsmx\d|\bsurt|\bsua\d|\bsmc\d|\bbx\d{3,}[a-z]*-?(ms|mi|ci|lm|u|rs)\b|back-?ups|\bol\d{3,}r|\bor\d{3,}|\bpr\d{3,}|lcdrm|\bpowervalue|riello|socomec|\bups\d/],
	['pdu', /\bpdu|\brpdu|power distribution|\bap7\d{3}|\bap8\d{3}|\bap9\d{3}|switched rack|metered rack|power strip|\bpx\d-|raritan px|servertech|\bpro[12] |\bpro4x|\bgeist\b|enlogic|\bhdot\b|power bar|outlet strip|\bepdu|\bmpdu|\bcdu\b/],
	['power_meter', /power meter|energy meter|branch circuit monitor|\bbcms?\b/],
	['environmental_monitor', /netbotz|environment(al)? monitor|temperature sensor|humidity sensor|room alert|\bsensor hub|leak detect|\bemu\b|\bsensorprobe|\bakcp\b|\bwatchdog\b/],
	['kvm_extender', /kvm extender|\bextender\b.*kvm|\bkvm\b.*extender/],
	['kvm_switch', /\bkvm\b|dominion kx|\bdkx\d|avocent (mpu|autoview|switchview|dsr)|\bcs\d{4}\b.*kvm|\bkh\d{4}|\bkn\d{4}/],
	['console_server', /console server|terminal server|opengear|cyclades|avocent acs|\bacs\d{3,}|lantronix (slc|eds)|\bslc\d|\bperle iolan|\bcm\d{4}-|\bom\d{4}-|nodegrid|\bisr ?4\d{3}.*async/],
	['tape_library', /tape (library|drive|autoloader)|autoloader|\blto-?\d|\btl\d{4}|\bml\d{4}|\bts\d{4}\b|scalar i\d|\bmsl\d|storeever|powervault tl|\bqualstar/],
	['backup_appliance', /data ?domain|powerprotect|rubrik|cohesity|exagrid|storeonce|backup appliance|veeam appliance|\bdd\d{4}\b|\bdp\d{4}\b|quantum dxi|\bdxi\d/],
	['database_appliance', /exadata|oracle database appliance|\boda x\d|netezza|teradata/],
	['storage_shelf', /\bjbod\b|disk (shelf|enclosure|expansion)|drive (shelf|enclosure)|expansion (shelf|enclosure)|\bds\d{3,4}\b|\bns\d{3}\b|\bdae\b|\bme\d{3}\b|\bmd\d{4}e?\b|\bd3284|\bd\d{4}\b.*enclosure|storage enclosure/],
	['storage_array', /storage (array|system|controller|node)|netapp|\baff ?[ac]?\d|\bfas\d|pure ?storage|flasharray|flashblade|powerstore|powervault|powermax|\bunity\b|\bvnx|isilon|powerscale|3par|primera|alletra|nimble|\bmsa ?\d|storwize|flashsystem|eternus|\bnas\b|synology|qnap|truenas|ixsystems|hitachi vsp|infinibox|\bvsp ?[efg]\d|ibm ds\d|\bv7000|huawei oceanstor|oceanstor|equallogic|compellent|\bsc\d{4}\b|vmax|xtremio|datacore|nutanix|simplivity|vxrail|\bhci\b/],
	['optical_transport', /dwdm|cwdm|\bmux\b|demux|optical transport|\botn\b|ciena|infinera|\badva\b|\bfsp ?\d|waveserver|\bncs ?1\d{3}|\bncs ?2\d{3}|optical amplifier|\bedfa\b|\broadm\b|wavelength/],
	['media_converter', /media converter|fiber converter|fibre converter|\bmc\d{3}\b|ethernet extender/],
	['network_tap', /network tap|\btap\b.*(fiber|copper|aggregat)|packet broker|gigamon|\bgigavue|keysight vision|ixia (vision|net optics)|net optics|apcon|cpacket|garland|niagara networks|profitap/],
	['load_balancer', /load ?balancer|big-?ip|\bviprion|netscaler|citrix adc|\ba10 |thunder (adc|cfw)|loadmaster|\bkemp\b|alteon|array networks|\bavi\b|application delivery/],
	['security_appliance', /\bwaf\b|web application firewall|email security|secure (web|email) (gateway|appliance)|proxysg|bluecoat|blue coat|\bise-?\d|\bsns-\d|ironport|\besa ?c?\d|\bwsa ?s?\d|\bhsm\b|luna sa|nshield|darktrace|\bsiem\b|\bndr\b|fireeye|trellix|imperva|qradar|forcepoint|zscaler|\bids\b|\bips\b(?!\w)/],
	['firewall', /firewall|\basa\b|\bcsf\d{3}|fortigate|fortiwifi|palo ?alto|\bpa-\d|check ?point|\bquantum (force|spark|lightspeed)|sonicwall|\bnsa ?\d|\btz ?\d{3}|\bsrx ?\d|\basa ?5\d|firepower|\bfpr-?\d|secure firewall|watchguard|\bfirebox|sophos (xg|sg|xgs)|\bxgs ?\d|barracuda cloudgen|stormshield|\bsns\d|netgate|pfsense|opnsense|\busg ?flex|zywall|\bfg-?\d{2,}|\bfwf-\d/],
	['network_controller', /wireless (lan )?controller|\bwlc\b|mobility (master|controller|conductor)|smartzone|\bvsz\b|\bc9800|\bair-ct\d|aruba (7\d{3}|9\d{3}) |\bct\d{4}\b|wireless gateway controller/],
	['sdn_controller', /\bsdn controller|\bapic\b|\bdnac?\b|catalyst center|dna center|\bnsx\b|vsmart|vbond|vmanage/],
	['wireless_access_point', /access point|fortiap|\bfap-|\bap-\d|\buap\b|unifi (ap|nanohd|flexhd|u6|u7)|\bu6-|\bu7-|aironet|\bair-(cap|ap|lap)|\bmr\d{2}\b|\bcw9\d{3}|\bc91\d\daxi|\bwap\d|\bwax\d{3}|\bcap ac|\bcap ax|ruckus r\d|\br\d{3}\b.*ruckus|\beap\d{3}|\binstant on ap|\bap\d{3}\b|\biap-\d|\bmist ap|\bap\d{2}\b.*mist|\bwireless ap\b/],
	['router', /\brouter\b|fortiextender|\bisr ?\d{3,4}|\basr ?\d{3,4}|\bmx\d{2,5}\b|\bncs-?\d{4}|\bne\d{2,4}(e|-x\d)?\b|\bcrs-\d|\bcrs-x|\b8[0-9]{3}-\d|\bacx ?\d|\bptx ?\d|\bncs ?5\d{2,3}|\bncs ?540|\bccr\d{4}|cloud core router|routerboard|\brb\d{3,4}|edgerouter|\ber-\d|\bc8\d{3}\b|catalyst 8\d{3}|\bcsr\d|\b7750 sr|\b7250 ixr|\b7705 sar|\bsr-\d+s?\b|\bne\d{2}e|\bar\d{3,4}\b|\bvyos|\bvsr\d|\bmx ?\d{3}\b|\b8[0-9]{3}-[0-9]{2}/],
	['gpu_server', /\bdgx\b|\bhgx\b|\bgpu server|\bxe9680|\bxe8545|\besc\d{4}|\bg\d{3}-[a-z]\d|\bsys-\d{3}g|\bas-\d{4}g|\b4u gpu|\bl40s\b.*server/],
	['blade_chassis', /blade (chassis|enclosure|system)|\bc7000\b|\bc3000\b|\bmx7000\b|\bm1000e\b|\bvrtx\b|\bucs 5108\b|\bucsb-5108|\bucsx-9508|synergy 12000|flex system enterprise chassis|\bfx2s?\b|\bbladecenter|\bx9508\b/],
	['compute_blade', /\bblade server|\bbl\d{3}c|\bmx\d{3}c\b|\bm\d{3}\b.*blade|\bucs ?b\d{3}|\bucsb-b\d|\bucsx-\d{3}c|\bsy\d{3} gen|\bsynergy \d{3}\b|\bsn\d{3}v\d|\bfc\d{3}\b|\bhs\d{2}\b/],
	['server', /\bserver\b|poweredge|proliant|\bdl\d{2,3}\b|\bml\d{2,3}\b|thinksystem|system x|primergy|\bucs ?c\d|\bucsc-c|superserver|\bsys-\d|\bas-\d{4}|\bsse-|supermicro|asrock rack|\binspur|\bnf\d{4}|fusionserver|\b[12]288h|\bxeon|\bepyc|\br\d{3}xs?\b|\br\d{4}\b|\bt\d{3}\b.*poweredge|\bsr\d{3}v?\d?\b|\bsd\d{3}\b|gigabyte r\d|\bnuc\b|\bapollo\b|\bedgeline|\bhyper-?converged/],
	['network_switch', /switch|fabric ?engine|catalyst|nexus|\bn\d[kK]|\bn\d{4}|\bex\d{4}|\bqfx|arista|\bdcs-\d|\bdcs7|\bccs-|\bcrs\d{3}|\bcss\d{3}|mellanox|\bsn\d{4}\b|\bmsn\d{4}|aruba (cx|\d{4})|\bjl\d{3}a|procurve|\bdgs-|\bdxs-|\bgs\d{3,4}|\bxs\d{3,4}|\bxgs\d{4}|unifi (switch|usw)|\busw-|\bes-\d|edgeswitch|powerswitch|\bs\d{4}-on|\bz9\d{3}|\bs\d{4}f|\bsg\d{3}|\bsf\d{3}|\bcbs\d{3}|\bws-c|\bc9[2-6]\d{2}|\bc1000-|\bc1200|\bc1300|\bicx\d|\bces\d|\bie-?\d{4}|\bsx\d{3,4}|\bfs\d{3,4}|\bt\d{4}-|\bjg\d{3}a|\bfortiswitch|\bfs-\d{3}|\bms\d{3}-|\bmx-?\d{3}r|\bvdx\d|\bslx\d|\bce\d{4}|\bs\d{4}-\d{2}|\bcloudengine|\bdell n\d{4}|\bx\d{3}-\d{2}|\bmlx\d|\b7050|\b7280|\b7060|\b7500|\b7800|\b720xp|\bga-?\d/]
];

const lower = (v) => (v == null ? '' : String(v).toLowerCase());

/**
 * Returns { category, confident }. `confident` is false when only a structural fallback matched.
 */
export function inferCategory(src, components) {
	const text = `${lower(src.model)} ${lower(src.slug).replace(/-/g, ' ')} ${lower(src.part_number)} ${lower(src.description)}`;
	const vendor = lower(src.manufacturer);
	const ifaces = components.interfaces ?? [];
	const dataIfaces = ifaces.filter((i) => !i.mgmt_only && !/virtual|lag|bridge/.test(i.type ?? ''));
	const outlets = components.power_outlets?.length ?? 0;
	const consoleServerPorts = components.console_server_ports?.length ?? 0;
	const front = components.front_ports?.length ?? 0;
	const rear = components.rear_ports?.length ?? 0;
	const u = Number(src.u_height ?? 1);

	// Structural certainties first.
	if (front > 0 && rear > 0 && ifaces.length === 0 && !(components.power_ports?.length)) {
		if (/dwdm|cwdm|\bmux|optical/.test(text)) return { category: 'optical_transport', confident: true };
		return { category: 'patch_panel', confident: true };
	}
	if (/patch[ -]?panel|fib(er|re) (panel|enclosure|shelf|tray)|\bodf\b|keystone|\blgx\b|mpo cassette|\bcassette\b|feed-?through panel|fib(er|re) (management|distribution|splice|drawer)|splice (tray|enclosure)|\bfhd-|\bfhx-|\bfmt\d|opticom/.test(text))
		return { category: 'patch_panel', confident: true };

	for (const [category, re] of TEXT_RULES) {
		if (re.test(text)) {
			// Vendors whose 'switch' products are actually power or KVM gear.
			if (category === 'network_switch' && outlets >= 4) return { category: 'pdu', confident: true };
			if (category === 'network_switch' && dataIfaces.length === 0 && consoleServerPorts > 0) return { category: 'console_server', confident: true };
			if (category === 'shelf' && (ifaces.length || components.power_ports?.length)) continue;
			// "…-UPS" switch SKUs and the like: lots of data ports means it is network gear.
			if (['ups', 'pdu', 'ats'].includes(category) && dataIfaces.length >= 8) return { category: 'network_switch', confident: true };
			return { category, confident: true };
		}
	}

	// Vendor-level hints for model numbers that carry no keywords.
	const vendorHints = [
		[/^(apc|apc by schneider electric|schneider electric|eaton|vertiv|liebert|cyberpower|tripp lite|riello|socomec|legrand|raritan|server technology|geist)$/, outlets >= 4 ? 'pdu' : null],
		[/^(fortinet|palo alto networks|check point|sonicwall|watchguard|sophos|netgate|stormshield)$/, 'firewall'],
		[/^(arista|arista networks|mellanox|cumulus|edgecore|edge-core|celestica|ufispace|netgear|d-link|tp-link|zyxel|allied telesis|extreme networks|brocade|ruckus|alcatel-lucent enterprise|h3c|fs|fs.com)$/, dataIfaces.length >= 8 ? 'network_switch' : null],
		[/^(supermicro|dell|hpe|hewlett packard enterprise|lenovo|fujitsu|inspur|gigabyte|asrock rack|quanta|wiwynn|tyan|asus|intel|oracle|ibm)$/, u > 0 && dataIfaces.length <= 8 ? 'server' : null],
		[/^(netapp|pure storage|hitachi vantara|infinidat|nimble storage|synology|qnap|ixsystems)$/, 'storage_array'],
		[/^(opengear|lantronix|perle|digi|zpe systems|avocent)$/, consoleServerPorts > 0 ? 'console_server' : null],
		[/^(gigamon|keysight|apcon|garland technology|niagara networks|cpacket|profitap)$/, 'network_tap'],
		[/^(f5|f5 networks|citrix|a10 networks|kemp|progress kemp|radware)$/, 'load_balancer'],
		[/^(ciena|infinera|adva|nokia|coriant)$/, rear > 0 || /\bwave/.test(text) ? 'optical_transport' : null]
	];
	for (const [re, category] of vendorHints) if (category && re.test(vendor)) return { category, confident: false };

	// Structural fallbacks.
	if (consoleServerPorts >= 4) return { category: 'console_server', confident: false };
	if (outlets >= 4 && dataIfaces.length <= 2) return { category: 'pdu', confident: false };
	if (src.subdevice_role === 'parent' && (components.device_bays?.length ?? 0) > 0) return { category: 'blade_chassis', confident: false };
	if (src.subdevice_role === 'child' && dataIfaces.length <= 8) return { category: 'compute_blade', confident: false };
	if (dataIfaces.length >= 8) return { category: 'network_switch', confident: false };
	if (u > 0 && ifaces.some((i) => i.mgmt_only) && (components.module_bays?.length ?? 0) > 0) return { category: 'server', confident: false };
	if (u > 0 && ifaces.length > 0) return { category: 'appliance', confident: false };
	return { category: 'other', confident: false };
}

/** Datacenter templates only by default: rack-mounted gear, blades, zero-U power, sensors. */
const DC_ZERO_U = new Set([
	'pdu', 'ats', 'environmental_monitor', 'power_meter', 'kvm_extender', 'media_converter', 'network_tap',
	'console_server', 'wireless_access_point', 'network_switch', 'router', 'firewall', 'patch_panel', 'ups',
	'compute_blade', 'storage_shelf'
]);
const NOT_DC = /\b(ip )?camera\b|dome\b|\bipc\b|\bipc-|\bnvr\b|\bdvr\b|\bxvr\b|\bdome\b|\bbullet\b|\bptz\b|\bturret\b|fisheye|\bds-2c|\bdesk ?phone|\bip phone|\bvoip phone|\bcp-\d{4}|\bdect\b|\bhandset\b|\bintercom|\bdoorbell|\bspeakerphone|\bconference phone|\bvideo bar|\bwebcam/;

export function inferFormFactor(u, src, category) {
	if (u > 0) return 'rack';
	if (src.subdevice_role === 'child') return 'blade';
	if (['pdu', 'ats', 'power_meter'].includes(category)) return 'zero-u';
	if (['server', 'storage_array', 'gpu_server'].includes(category) && /\btower\b|\bt\d{2,3}\b|\bml\d{2,3}\b|\bst\d{2,3}\b|\bts\d{3}\b|\bpowervault me\d/i.test(src.model)) return 'tower';
	return 'other';
}

export function isDatacenterRelevant({ category, formFactor, src }) {
	const text = `${lower(src.model)} ${lower(src.description)} ${lower(src.slug).replace(/-/g, ' ')}`;
	if (NOT_DC.test(text)) return false;
	if (['rack', 'blade', 'zero-u', 'tower'].includes(formFactor)) return true;
	return DC_ZERO_U.has(category);
}

export function inferModuleKind(src) {
	const text = `${lower(src.model)} ${lower(src.description)} ${lower(src.profile)} ${lower(src.part_number)}`;
	if (/power supply|\bpsu\b|\bpwr-|\bps-\d|\bac power|\bdc power|watt/.test(text)) return 'psu';
	if (/\bfan\b|fan tray|fan module|\bfan-/.test(text)) return 'fan';
	if (/transceiver|\bsfp|\bqsfp|\bxfp|\bcfp|\bosfp|\bgbic/.test(text)) return 'transceiver';
	if (/supervisor|routing engine|\bsup\d|\bre-|management module|\bcmm\b|\bcontrol(ler)? (board|card|module)/.test(text)) return 'supervisor';
	if (/raid|hba|storage controller|\bperc\b|smart array|\bnvme\b|\bssd\b|\bhdd\b|\bdisk\b|\bdrive\b/.test(text)) return 'storage';
	if (/\bgpu\b|tesla|\ba100\b|\bh100\b|\bl40|quadro|radeon instinct/.test(text)) return 'gpu';
	if (/battery/.test(text)) return 'battery';
	if (/network (card|adapter)|\bnic\b|\bocp\b|ethernet adapter|connectx|\bhca\b|expansion card|mezzanine|\blom\b/.test(text)) return 'nic';
	if (/line ?card|interface module|network module|\bnim-|\bepa-|\bmpc\d|\bpic\b|\blc\b|uplink module|\bx\d{4}-|\bc9\d{3}-nm/.test(text)) return 'line_card';
	if (/idrac|ilo|\bbmc\b|management/.test(text)) return 'management';
	return 'other';
}
