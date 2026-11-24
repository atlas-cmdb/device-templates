// Extra fields for well-known manufacturers, merged in when the importer first creates their file.
// Aliases make search hits for old brand names ("HP", "Liebert", "Avocent", ...).
export const MANUFACTURER_EXTRAS = {
	apc: { aliases: ['APC by Schneider Electric', 'American Power Conversion'], website: 'https://www.apc.com', parent: 'schneider-electric' },
	arista: { aliases: ['Arista Networks'], website: 'https://www.arista.com' },
	cisco: { aliases: ['Cisco Systems', 'Meraki', 'Linksys Business'], website: 'https://www.cisco.com' },
	dell: { aliases: ['Dell EMC', 'Dell Technologies', 'EMC', 'Force10'], website: 'https://www.dell.com' },
	eaton: { aliases: ['Powerware', 'MGE'], website: 'https://www.eaton.com' },
	fortinet: { aliases: ['FortiGate'], website: 'https://www.fortinet.com' },
	hpe: { aliases: ['HP', 'Hewlett Packard Enterprise', 'Hewlett-Packard', 'Aruba', '3Com', 'H3C'], website: 'https://www.hpe.com' },
	'hewlett-packard-enterprise': { aliases: ['HPE', 'HP'], website: 'https://www.hpe.com' },
	juniper: { aliases: ['Juniper Networks'], website: 'https://www.juniper.net' },
	'juniper-networks': { aliases: ['Juniper'], website: 'https://www.juniper.net' },
	lenovo: { aliases: ['IBM System x'], website: 'https://www.lenovo.com' },
	mikrotik: { aliases: ['RouterBOARD'], website: 'https://mikrotik.com' },
	netapp: { website: 'https://www.netapp.com' },
	nvidia: { aliases: ['Mellanox', 'Cumulus Networks'], website: 'https://www.nvidia.com' },
	'palo-alto': { aliases: ['Palo Alto Networks', 'PAN'], website: 'https://www.paloaltonetworks.com' },
	'palo-alto-networks': { aliases: ['Palo Alto', 'PAN'], website: 'https://www.paloaltonetworks.com' },
	'pure-storage': { website: 'https://www.purestorage.com' },
	raritan: { aliases: ['Legrand Raritan'], website: 'https://www.raritan.com', parent: 'legrand' },
	'schneider-electric': { aliases: ['APC', 'Schneider'], website: 'https://www.se.com' },
	'server-technology': { aliases: ['ServerTech', 'STI', 'Legrand Server Technology'], website: 'https://www.servertech.com', parent: 'legrand' },
	supermicro: { aliases: ['Super Micro Computer', 'SMC'], website: 'https://www.supermicro.com' },
	ubiquiti: { aliases: ['UniFi', 'Ubiquiti Networks', 'UBNT'], website: 'https://www.ui.com' },
	vertiv: { aliases: ['Liebert', 'Avocent', 'Geist', 'Emerson Network Power', 'Cyclades'], website: 'https://www.vertiv.com' }
};
