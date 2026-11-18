import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { RAIL_ROUTE_IDS } from "@metro-mate/rail-fleet-core";

export type ParsedVehicle = {
	setId: string;
	tripId: string;
	routeId: string;
	lat: number;
	lon: number;
	bearing?: number;
	speedMps: number;
	timestampSec: number;
	stopId?: string;
};

export type ParsedTripDelay = Map<string, { routeId: string; headsign: string }>;

function num(v: unknown): number {
	if (typeof v === "bigint") return Number(v);
	if (typeof v === "number") return v;
	return 0;
}

export function parseVehicleFeed(buffer: ArrayBuffer): ParsedVehicle[] {
	const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
		new Uint8Array(buffer),
	);
	const out: ParsedVehicle[] = [];
	for (const ent of feed.entity) {
		const v = ent.vehicle;
		if (!v?.trip?.routeId || !v.vehicle?.label) continue;
		if (!RAIL_ROUTE_IDS.has(v.trip.routeId)) continue;
		if (!v.position?.latitude || !v.position?.longitude) continue;
		const rel = v.trip.scheduleRelationship ?? 0;
		if (rel === 2 || rel === 3) continue;
		out.push({
			setId: v.vehicle.label.trim(),
			tripId: v.trip.tripId ?? "",
			routeId: v.trip.routeId,
			lat: v.position.latitude,
			lon: v.position.longitude,
			bearing: v.position.bearing,
			speedMps: v.position.speed ?? 0,
			timestampSec: num(v.timestamp) || Math.floor(Date.now() / 1000),
			stopId: v.stopId ?? undefined,
		});
	}
	return out;
}

export function parseTripHeadsigns(buffer: ArrayBuffer): ParsedTripDelay {
	const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
		new Uint8Array(buffer),
	);
	const map = new Map<string, { routeId: string; headsign: string }>();
	for (const ent of feed.entity) {
		const tu = ent.tripUpdate;
		if (!tu?.trip?.tripId) continue;
		const headsign =
			(tu as { trip?: { tripHeadsign?: string } }).trip?.tripHeadsign ??
			tu.trip.routeId ??
			"";
		map.set(tu.trip.tripId, {
			routeId: tu.trip.routeId ?? "",
			headsign: String(headsign),
		});
	}
	return map;
}