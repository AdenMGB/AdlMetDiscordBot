import type { D1Database } from "@cloudflare/workers-types";
import type { LatLon } from "./geography";
import { displayStationName } from "./format";

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

export async function loadLiveDbContext(
	db: D1Database,
	tripIds: string[],
	stopIds: string[],
): Promise<LiveDbContext> {
	const tripMeta = new Map<string, { route_id: string; headsign: string }>();
	const stops = new Map<string, LatLon>();
	const tripPaths = new Map<string, LatLon[]>();

	if (tripIds.length > 0) {
		const placeholders = tripIds.map(() => "?").join(",");
		const { results: trips } = await db
			.prepare(
				`SELECT trip_id, route_id, headsign FROM rail_trips WHERE trip_id IN (${placeholders})`,
			)
			.bind(...tripIds)
			.all<{ trip_id: string; route_id: string; headsign: string }>();
		for (const row of trips ?? []) {
			tripMeta.set(row.trip_id, {
				route_id: row.route_id,
				headsign: row.headsign,
			});
		}

		const { results: pathRows } = await db
			.prepare(
				`SELECT ts.trip_id, ts.stop_sequence, s.stop_id, s.name, s.lat, s.lon
         FROM rail_trip_stops ts
         JOIN rail_stops s ON s.stop_id = ts.stop_id
         WHERE ts.trip_id IN (${placeholders})
         ORDER BY ts.trip_id, ts.stop_sequence`,
			)
			.bind(...tripIds)
			.all<{
				trip_id: string;
				stop_sequence: number;
				stop_id: string;
				name: string;
				lat: number;
				lon: number;
			}>();
		for (const row of pathRows ?? []) {
			const list = tripPaths.get(row.trip_id) ?? [];
			list.push(toLatLon(row));
			tripPaths.set(row.trip_id, list);
		}
	}

	const uniqueStops = [...new Set(stopIds)];
	if (uniqueStops.length > 0) {
		const placeholders = uniqueStops.map(() => "?").join(",");
		const { results } = await db
			.prepare(
				`SELECT stop_id, name, lat, lon FROM rail_stops WHERE stop_id IN (${placeholders})`,
			)
			.bind(...uniqueStops)
			.all<{ stop_id: string; name: string; lat: number; lon: number }>();
		for (const row of results ?? []) {
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
