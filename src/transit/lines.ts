/** User-facing train lines → Adelaide Metro rail route_ids from GTFS. */
export const RAIL_LINES = {
	gawler: {
		label: "Gawler",
		routeIds: new Set(["GAW", "GAWC", "SALIS"]),
		terminal: "Gawler Central",
	},
	seaford: {
		label: "Seaford",
		routeIds: new Set(["SEAFRD", "NOAR"]),
		terminal: "Seaford",
	},
	flinders: {
		label: "Flinders",
		routeIds: new Set(["FLNDRS"]),
		terminal: "Flinders",
	},
	"outer-harbor": {
		label: "Outer Harbor",
		routeIds: new Set(["OUTHA", "OSBORN", "GLAN"]),
		terminal: "Outer Harbor",
	},
	grange: {
		label: "Grange",
		routeIds: new Set(["GRNG"]),
		terminal: "Grange",
	},
	"port-dock": {
		label: "Port Dock",
		routeIds: new Set(["PTDOCK"]),
		terminal: "Port Dock",
	},
	belair: {
		label: "Belair",
		routeIds: new Set(["BEL"]),
		terminal: "Belair",
	},
} as const;

export type RailLineId = keyof typeof RAIL_LINES;

export const RAIL_LINE_IDS = Object.keys(RAIL_LINES) as RailLineId[];

export function isRailLineId(value: string): value is RailLineId {
	return value in RAIL_LINES;
}

export const ALL_RAIL_ROUTE_IDS = new Set<string>(
	RAIL_LINE_IDS.flatMap((id) => [...RAIL_LINES[id].routeIds]),
);

/** First matching line wins — keep more specific lines before grouped ones. */
const ROUTE_TO_LINE: readonly { id: RailLineId; routes: readonly string[] }[] = [
	{ id: "port-dock", routes: ["PTDOCK"] },
	{ id: "grange", routes: ["GRNG"] },
	{ id: "flinders", routes: ["FLNDRS"] },
	{ id: "belair", routes: ["BEL"] },
	{ id: "gawler", routes: ["GAW", "GAWC", "SALIS"] },
	{ id: "seaford", routes: ["SEAFRD", "NOAR"] },
	{ id: "outer-harbor", routes: ["OUTHA", "OSBORN", "GLAN"] },
];

export function lineIdForRoute(routeId: string): RailLineId | null {
	for (const entry of ROUTE_TO_LINE) {
		if (entry.routes.includes(routeId)) return entry.id;
	}
	return null;
}

export function lineChoiceList(filter = ""): { name: string; value: RailLineId }[] {
	const q = filter.toLowerCase().trim();
	return RAIL_LINE_IDS.filter(
		(id) =>
			!q ||
			id.includes(q) ||
			RAIL_LINES[id].label.toLowerCase().includes(q) ||
			RAIL_LINES[id].terminal.toLowerCase().includes(q),
	).map((id) => ({ name: RAIL_LINES[id].label, value: id }));
}
