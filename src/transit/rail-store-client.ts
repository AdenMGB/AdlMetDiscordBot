import { FLEET_PUBLIC_BASE_URL } from "@metro-mate/rail-fleet-core";
import type { WorkerEnv } from "../env.d";

export type StoredVehicle = {
	set_id: string;
	body_class: string;
	chassis: string;
	last_seen_at: string;
	last_lat: number | null;
	last_lon: number | null;
	last_bearing: number | null;
	last_route_id: string | null;
	last_trip_id: string | null;
	last_headsign: string | null;
	last_status: string;
	line_id?: string | null;
};

function storeBase(env: WorkerEnv): string {
	return (env.RAIL_STORE_URL ?? FLEET_PUBLIC_BASE_URL).trim().replace(/\/$/, "");
}

function storeSecret(env: WorkerEnv): string | null {
	return env.RAIL_STORE_SECRET ?? env.GATEWAY_RELAY_SECRET ?? env.SETUP_SECRET ?? null;
}

async function railStoreGet<T>(env: WorkerEnv, path: string): Promise<T> {
	const base = storeBase(env);
	const secret = storeSecret(env);
	if (!secret) {
		throw new Error("RAIL_STORE_SECRET / GATEWAY_RELAY_SECRET not configured");
	}
	const response = await fetch(`${base}${path}`, {
		headers: { Authorization: `Bearer ${secret}` },
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Rail store ${response.status}: ${body.slice(0, 200)}`);
	}
	return (await response.json()) as T;
}

export async function fetchFleetStats(env: WorkerEnv) {
	return railStoreGet<{
		vehiclesTracked: number;
		activeNow: number;
		activeToday: number;
		tripsRecorded: number;
		samplesRecorded: number;
		lastPoll: string | null;
	}>(env, "/api/v1/stats");
}

export async function fetchFleetList(
	env: WorkerEnv,
	query: URLSearchParams,
): Promise<{
	page: number;
	total: number;
	vehicles: StoredVehicle[];
}> {
	return railStoreGet(env, `/api/v1/fleet?${query.toString()}`);
}

export async function fetchVehicleDetails(env: WorkerEnv, setId: string) {
	return railStoreGet<{
		vehicle: StoredVehicle;
		tripsLast60: {
			route_id: string | null;
			headsign: string | null;
			started_at: string;
			ended_at: string | null;
		}[];
		tripsPerDay7d: { day: string; trips: number }[];
		topRoutes7d: { route_id: string; c: number }[];
		trackedSampleCount7d: number;
	}>(env, `/api/v1/vehicle/${encodeURIComponent(setId)}`);
}

export async function fetchFleetMapWebp(
	env: WorkerEnv,
	query: URLSearchParams,
): Promise<Uint8Array> {
	const base = storeBase(env);
	const secret = storeSecret(env);
	if (!secret) {
		throw new Error("RAIL_STORE_SECRET / GATEWAY_RELAY_SECRET not configured");
	}
	const response = await fetch(`${base}/api/v1/map.webp?${query.toString()}`, {
		headers: { Authorization: `Bearer ${secret}` },
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Rail store map ${response.status}: ${body.slice(0, 200)}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}