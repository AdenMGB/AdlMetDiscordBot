import {
	ACTIVE_NOW_SEC,
	adelaideDateKey,
	adelaideNow,
	FLEET_PAGE_SIZE,
	lineIdForRoute,
	routeIdsForLine,
	type FleetVehicle,
} from "@metro-mate/rail-fleet-core";
import { buildFleetMapSvg } from "@metro-mate/rail-fleet-core/map-svg";
import { getRailLineTracks } from "@metro-mate/rail-fleet-core/rail-line-tracks";

export type { FleetVehicle };

type FleetRow = FleetVehicle;

function parseBool(v: string | null): boolean {
	return v === "1" || v === "true";
}

function mapVehicle(row: FleetRow) {
	return {
		...row,
		line_id: row.last_route_id ? lineIdForRoute(row.last_route_id) : null,
	};
}

export async function fleetStats(db: D1Database) {
	const today = adelaideDateKey();
	const todayStart = `${today}T00:00:00.000Z`;

	const [vehiclesTracked, activeNow, activeToday, tripsRecorded, samplesRecorded, lastPoll] =
		await Promise.all([
			db
				.prepare(`SELECT COUNT(*) AS c FROM fleet_vehicles`)
				.first<{ c: number }>(),
			db
				.prepare(
					`SELECT COUNT(*) AS c FROM fleet_vehicles
					WHERE datetime(last_seen_at) >= datetime('now', '-${ACTIVE_NOW_SEC} seconds')`,
				)
				.first<{ c: number }>(),
			db
				.prepare(
					`SELECT COUNT(DISTINCT set_id) AS c FROM fleet_position_samples
					WHERE recorded_at >= ?`,
				)
				.bind(todayStart)
				.first<{ c: number }>(),
			db.prepare(`SELECT COUNT(*) AS c FROM fleet_trip_records`).first<{ c: number }>(),
			db
				.prepare(`SELECT COUNT(*) AS c FROM fleet_position_samples`)
				.first<{ c: number }>(),
			db
				.prepare(`SELECT value FROM fleet_collector_meta WHERE key = 'last_poll'`)
				.first<{ value: string }>(),
		]);

	return {
		vehiclesTracked: vehiclesTracked?.c ?? 0,
		activeNow: activeNow?.c ?? 0,
		activeToday: activeToday?.c ?? 0,
		tripsRecorded: tripsRecorded?.c ?? 0,
		samplesRecorded: samplesRecorded?.c ?? 0,
		lastPoll: lastPoll?.value?.trim() ? lastPoll.value : null,
	};
}

export async function fleetLive(
	db: D1Database,
	params: { set?: string; line?: string; route_id?: string },
) {
	const rows = await db
		.prepare(
			`SELECT * FROM fleet_vehicles
			WHERE datetime(last_seen_at) >= datetime('now', '-${ACTIVE_NOW_SEC} seconds')
			ORDER BY set_id`,
		)
		.all<FleetRow>();

	let vehicles = rows.results ?? [];
	const setFilter = params.set?.trim() ?? "";
	const lineFilter = params.line?.trim() ?? "";
	const routeFilter = params.route_id?.trim() ?? "";

	if (setFilter) {
		vehicles = vehicles.filter((r) => r.set_id.includes(setFilter));
	}
	if (routeFilter) {
		vehicles = vehicles.filter((r) => r.last_route_id === routeFilter);
	}
	if (lineFilter && routeIdsForLine(lineFilter).length > 0) {
		const allowed = new Set(routeIdsForLine(lineFilter));
		vehicles = vehicles.filter((r) => r.last_route_id && allowed.has(r.last_route_id));
	}

	return { vehicles, fetchedAt: new Date().toISOString() };
}

export async function fleetList(
	db: D1Database,
	searchParams: URLSearchParams,
): Promise<{ page: number; pageSize: number; total: number; vehicles: ReturnType<typeof mapVehicle>[] }> {
	const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10));
	const vehicleFilter = searchParams.get("vehicle_filter")?.trim() ?? "";
	const routeFilter = searchParams.get("route_filter")?.trim() ?? "";
	const activeNow = parseBool(searchParams.get("active_now"));
	const activeToday = parseBool(searchParams.get("active_today"));
	const lineFilter = searchParams.get("line")?.trim() ?? "";

	const clauses: string[] = [];
	const binds: unknown[] = [];

	if (vehicleFilter) {
		clauses.push(`set_id LIKE ? ESCAPE '\\'`);
		binds.push(`%${vehicleFilter.replace(/[%_\\]/g, "\\$&")}%`);
	}
	if (routeFilter) {
		clauses.push(`last_route_id = ?`);
		binds.push(routeFilter);
	}
	if (lineFilter && routeIdsForLine(lineFilter).length > 0) {
		const ids = routeIdsForLine(lineFilter);
		clauses.push(`last_route_id IN (${ids.map(() => "?").join(",")})`);
		binds.push(...ids);
	}
	if (activeNow) {
		clauses.push(
			`datetime(last_seen_at) >= datetime('now', '-${ACTIVE_NOW_SEC} seconds')`,
		);
	}
	const today = adelaideDateKey();
	if (activeToday) {
		clauses.push(
			`set_id IN (SELECT DISTINCT set_id FROM fleet_position_samples WHERE recorded_at >= ?)`,
		);
		binds.push(`${today}T00:00:00.000Z`);
	}

	const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
	const totalRow = await db
		.prepare(`SELECT COUNT(*) AS c FROM fleet_vehicles ${where}`)
		.bind(...binds)
		.first<{ c: number }>();
	const total = totalRow?.c ?? 0;
	const offset = (page - 1) * FLEET_PAGE_SIZE;

	const vehicles = await db
		.prepare(
			`SELECT * FROM fleet_vehicles ${where} ORDER BY set_id LIMIT ? OFFSET ?`,
		)
		.bind(...binds, FLEET_PAGE_SIZE, offset)
		.all<FleetRow>();

	return {
		page,
		pageSize: FLEET_PAGE_SIZE,
		total,
		vehicles: (vehicles.results ?? []).map(mapVehicle),
	};
}

export async function fleetVehicleDetails(db: D1Database, setId: string) {
	const vehicle = await db
		.prepare(`SELECT * FROM fleet_vehicles WHERE set_id = ?`)
		.bind(setId)
		.first<FleetRow>();
	if (!vehicle) {
		return null;
	}

	const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

	const [trips, tripsPerDay, topRoutes, sampleCount] = await Promise.all([
		db
			.prepare(
				`SELECT * FROM fleet_trip_records WHERE set_id = ?
				ORDER BY started_at DESC LIMIT 60`,
			)
			.bind(setId)
			.all(),
		db
			.prepare(
				`SELECT date(started_at) AS day, COUNT(*) AS trips
				FROM fleet_trip_records
				WHERE set_id = ? AND started_at >= ?
				GROUP BY date(started_at)
				ORDER BY day DESC`,
			)
			.bind(setId, since7d)
			.all<{ day: string; trips: number }>(),
		db
			.prepare(
				`SELECT route_id, COUNT(*) AS c FROM fleet_trip_records
				WHERE set_id = ? AND started_at >= ? AND route_id IS NOT NULL
				GROUP BY route_id ORDER BY c DESC LIMIT 3`,
			)
			.bind(setId, since7d)
			.all<{ route_id: string; c: number }>(),
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM fleet_position_samples
				WHERE set_id = ? AND recorded_at >= ?`,
			)
			.bind(setId, since7d)
			.first<{ c: number }>(),
	]);

	return {
		vehicle: mapVehicle(vehicle),
		tripsLast60: trips.results ?? [],
		tripsPerDay7d: tripsPerDay.results ?? [],
		topRoutes7d: topRoutes.results ?? [],
		trackedSampleCount7d: sampleCount?.c ?? 0,
	};
}

export async function fleetMapSvg(
	db: D1Database,
	searchParams: URLSearchParams,
): Promise<string> {
	const line = searchParams.get("line")?.trim() ?? "";
	const set = searchParams.get("set")?.trim() ?? "";
	const routeId = searchParams.get("route_id")?.trim() ?? "";

	const live = await db
		.prepare(
			`SELECT * FROM fleet_vehicles
			WHERE datetime(last_seen_at) >= datetime('now', '-${ACTIVE_NOW_SEC} seconds')
			AND last_lat IS NOT NULL AND last_lon IS NOT NULL
			AND ABS(last_lat) > 0.01 AND ABS(last_lon) > 0.01`,
		)
		.all<FleetRow>();

	let filtered = live.results ?? [];
	if (set) filtered = filtered.filter((v) => v.set_id === set);
	if (routeId) filtered = filtered.filter((v) => v.last_route_id === routeId);
	if (line && routeIdsForLine(line).length > 0) {
		const allowed = new Set(routeIdsForLine(line));
		filtered = filtered.filter((v) => v.last_route_id && allowed.has(v.last_route_id));
	}

	const lineTracks = getRailLineTracks({
		line: line || undefined,
		routeId: routeId || undefined,
	});

	return buildFleetMapSvg(filtered, lineTracks, {
		title: set ? `Set ${set}` : line ? `Line ${line}` : "All trains",
		baseLayer: "osm",
		generatedAt: adelaideNow(),
	});
}

export async function fleetActiveSetIds(db: D1Database, limit = 25): Promise<string[]> {
	const rows = await db
		.prepare(
			`SELECT set_id FROM fleet_vehicles
			WHERE datetime(last_seen_at) >= datetime('now', '-${ACTIVE_NOW_SEC} seconds')
			ORDER BY set_id LIMIT ?`,
		)
		.bind(limit)
		.all<{ set_id: string }>();
	return (rows.results ?? []).map((r) => r.set_id);
}