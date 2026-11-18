import fs from "node:fs";
import path from "node:path";

function parseEnvFile(filePath: string): Record<string, string> {
	if (!fs.existsSync(filePath)) return {};
	const out: Record<string, string> = {};
	for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (value) out[key] = value;
	}
	return out;
}

export function loadEnv() {
	const fromFile = {
		...parseEnvFile(path.join(process.cwd(), ".env")),
		...parseEnvFile(path.join(process.cwd(), "apps/rail-fleet-store/.env")),
	};

	const secret =
		fromFile.RAIL_STORE_SECRET ??
		process.env.RAIL_STORE_SECRET ??
		fromFile.GATEWAY_RELAY_SECRET ??
		process.env.GATEWAY_RELAY_SECRET ??
		"";

	const fleetSyncUrl =
		fromFile.FLEET_SYNC_URL ??
		process.env.FLEET_SYNC_URL ??
		"https://api.adlmetbot.adenmgb.com";

	const fleetSyncIntervalMs = Number.parseInt(
		fromFile.FLEET_SYNC_INTERVAL_MS ??
			process.env.FLEET_SYNC_INTERVAL_MS ??
			String(15 * 60 * 1000),
		10,
	);

	return {
		secret,
		fleetSyncUrl,
		fleetSyncIntervalMs,
		port: Number.parseInt(
			fromFile.RAIL_STORE_PORT ?? process.env.RAIL_STORE_PORT ?? "8791",
			10,
		),
		dbPath:
			fromFile.RAIL_STORE_DB ??
			process.env.RAIL_STORE_DB ??
			path.join(process.cwd(), "data/rail-fleet.sqlite"),
		pollMs: Number.parseInt(
			fromFile.RAIL_POLL_MS ?? process.env.RAIL_POLL_MS ?? "30000",
			10,
		),
		vpUrl:
			fromFile.VP_URL ??
			process.env.VP_URL ??
			"https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions",
		tuUrl:
			fromFile.TU_URL ??
			process.env.TU_URL ??
			"https://gtfs.adelaidemetro.com.au/v1/realtime/trip_updates",
	};
}