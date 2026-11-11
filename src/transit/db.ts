import type { D1Database } from "@cloudflare/workers-types";
import { displayStationName } from "./format";
import { isRailLineId, type RailLineId } from "./lines";
import type { DepartureRow } from "./timetable";

export type StationRow = { stop_id: string; name: string };

function dedupeDepartureRows(rows: DepartureRow[]): DepartureRow[] {
	const seen = new Set<string>();
	const out: DepartureRow[] = [];
	for (const row of rows) {
		const key = `${row.depart_at}|${row.headsign}|${row.direction_kind}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(row);
	}
	return out;
}

/** One row per physical station (GTFS may list multiple platform stop_ids). */
export async function listStationsForLine(
	db: D1Database,
	lineId: RailLineId,
	search = "",
	limit = 25,
): Promise<StationRow[]> {
	const q = `%${search.trim()}%`;
	const { results } = await db
		.prepare(
			`SELECT MIN(stop_id) AS stop_id, name FROM rail_stations
       WHERE line_id = ? AND name LIKE ?
       GROUP BY name
       ORDER BY name
       LIMIT ?`,
		)
		.bind(lineId, q, limit)
		.all<StationRow>();
	return results ?? [];
}

export async function getStationOnLine(
	db: D1Database,
	lineId: RailLineId,
	stationKey: string,
): Promise<StationRow | null> {
	const row = await db
		.prepare(
			`SELECT MIN(stop_id) AS stop_id, name FROM rail_stations
       WHERE line_id = ? AND (stop_id = ? OR name = ?)
       GROUP BY name
       LIMIT 1`,
		)
		.bind(lineId, stationKey, stationKey)
		.first<StationRow>();
	return row ?? null;
}

export async function fetchUpcomingDepartures(
	db: D1Database,
	lineId: RailLineId,
	stationName: string,
	fromSec: number,
	limit = 400,
): Promise<DepartureRow[]> {
	const { results } = await db
		.prepare(
			`SELECT d.depart_at, d.headsign, d.direction_kind
       FROM rail_departures d
       WHERE d.stop_id IN (
         SELECT stop_id FROM rail_stations WHERE line_id = ? AND name = ?
       )
       AND d.depart_at >= ?
       ORDER BY d.depart_at
       LIMIT ?`,
		)
		.bind(lineId, stationName, fromSec, limit)
		.all<DepartureRow>();
	return dedupeDepartureRows(results ?? []);
}

export async function getGtfsMeta(db: D1Database, key: string): Promise<string | null> {
	const row = await db
		.prepare(`SELECT value FROM gtfs_meta WHERE key = ? LIMIT 1`)
		.bind(key)
		.first<{ value: string }>();
	return row?.value ?? null;
}

export async function stationAutocompleteChoices(
	db: D1Database,
	lineIdRaw: string,
	focusedValue: string,
): Promise<{ name: string; value: string }[]> {
	if (!isRailLineId(lineIdRaw)) return [];
	const rows = await listStationsForLine(db, lineIdRaw, focusedValue, 25);
	return rows.map((s) => ({
		name: displayStationName(s.name).slice(0, 100),
		value: s.name.slice(0, 100),
	}));
}
