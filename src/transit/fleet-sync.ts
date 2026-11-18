import type { FleetSyncPayload } from "@metro-mate/rail-fleet-core";
import { isoUtcNow } from "@metro-mate/rail-fleet-core";

const BATCH_SIZE = 40;

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
	for (let i = 0; i < statements.length; i += BATCH_SIZE) {
		await db.batch(statements.slice(i, i + BATCH_SIZE));
	}
}

export function parseFleetSyncBody(raw: unknown): FleetSyncPayload | null {
	if (!raw || typeof raw !== "object") return null;
	const body = raw as FleetSyncPayload;
	if (!Array.isArray(body.vehicles) || !Array.isArray(body.positionSamples)) {
		return null;
	}
	if (!Array.isArray(body.tripRecords)) return null;
	return body;
}

export async function applyFleetSync(
	db: D1Database,
	payload: FleetSyncPayload,
): Promise<{
	vehicles: number;
	samples: number;
	trips: number;
}> {
	const syncedAt = payload.syncedAt?.trim() || isoUtcNow();
	const statements: D1PreparedStatement[] = [];

	const upsertVehicle = db.prepare(
		`INSERT INTO fleet_vehicles (
			set_id, body_class, chassis, first_seen_at, last_seen_at,
			last_lat, last_lon, last_bearing, last_speed_mps,
			last_route_id, last_trip_id, last_headsign, last_stop_id, last_status,
			next_stop_hint, catalog_updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(set_id) DO UPDATE SET
			body_class = excluded.body_class,
			chassis = excluded.chassis,
			first_seen_at = excluded.first_seen_at,
			last_seen_at = excluded.last_seen_at,
			last_lat = excluded.last_lat,
			last_lon = excluded.last_lon,
			last_bearing = excluded.last_bearing,
			last_speed_mps = excluded.last_speed_mps,
			last_route_id = excluded.last_route_id,
			last_trip_id = excluded.last_trip_id,
			last_headsign = excluded.last_headsign,
			last_stop_id = excluded.last_stop_id,
			last_status = excluded.last_status,
			next_stop_hint = COALESCE(excluded.next_stop_hint, fleet_vehicles.next_stop_hint),
			catalog_updated_at = COALESCE(excluded.catalog_updated_at, fleet_vehicles.catalog_updated_at)`,
	);

	for (const v of payload.vehicles) {
		statements.push(
			upsertVehicle.bind(
				v.set_id,
				v.body_class,
				v.chassis,
				v.first_seen_at,
				v.last_seen_at,
				v.last_lat,
				v.last_lon,
				v.last_bearing,
				v.last_speed_mps,
				v.last_route_id,
				v.last_trip_id,
				v.last_headsign,
				v.last_stop_id,
				v.last_status,
				v.next_stop_hint ?? null,
				v.catalog_updated_at ?? null,
			),
		);
	}

	const upsertSample = db.prepare(
		`INSERT INTO fleet_position_samples (
			id, set_id, trip_id, route_id, lat, lon, bearing, speed_mps, recorded_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			set_id = excluded.set_id,
			trip_id = excluded.trip_id,
			route_id = excluded.route_id,
			lat = excluded.lat,
			lon = excluded.lon,
			bearing = excluded.bearing,
			speed_mps = excluded.speed_mps,
			recorded_at = excluded.recorded_at`,
	);

	for (const s of payload.positionSamples) {
		statements.push(
			upsertSample.bind(
				s.id,
				s.set_id,
				s.trip_id,
				s.route_id,
				s.lat,
				s.lon,
				s.bearing,
				s.speed_mps,
				s.recorded_at,
			),
		);
	}

	const upsertTrip = db.prepare(
		`INSERT INTO fleet_trip_records (
			id, set_id, trip_id, route_id, headsign, started_at, ended_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			set_id = excluded.set_id,
			trip_id = excluded.trip_id,
			route_id = excluded.route_id,
			headsign = excluded.headsign,
			started_at = excluded.started_at,
			ended_at = excluded.ended_at`,
	);

	for (const t of payload.tripRecords) {
		statements.push(
			upsertTrip.bind(
				t.id,
				t.set_id,
				t.trip_id,
				t.route_id,
				t.headsign,
				t.started_at,
				t.ended_at,
			),
		);
	}

	await runBatches(db, statements);

	const lastPoll = payload.meta?.last_poll ?? null;
	await db
		.prepare(
			`INSERT INTO fleet_collector_meta (key, value) VALUES ('last_poll', ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		)
		.bind(lastPoll ?? "")
		.run();
	await db
		.prepare(
			`INSERT INTO fleet_collector_meta (key, value) VALUES ('last_sync_at', ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		)
		.bind(syncedAt)
		.run();

	return {
		vehicles: payload.vehicles.length,
		samples: payload.positionSamples.length,
		trips: payload.tripRecords.length,
	};
}