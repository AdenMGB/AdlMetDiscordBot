/** Adelaide Metro rail route_ids from GTFS-RT (collector filter). */
export const RAIL_ROUTE_IDS = new Set([
	"BEL",
	"FLNDRS",
	"GAW",
	"GAWC",
	"GRNG",
	"OUTHA",
	"OSBORN",
	"GLAN",
	"PTDOCK",
	"SEAFRD",
	"NOAR",
	"SALIS",
]);

export const LINE_ROUTE_MAP: Record<string, readonly string[]> = {
	gawler: ["GAW", "GAWC", "SALIS"],
	seaford: ["SEAFRD", "NOAR"],
	flinders: ["FLNDRS"],
	"outer-harbor": ["OUTHA", "OSBORN", "GLAN"],
	grange: ["GRNG"],
	"port-dock": ["PTDOCK"],
	belair: ["BEL"],
};

export const LINE_LABELS: Record<string, string> = {
	gawler: "Gawler",
	seaford: "Seaford",
	flinders: "Flinders",
	"outer-harbor": "Outer Harbor",
	grange: "Grange",
	"port-dock": "Port Dock",
	belair: "Belair",
};

/** Adelaide Metro line accent colors (map overlays & markers). */
export const LINE_COLORS: Record<string, string> = {
	gawler: "#E31937",
	seaford: "#0072CE",
	flinders: "#6BA539",
	"outer-harbor": "#F7941D",
	grange: "#8E4C9E",
	"port-dock": "#00A9E0",
	belair: "#F5B800",
};

export function lineColorForLine(lineId: string): string {
	return LINE_COLORS[lineId] ?? "#546E7A";
}

export function lineColorForRoute(routeId: string | null | undefined): string {
	if (!routeId) return "#546E7A";
	const lineId = lineIdForRoute(routeId);
	return lineId ? lineColorForLine(lineId) : "#546E7A";
}

export function isRailLineId(value: string): boolean {
	return value in LINE_ROUTE_MAP;
}

export function routeIdsForLine(lineId: string): string[] {
	return [...(LINE_ROUTE_MAP[lineId] ?? [])];
}

export function lineIdForRoute(routeId: string): string | null {
	for (const [lineId, routes] of Object.entries(LINE_ROUTE_MAP)) {
		if (routes.includes(routeId)) return lineId;
	}
	return null;
}

export function inferFleetMeta(setId: string): { body: string; chassis: string } {
	const n = Number.parseInt(setId, 10);
	if (Number.isFinite(n)) {
		if (n >= 4000) {
			return { body: "4000 Class A-City", chassis: "Bombardier" };
		}
		if (n >= 3100) {
			return { body: "3100 Class", chassis: "Comeng/Clyde" };
		}
		if (n >= 3000) {
			return { body: "3000 Class", chassis: "Comeng/Clyde" };
		}
	}
	return { body: "Railcar", chassis: "Adelaide Metro" };
}

const ADELAIDE = "Australia/Adelaide";

export function adelaideNow(): Date {
	return new Date(new Date().toLocaleString("en-US", { timeZone: ADELAIDE }));
}

/** Friendly stamp for map footers and captions (Adelaide time). */
export function formatAdelaideDateTime(d = adelaideNow()): string {
	return d.toLocaleString("en-AU", {
		timeZone: ADELAIDE,
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
}

export function adelaideDateKey(d = adelaideNow()): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function isoUtcNow(): string {
	return new Date().toISOString();
}

export type FleetVehicle = {
	set_id: string;
	body_class: string;
	chassis: string;
	first_seen_at: string;
	last_seen_at: string;
	last_lat: number | null;
	last_lon: number | null;
	last_bearing: number | null;
	last_speed_mps: number | null;
	last_route_id: string | null;
	last_trip_id: string | null;
	last_headsign: string | null;
	last_stop_id: string | null;
	last_status: string;
	next_stop_hint?: string | null;
	catalog_updated_at?: string | null;
};

export type FleetTripRecord = {
	id: number;
	set_id: string;
	trip_id: string | null;
	route_id: string | null;
	headsign: string | null;
	started_at: string;
	ended_at: string | null;
};

export type FleetPositionSample = {
	id: number;
	set_id: string;
	trip_id: string | null;
	route_id: string | null;
	lat: number;
	lon: number;
	bearing: number | null;
	speed_mps: number | null;
	recorded_at: string;
};

export type FleetSyncPayload = {
	syncedAt: string;
	meta: { last_poll: string | null };
	vehicles: FleetVehicle[];
	tripRecords: FleetTripRecord[];
	positionSamples: FleetPositionSample[];
};

export const ACTIVE_NOW_SEC = 120;
export const FLEET_PAGE_SIZE = 20;
/** Public edge fleet API (HTTPS on VPS → :8791). */
export const FLEET_PUBLIC_BASE_URL = "https://adlmetfleet.adenmgb.com";