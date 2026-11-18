import type Database from "better-sqlite3";
import {
	buildFleetSyncPayload,
	markFleetSamplesSynced,
} from "./sync-snapshot.js";

export type FleetSyncPushConfig = {
	syncUrl: string;
	secret: string;
	intervalMs: number;
};

export async function pushFleetSyncSnapshot(
	db: Database.Database,
	syncUrl: string,
	secret: string,
): Promise<void> {
	const url = syncUrl.replace(/\/$/, "");
	if (!url || !secret) {
		throw new Error("Missing FLEET_SYNC_URL or secret");
	}
	const payload = buildFleetSyncPayload(db);
	const { _lastSampleId, ...body } = payload;
	const response = await fetch(`${url}/sync`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secret}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`CF fleet sync ${response.status}: ${text.slice(0, 300)}`);
	}
	markFleetSamplesSynced(db, _lastSampleId);
}

export function startFleetSyncPush(
	db: Database.Database,
	config: FleetSyncPushConfig,
): void {
	const url = config.syncUrl.replace(/\/$/, "");
	if (!url || !config.secret) {
		console.warn(
			"Fleet CF sync disabled (set FLEET_SYNC_URL + RAIL_STORE_SECRET or GATEWAY_RELAY_SECRET)",
		);
		return;
	}

	const push = async () => {
		try {
			const payload = buildFleetSyncPayload(db);
			const { _lastSampleId, ...body } = payload;
			const response = await fetch(`${url}/sync`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${config.secret}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});
			if (!response.ok) {
				const text = await response.text();
				throw new Error(`CF fleet sync ${response.status}: ${text.slice(0, 300)}`);
			}
			markFleetSamplesSynced(db, _lastSampleId);
			const result = (await response.json()) as { samples?: number };
			console.log(
				`Fleet sync OK → ${url} (vehicles ${body.vehicles.length}, samples ${result.samples ?? body.positionSamples.length})`,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("Fleet sync failed:", message);
		}
	};

	void push();
	setInterval(push, Math.max(60_000, config.intervalMs));
}