import type { D1Database } from "@cloudflare/workers-types";
import type { LatLon } from "./geography";
import { displayStationName } from "./format";

/** SQLite/D1 bind limit per statement (~999); keep headroom for large live feeds. */
const IN_CLAUSE_CHUNK = 200;

export type LiveDbContext = {
	tripMeta: Map<string, { route_id: string; headsign: string }>;
	stops: Map<string, LatLon>;
	tripPaths: Map<string, LatLon[]>;
};

function toLatLon(row: {
	stop_id: string;
	name: string;
	lat: number;
	lon: number;
}): LatLon {
	return {
		stopId: row.stop_id,
		name: displayStationName(row.name),
		lat: row.lat,
		lon: row.lon,
	};
}

async function queryIdsInChunks<T>(
	db: D1Database,
	ids: string[],
	sqlForPlaceholders: (placeholders: string) => string,
): Promise<T[]> {
	const out: T[] = [];
	for (let offset = 0; offset < ids.length; offset += IN_CLAUSE_CHUNK) {
		const chunk = ids.slice(offset, offset + IN_CLAUSE_CHUNK);
		const placeholders = chunk.map(() => "?").join(",");
		const { results } = await db.prepare(sqlForPlaceholders(placeholders)).bind(...chunk).all<T>();
		out.push(...(results ?? []));
	}
	return out;
}

export async function loadLiveDbContext(
	db: D1Database,
	tripIds: string[],
	stopIds: string[],
): Promise<LiveDbContext> {
	const tripMeta = new Map<string, { route_id: string; headsign: string }>();
	const stops = new Map<string, LatLon>();
	const tripPaths = new Map<string, LatLon[]>();

	const uniqueTripIds = [...new Set(tripIds)];
	if (uniqueTripIds.length > 0) {
		const trips = await queryIdsInChunks<{
			trip_id: string;
			route_id: string;
			headsign: string;
		}>(db, uniqueTripIds, (ph) =>
			`SELECT trip_id, route_id, headsign FROM rail_trips WHERE trip_id IN (${ph})`,
		);
		for (const row of trips) {
			tripMeta.set(row.trip_id, {
				route_id: row.route_id,
				headsign: row.headsign,
			});
		}

		const pathRows = await queryIdsInChunks<{
			trip_id: string;
			stop_sequence: number;
			stop_id: string;
			name: string;
			lat: number;
			lon: number;
		}>(
			db,
			uniqueTripIds,
			(ph) => `SELECT ts.trip_id, ts.stop_sequence, s.stop_id, s.name, s.lat, s.lon
         FROM rail_trip_stops ts
         JOIN rail_stops s ON s.stop_id = ts.stop_id
         WHERE ts.trip_id IN (${ph})
         ORDER BY ts.trip_id, ts.stop_sequence`,
		);
		for (const row of pathRows) {
			const list = tripPaths.get(row.trip_id) ?? [];
			list.push(toLatLon(row));
			tripPaths.set(row.trip_id, list);
		}
	}

	const uniqueStops = [...new Set(stopIds)];
	if (uniqueStops.length > 0) {
		const results = await queryIdsInChunks<{
			stop_id: string;
			name: string;
			lat: number;
			lon: number;
		}>(
			db,
			uniqueStops,
			(ph) => `SELECT stop_id, name, lat, lon FROM rail_stops WHERE stop_id IN (${ph})`,
		);
		for (const row of results) {
			stops.set(row.stop_id, toLatLon(row));
		}
	}

	return { tripMeta, stops, tripPaths };
}

export function getStopFromContext(
	ctx: LiveDbContext,
	stopId: string,
): LatLon | null {
	return ctx.stops.get(stopId) ?? null;
}

export function getTripStopBySequence(
	ctx: LiveDbContext,
	tripId: string,
	sequence: number,
): LatLon | null {
	const path = ctx.tripPaths.get(tripId);
	if (!path) return null;
	return path[sequence - 1] ?? null;
}