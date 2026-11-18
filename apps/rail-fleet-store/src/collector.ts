import type Database from "better-sqlite3";
import {
	adelaideDateKey,
	inferFleetMeta,
	isoUtcNow,
	RAIL_ROUTE_IDS,
} from "@metro-mate/rail-fleet-core";
// RAIL_ROUTE_IDS used in poll loop filter
import { parseTripHeadsigns, parseVehicleFeed, type ParsedVehicle } from "./rt-parse";

export type CollectorConfig = {
	vpUrl: string;
	tuUrl: string;
	pollMs: number;
};

type ActiveTrip = { tripId: string; recordId: number };

export class RailCollector {
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly activeTrips = new Map<string, ActiveTrip>();
	lastPollAt: string | null = null;
	lastVehicleCount = 0;

	constructor(
		private readonly db: Database.Database,
		private readonly config: CollectorConfig,
	) {}

	start(): void {
		void this.poll();
		this.timer = setInterval(() => void this.poll(), this.config.pollMs);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	private upsertVehicle(v: ParsedVehicle, headsign: string, now: string) {
		const meta = inferFleetMeta(v.setId);
		const status =
			v.speedMps < 0.5 && v.lat !== 0 ? "IN SERVICE" : "IN SERVICE";

		this.db
			.prepare(
				`INSERT INTO vehicles (
			set_id, body_class, chassis, first_seen_at, last_seen_at,
			last_lat, last_lon, last_bearing, last_speed_mps,
			last_route_id, last_trip_id, last_headsign, last_stop_id, last_status
		) VALUES (
			@set_id, @body_class, @chassis, @now, @now,
			@lat, @lon, @bearing, @speed, @route_id, @trip_id, @headsign, @stop_id, @status
		)
		ON CONFLICT(set_id) DO UPDATE SET
			last_seen_at = @now,
			last_lat = @lat,
			last_lon = @lon,
			last_bearing = @bearing,
			last_speed_mps = @speed,
			last_route_id = @route_id,
			last_trip_id = @trip_id,
			last_headsign = @headsign,
			last_stop_id = @stop_id,
			last_status = @status`,
			)
			.run({
				set_id: v.setId,
				body_class: meta.body,
				chassis: meta.chassis,
				now,
				lat: v.lat,
				lon: v.lon,
				bearing: v.bearing ?? null,
				speed: v.speedMps,
				route_id: v.routeId,
				trip_id: v.tripId,
				headsign,
				stop_id: v.stopId ?? null,
				status,
			});
	}

	private trackTrip(v: ParsedVehicle, headsign: string, now: string) {
		const prev = this.activeTrips.get(v.setId);
		if (prev?.tripId === v.tripId) return;

		if (prev) {
			this.db
				.prepare(
					`UPDATE trip_records SET ended_at = @now WHERE id = @id AND ended_at IS NULL`,
				)
				.run({ now, id: prev.recordId });
		}

		const ins = this.db
			.prepare(
				`INSERT INTO trip_records (set_id, trip_id, route_id, headsign, started_at)
			 VALUES (@set_id, @trip_id, @route_id, @headsign, @now)`,
			)
			.run({
				set_id: v.setId,
				trip_id: v.tripId,
				route_id: v.routeId,
				headsign,
				now,
			});

		this.activeTrips.set(v.setId, {
			tripId: v.tripId,
			recordId: Number(ins.lastInsertRowid),
		});
	}

	async poll(): Promise<void> {
		const [vpRes, tuRes] = await Promise.all([
			fetch(this.config.vpUrl),
			fetch(this.config.tuUrl),
		]);
		if (!vpRes.ok) {
			throw new Error(`vehicle_positions ${vpRes.status}`);
		}

		const vehicles = parseVehicleFeed(await vpRes.arrayBuffer());
		let headsigns = new Map<string, { routeId: string; headsign: string }>();
		if (tuRes.ok) {
			headsigns = parseTripHeadsigns(await tuRes.arrayBuffer());
		}

		const now = isoUtcNow();
		const insertSample = this.db.prepare(
			`INSERT INTO position_samples (set_id, trip_id, route_id, lat, lon, bearing, speed_mps, recorded_at)
			 VALUES (@set_id, @trip_id, @route_id, @lat, @lon, @bearing, @speed, @now)`,
		);

		const seen = new Set<string>();
		for (const v of vehicles) {
			if (!RAIL_ROUTE_IDS.has(v.routeId)) continue;
			const hs = headsigns.get(v.tripId)?.headsign ?? v.routeId;
			this.upsertVehicle(v, hs, now);
			this.trackTrip(v, hs, now);
			insertSample.run({
				set_id: v.setId,
				trip_id: v.tripId,
				route_id: v.routeId,
				lat: v.lat,
				lon: v.lon,
				bearing: v.bearing ?? null,
				speed: v.speedMps,
				now,
			});
			seen.add(v.setId);
		}

		for (const [setId, active] of this.activeTrips) {
			if (!seen.has(setId)) {
				this.db
					.prepare(
						`UPDATE trip_records SET ended_at = @now WHERE id = @id AND ended_at IS NULL`,
					)
					.run({ now, id: active.recordId });
				this.activeTrips.delete(setId);
			}
		}

		this.db
			.prepare(
				`INSERT INTO collector_meta (key, value) VALUES ('last_poll', @v)
			 ON CONFLICT(key) DO UPDATE SET value = @v`,
			)
			.run({ v: now });

		this.db
			.prepare(
				`INSERT INTO collector_meta (key, value) VALUES ('last_adelaide_day', @v)
			 ON CONFLICT(key) DO UPDATE SET value = @v`,
			)
			.run({ v: adelaideDateKey() });

		this.lastPollAt = now;
		this.lastVehicleCount = vehicles.length;
	}
}