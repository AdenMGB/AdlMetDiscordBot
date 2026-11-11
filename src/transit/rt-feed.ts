import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const VP_URL = "https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions";
const TU_URL = "https://gtfs.adelaidemetro.com.au/v1/realtime/trip_updates";

export type LiveVehicle = {
	tripId: string;
	routeId: string;
	setLabel: string;
	lat: number;
	lon: number;
	speedMps: number;
	bearing?: number;
	timestampSec: number;
	scheduleRelationship: number;
};

export type LiveTripStopUpdate = {
	stopId: string;
	stopSequence: number;
	arrivalDelaySec: number;
	departureDelaySec: number;
};

export type LiveTripUpdate = {
	tripId: string;
	routeId: string;
	delaySec: number;
	stops: LiveTripStopUpdate[];
};

function num(v: unknown): number {
	if (typeof v === "bigint") return Number(v);
	if (typeof v === "number") return v;
	return 0;
}

function decodeFeed(buffer: ArrayBuffer) {
	return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
		new Uint8Array(buffer),
	);
}

function parseVehicleFeed(buffer: ArrayBuffer): LiveVehicle[] {
	const vpFeed = decodeFeed(buffer);
	const vehicles: LiveVehicle[] = [];
	for (const ent of vpFeed.entity) {
		const v = ent.vehicle;
		if (!v?.trip?.routeId || !v.vehicle?.label) continue;
		if (!v.position?.latitude || !v.position?.longitude) continue;
		vehicles.push({
			tripId: v.trip.tripId ?? "",
			routeId: v.trip.routeId,
			setLabel: v.vehicle.label,
			lat: v.position.latitude,
			lon: v.position.longitude,
			speedMps: v.position.speed ?? 0,
			bearing: v.position.bearing,
			timestampSec: num(v.timestamp) || Math.floor(Date.now() / 1000),
			scheduleRelationship: v.trip.scheduleRelationship ?? 0,
		});
	}
	return vehicles;
}

/** Vehicle positions only (fast — used for set autocomplete). */
export async function fetchLiveRailVehicles(): Promise<LiveVehicle[]> {
	const vpRes = await fetch(VP_URL);
	if (!vpRes.ok) {
		throw new Error(`GTFS-RT vehicle feed unreachable (${vpRes.status})`);
	}
	return parseVehicleFeed(await vpRes.arrayBuffer());
}

export async function fetchLiveRailFeeds(): Promise<{
	vehicles: LiveVehicle[];
	tripUpdates: Map<string, LiveTripUpdate>;
}> {
	const [vpRes, tuRes] = await Promise.all([fetch(VP_URL), fetch(TU_URL)]);
	if (!vpRes.ok || !tuRes.ok) {
		throw new Error(`GTFS-RT unreachable (${vpRes.status}/${tuRes.status})`);
	}

	const vehicles = parseVehicleFeed(await vpRes.arrayBuffer());
	const tuFeed = decodeFeed(await tuRes.arrayBuffer());

	const tripUpdates = new Map<string, LiveTripUpdate>();
	for (const ent of tuFeed.entity) {
		const tu = ent.tripUpdate;
		if (!tu?.trip?.tripId) continue;
		const stops: LiveTripStopUpdate[] = [];
		for (const st of tu.stopTimeUpdate ?? []) {
			if (!st.stopId || !st.stopSequence) continue;
			stops.push({
				stopId: st.stopId,
				stopSequence: st.stopSequence,
				arrivalDelaySec: st.arrival?.delay ?? 0,
				departureDelaySec: st.departure?.delay ?? 0,
			});
		}
		stops.sort((a, b) => a.stopSequence - b.stopSequence);
		tripUpdates.set(tu.trip.tripId, {
			tripId: tu.trip.tripId,
			routeId: tu.trip.routeId ?? "",
			delaySec: tu.trip.delay ?? 0,
			stops,
		});
	}

	return { vehicles, tripUpdates };
}
