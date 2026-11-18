import type { WorkerEnv } from "../env.d";
import { applyFleetSync, parseFleetSyncBody } from "./fleet-sync";
import {
	fleetList,
	fleetLive,
	fleetMapSvg,
	fleetStats,
	fleetVehicleDetails,
} from "./fleet-d1";

import { FLEET_PUBLIC_BASE_URL } from "@metro-mate/rail-fleet-core";

/** Hostname if fleet is later routed on the Worker (optional). */
export const FLEET_HOST = new URL(FLEET_PUBLIC_BASE_URL).hostname;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

function requireFleetBearer(request: Request, env: WorkerEnv): boolean {
	const secret = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
	const expected =
		env.GATEWAY_RELAY_SECRET ?? env.SETUP_SECRET ?? env.ALERTS_CRON_SECRET ?? "";
	return Boolean(expected && secret === expected);
}

export function isFleetHostname(hostname: string): boolean {
	return hostname === FLEET_HOST || hostname === `www.${FLEET_HOST}`;
}

/** Edge collector → D1 (use on api.* when fleet.* DNS points at the local :8791 store). */
export async function handleFleetSyncPost(
	request: Request,
	env: WorkerEnv,
): Promise<Response> {
	if (!env.DB) {
		return json({ error: "D1 not configured" }, 500);
	}
	if (!requireFleetBearer(request, env)) {
		return json({ error: "Unauthorized" }, 401);
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Invalid JSON body" }, 400);
	}
	const payload = parseFleetSyncBody(body);
	if (!payload) {
		return json({ error: "Invalid fleet sync payload" }, 400);
	}
	try {
		const result = await applyFleetSync(env.DB, payload);
		return json({ ok: true, ...result });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Sync failed";
		console.error("fleet sync:", message);
		return json({ error: message }, 500);
	}
}

export async function handleFleetHttpRequest(
	request: Request,
	env: WorkerEnv,
	url: URL,
): Promise<Response> {
	if (!env.DB) {
		return json({ error: "D1 not configured" }, 500);
	}

	if (request.method === "GET" && url.pathname === "/health") {
		const last = await env.DB.prepare(
			`SELECT value FROM fleet_collector_meta WHERE key = 'last_sync_at'`,
		).first<{ value: string }>();
		return json({
			ok: true,
			service: "metro-mate-fleet",
			host: FLEET_HOST,
			lastSyncAt: last?.value?.trim() || null,
		});
	}

	if (request.method === "POST" && url.pathname === "/sync") {
		return handleFleetSyncPost(request, env);
	}

	const needsAuth = url.pathname.startsWith("/api/v1/");
	if (needsAuth && !requireFleetBearer(request, env)) {
		return json({ error: "Unauthorized" }, 401);
	}

	if (request.method === "GET" && url.pathname === "/api/v1/stats") {
		return json(await fleetStats(env.DB));
	}

	if (request.method === "GET" && url.pathname === "/api/v1/live") {
		const data = await fleetLive(env.DB, {
			set: url.searchParams.get("set") ?? undefined,
			line: url.searchParams.get("line") ?? undefined,
			route_id: url.searchParams.get("route_id") ?? undefined,
		});
		return json(data);
	}

	if (request.method === "GET" && url.pathname === "/api/v1/fleet") {
		return json(await fleetList(env.DB, url.searchParams));
	}

	const vehicleMatch = url.pathname.match(/^\/api\/v1\/vehicle\/([^/]+)$/);
	if (request.method === "GET" && vehicleMatch) {
		const setId = decodeURIComponent(vehicleMatch[1]);
		const details = await fleetVehicleDetails(env.DB, setId);
		if (!details) {
			return json({ error: "Vehicle not found" }, 404);
		}
		return json(details);
	}

	if (request.method === "GET" && url.pathname === "/api/v1/map.svg") {
		const svg = await fleetMapSvg(env.DB, url.searchParams);
		return new Response(svg, {
			status: 200,
			headers: {
				"Content-Type": "image/svg+xml; charset=utf-8",
				"Cache-Control": "no-store",
			},
		});
	}

	return new Response("Not found", { status: 404 });
}