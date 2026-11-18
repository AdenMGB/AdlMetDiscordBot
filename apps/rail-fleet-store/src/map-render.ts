import type Database from "better-sqlite3";
import { ACTIVE_NOW_SEC, adelaideNow, routeIdsForLine } from "@metro-mate/rail-fleet-core";
import { buildFleetMapSvg } from "@metro-mate/rail-fleet-core/map-svg";
import { getRailLineTracks } from "@metro-mate/rail-fleet-core/rail-line-tracks";
import type { VehicleRow } from "./db.js";

export type FleetMapQuery = {
	line?: string;
	set?: string;
	routeId?: string;
};

export function buildFleetMapSvgFromDb(
	db: Database.Database,
	query: FleetMapQuery,
): string {
	const line = query.line?.trim() ?? "";
	const set = query.set?.trim() ?? "";
	const routeId = query.routeId?.trim() ?? "";

	const live = db
		.prepare(
			`SELECT * FROM vehicles
			WHERE datetime(last_seen_at) >= datetime('now', '-${ACTIVE_NOW_SEC} seconds')
			AND last_lat IS NOT NULL AND last_lon IS NOT NULL
			AND ABS(last_lat) > 0.01 AND ABS(last_lon) > 0.01`,
		)
		.all() as VehicleRow[];

	let filtered = live;
	if (set) filtered = filtered.filter((v) => v.set_id === set);
	if (routeId) filtered = filtered.filter((v) => v.last_route_id === routeId);
	if (line && routeIdsForLine(line).length > 0) {
		const allowed = new Set(routeIdsForLine(line));
		filtered = filtered.filter(
			(v) => v.last_route_id && allowed.has(v.last_route_id),
		);
	}

	const lineTracks = getRailLineTracks({
		line: line || undefined,
		routeId: routeId || undefined,
	});

	return buildFleetMapSvg(filtered, lineTracks, {
		title: set ? `Set ${set}` : line ? `Line ${line}` : "All trains",
		baseLayer: "osm",
		generatedAt: adelaideNow(),
	});
}