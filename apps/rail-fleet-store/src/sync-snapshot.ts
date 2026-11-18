import type Database from "better-sqlite3";
import {
	isoUtcNow,
	type FleetPositionSample,
	type FleetSyncPayload,
	type FleetTripRecord,
	type FleetVehicle,
} from "@metro-mate/rail-fleet-core";

const SAMPLE_SYNC_LIMIT = 50_000;

function metaValue(db: Database.Database, key: string): string | null {
	const row = db
		.prepare(`SELECT value FROM collector_meta WHERE key = @key`)
		.get({ key }) as { value: string } | undefined;
	return row?.value?.trim() || null;
}

export function buildFleetSyncPayload(db: Database.Database): FleetSyncPayload & {
	_lastSampleId: number;
} {
	const lastSyncedId = Number.parseInt(metaValue(db, "last_cf_sync_sample_id") ?? "0", 10);
	const lastPoll = metaValue(db, "last_poll");

	const vehicles = db.prepare(`SELECT * FROM vehicles ORDER BY set_id`).all() as FleetVehicle[];
	const tripRecords = db
		.prepare(`SELECT * FROM trip_records ORDER BY id`)
		.all() as FleetTripRecord[];
	const positionSamples = db
		.prepare(
			`SELECT * FROM position_samples WHERE id > @since ORDER BY id LIMIT @limit`,
		)
		.all({
			since: lastSyncedId,
			limit: SAMPLE_SYNC_LIMIT,
		}) as FleetPositionSample[];

	const maxSampleId = positionSamples.reduce(
		(max, row) => Math.max(max, row.id),
		lastSyncedId,
	);

	return {
		syncedAt: isoUtcNow(),
		meta: { last_poll: lastPoll },
		vehicles,
		tripRecords,
		positionSamples,
		_lastSampleId: maxSampleId,
	};
}

export function markFleetSamplesSynced(db: Database.Database, lastSampleId: number): void {
	db.prepare(
		`INSERT INTO collector_meta (key, value) VALUES ('last_cf_sync_sample_id', @value)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	).run({ value: String(lastSampleId) });
}