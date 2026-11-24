// Turn the human port notation used in issue forms ("48x RJ45 1G", "4x SFP28", "2x C14 inlet")
// into schema components. Unknown things become type 'other' for a maintainer to refine.

const INTERFACE_TYPES = [
	[/qsfp-?dd800|800g/, '800gbase-x-qsfpdd'],
	[/qsfp-?dd/, '400gbase-x-qsfpdd'],
	[/osfp/, '400gbase-x-osfp'],
	[/qsfp112/, '400gbase-x-qsfp112'],
	[/qsfp56/, '200gbase-x-qsfp56'],
	[/qsfp28|100g/, '100gbase-x-qsfp28'],
	[/qsfp\+|qsfpp|qsfp|40g/, '40gbase-x-qsfpp'],
	[/sfp56|50g/, '50gbase-x-sfp56'],
	[/sfp28|25g/, '25gbase-x-sfp28'],
	[/sfp\+|sfpp|10g ?sfp|sfp ?10g/, '10gbase-x-sfpp'],
	[/sfp/, '1000base-x-sfp'],
	[/10g(base-?t)?|rj-?45 ?10g|10gb?e/, '10gbase-t'],
	[/5g(base-?t)?\b/, '5gbase-t'],
	[/2\.5g/, '2.5gbase-t'],
	[/100m|fast ?ethernet|100base/, '100base-tx'],
	[/1g|gig|1000|rj-?45|copper|ethernet/, '1000base-t']
];
const CONSOLE_TYPES = [
	[/usb-?c/, 'usb-c'],
	[/usb.*micro|micro-?usb/, 'usb-micro-b'],
	[/usb.*mini|mini-?usb/, 'usb-mini-b'],
	[/usb/, 'usb-a'],
	[/db-?9|de-?9|rs-?232/, 'de-9'],
	[/rj-?45|rj45/, 'rj-45']
];
const POWER_TYPES = [
	[/c20/, 'iec-60320-c20', 'in'],
	[/c19/, 'iec-60320-c19', 'out'],
	[/c14/, 'iec-60320-c14', 'in'],
	[/c13/, 'iec-60320-c13', 'out'],
	[/c16/, 'iec-60320-c16', 'in'],
	[/c15/, 'iec-60320-c15', 'out'],
	[/c8\b/, 'iec-60320-c8', 'in'],
	[/c6\b/, 'iec-60320-c6', 'in'],
	[/schuko|cee ?7/, 'cee-7-7', 'in'],
	[/60309.*(3p|3-?phase|5 ?pin)|(3p|3-?phase|5 ?pin).*60309/, 'iec-60309-3p-n-e-6h', 'in'],
	[/60309|commando|cee ?form/, 'iec-60309-p-n-e-6h', 'in'],
	[/dc|-48v|terminal/, 'dc-terminal', 'in']
];

const pick = (table, text, fallback) => table.find(([re]) => re.test(text))?.slice(1) ?? [fallback];

const OPTICAL_BY_SPEED = [
	[/400g/, '400gbase-x-qsfpdd'],
	[/200g/, '200gbase-x-qsfp56'],
	[/100g/, '100gbase-x-qsfp28'],
	[/50g/, '50gbase-x-sfp56'],
	[/40g/, '40gbase-x-qsfpp'],
	[/25g/, '25gbase-x-sfp28'],
	[/10g/, '10gbase-x-sfpp'],
	[/(^|\D)1g|1000/, '1000base-x-sfp']
];

/**
 * Interface type from free text such as openDCIM's "CAT6 1 Gbps Ethernet" or "LC 10 Gbps".
 * Fibre connectors get optical (-x) types; copper gets base-T.
 */
export function interfaceTypeFrom(text) {
	const t = String(text ?? '')
		.toLowerCase()
		.replace(/(\d)\s+(g|m)(b|bps|bit)?\b/g, '$1$2')
		.replace(/gbps|gbit|gb\/s|gbe/g, 'g')
		.replace(/mbps|mbit|mb\/s/g, 'm');
	const optical = /\b(lc|sc|st|mpo|mtp|fib(er|re)|om\d|os\d|mmf|smf|sfp|qsfp|optical|single-?mode|multi-?mode)\b/.test(t);
	if (optical && !/sfp|qsfp|osfp|cfp/.test(t)) return pick(OPTICAL_BY_SPEED, t, 'other')[0];
	return pick(INTERFACE_TYPES, t, 'other')[0];
}

/** Pass-through connector type for patch panels. */
export function passThroughType(text) {
	const t = String(text ?? '').toLowerCase();
	if (/cat ?\d|rj-?45|8p8c|copper|utp|stp/.test(t)) return '8p8c';
	if (/\blc\b/.test(t)) return /apc/.test(t) ? 'lc-apc' : 'lc';
	if (/\bsc\b/.test(t)) return /apc/.test(t) ? 'sc-apc' : 'sc';
	if (/mpo|mtp/.test(t)) return 'mpo';
	if (/\bst\b/.test(t)) return 'st';
	if (/rj-?11|6p\dc/.test(t)) return '6p4c';
	if (/coax|bnc/.test(t)) return 'bnc';
	return 'other';
}

/** Parse "48x RJ45 1G" style lines. Returns { interfaces, console_ports }. */
export function parsePorts(text) {
	const interfaces = [];
	const console_ports = [];
	let port = 1;
	let mgmt = 1;
	for (const raw of lines(text)) {
		const { count, rest } = countOf(raw);
		const t = rest.toLowerCase();
		if (/console|serial|rs-?232/.test(t)) {
			const [type] = pick(CONSOLE_TYPES, t, 'rj-45');
			for (let i = 0; i < count; i++) console_ports.push({ name: count > 1 ? `Console ${i + 1}` : 'Console', type });
			continue;
		}
		const [type] = pick(INTERFACE_TYPES, t, 'other');
		const isMgmt = /mgmt|management|bmc|idrac|ilo|ipmi|xcc|oob|out-of-band/.test(t);
		for (let i = 0; i < count; i++) {
			if (isMgmt) interfaces.push({ name: mgmt++ === 1 && count === 1 ? 'Mgmt' : `Mgmt ${mgmt - 1}`, type, mgmt_only: true });
			else interfaces.push({ name: `Port ${port++}`, type });
		}
	}
	return { interfaces, console_ports };
}

/** Parse "2x C14 inlet" / "24x C13 outlet". Returns { power_ports, power_outlets }. */
export function parsePowerConnectors(text) {
	const power_ports = [];
	const power_outlets = [];
	for (const raw of lines(text)) {
		const { count, rest } = countOf(raw);
		const t = rest.toLowerCase();
		const nema = t.match(/nema ?(l?\d{1,2}-\d{2}[pr])/);
		let [type, direction] = nema ? [`nema-${nema[1]}`, nema[1].endsWith('r') ? 'out' : 'in'] : pick(POWER_TYPES, t, 'other');
		if (/outlet|output|receptacle/.test(t)) direction = 'out';
		if (/inlet|input|psu|plug|feed/.test(t)) direction = 'in';
		for (let i = 0; i < count; i++) {
			if (direction === 'out') power_outlets.push({ name: `Outlet ${power_outlets.length + 1}`, type });
			else power_ports.push({ name: `PSU${power_ports.length + 1}`, type });
		}
	}
	return { power_ports, power_outlets };
}

function lines(text) {
	return String(text ?? '')
		.split(/\r?\n|,|;/)
		.map((l) => l.replace(/^[-*\s]+/, '').trim())
		.filter(Boolean);
}

function countOf(line) {
	const m = line.match(/^(\d{1,3})\s*(?:x|×|\*)?\s+(.*)$/i) ?? line.match(/^(\d{1,3})\s*[x×*]\s*(.*)$/i);
	if (!m) return { count: 1, rest: line };
	return { count: Math.min(Number(m[1]), 512), rest: m[2] };
}
