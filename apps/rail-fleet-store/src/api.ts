import type http from "node:http";
import type Database from "better-sqlite3";
import {
	adelaideDateKey,
	lineIdForRoute,
	routeIdsForLine,
} from "@metro-mate/rail-fleet-core";
import type { VehicleRow } from "./db";
import { buildFleetMapSvgFromDb } from "./map-render.js";
import { fleetMapSvgToWebp } from "./map-webp.js";

const PAGE_SIZE = 20;
const ACTIVE_NOW_SEC = 120;

function json(res: http.ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

function bad(res: http.ServerResponse, status: number, message: string) {
	json(res, status, { error: message });
}

function parseBool(v: string | null): boolean {
	return v === "1" || v === "true";
}

export function createApiHandler(
	db: Database.Database,
	authSecret: string,
): http.RequestListener {
	return (req, res) => {
		void handleRequest(req, res, db, authSecret);
	};
}

async function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	db: Database.Database,
	authSecret: string,
): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		if (req.method === "GET" && url.pathname === "/health") {
			const last =
				db
					.prepare(`SELECT value FROM collector_meta WHERE key = 'last_poll'`)
					.get() as { value: string } | undefined;
			json(res, 200, {
				ok: true,
				service: "rail-fleet-store",
				lastPoll: last?.value ?? null,
			});
			return;
		}

		const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
		if (!authSecret || auth !== authSecret) {
			bad(res, 401, "Unauthorized");
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/v1/stats") {
			const today = adelaideDateKey();
			const stats = {
				vehiclesTracked: (
					db.prepare(`SELECT COUNT(*) AS c FROM vehicles`).get() as { c: number }
				).c,
				activeNow: (
					db
						.prepare(
							`SELECT COUNT(*) AS c FROM vehicles
							WHERE datetime(last_seen_at) >= datetime('now', '-${ACTIVE_NOW_SEC} seconds')`,
						)
						.get() as { c: number }
				).c,
				activeToday: (
					db
						.prepare(
							`SELECT COUNT(DISTINCT set_id) AS c FROM position_samples
							WHERE recorded_at >= @start`,
						)
						.bind({ start: `${today}T00:00:00.000Z` })
						.get() as { c: number }
				).c,
				tripsRecorded: (
					db.prepare(`SELECT COUNT(*) AS c FROM trip_records`).get() as { c: number }
				).c,
				samplesRecorded: (
					db.prepare(`SELECT COUNT(*) AS c FROM position_samples`).get() as {
						c: number;
					}
				).c,
				lastPoll:
					(
						db
							.prepare(`SELECT value FROM collector_meta WHERE key = 'last_poll'`)
							.get() as { value: string } | undefined
					)?.value ?? null,
			};
			json(res, 200, stats);
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/v1/live") {
			const setFilter = url.searchParams.get("set")?.trim() ?? "";
			const lineFilter = url.searchParams.get("line")?.trim() ?? "";
			const routeFilter = url.searchParams.get("route_id")?.trim() ?? "";

			let rows = db
				.prepare(
					`SELECT * FROM vehicles
					WHERE datetime(last_seen_at) >= datetime('now', '-${ACTIVE_NOW_SEC} seconds')
					ORDER BY set_id`,
				)
				.all() as VehicleRow[];

			if (setFilter) {
				rows = rows.filter((r) => r.set_id.includes(setFilter));
			}
			if (routeFilter) {
				rows = rows.filter((r) => r.last_route_id === routeFilter);
			}
			if (lineFilter && routeIdsForLine(lineFilter).length > 0) {
				const allowed = new Set(routeIdsForLine(lineFilter));
				rows = rows.filter((r) => r.last_route_id && allowed.has(r.last_route_id));
			}
			json(res, 200, { vehicles: rows, fetchedAt: new Date().toISOString() });
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/v1/fleet") {
			const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
			const vehicleFilter = url.searchParams.get("vehicle_filter")?.trim() ?? "";
			const routeFilter = url.searchParams.get("route_filter")?.trim() ?? "";
			const activeNow = parseBool(url.searchParams.get("active_now"));
			const activeToday = parseBool(url.searchParams.get("active_today"));
			const lineFilter = url.searchParams.get("line")?.trim() ?? "";

			const clauses: string[] = [];
			const params: Record<string, string> = {};

			if (vehicleFilter) {
				clauses.push(`set_id LIKE @vf ESCAPE '\\'`);
				params.vf = `%${vehicleFilter.replace(/[%_\\]/g, "\\$&")}%`;
			}
			if (routeFilter) {
				clauses.push(`last_route_id = @route`);
				params.route = routeFilter;
			}
			if (lineFilter && routeIdsForLine(lineFilter).length > 0) {
				const ids = routeIdsForLine(lineFilter);
				clauses.push(
					`last_route_id IN (${ids.map((_, i) => `@r${i}`).join(",")})`,
				);
				ids.forEach((id, i) => {
					params[`r${i}`] = id;
				});
			}
			if (activeNow) {
				clauses.push(
					`datetime(last_seen_at) >= datetime('now', '-${ACTIVE_NOW_SEC} seconds')`,
				);
			}
			if (activeToday) {
				const today = adelaideDateKey();
				clauses.push(
					`set_id IN (SELECT DISTINCT set_id FROM position_samples WHERE recorded_at >= @todayStart)`,
				);
				params.todayStart = `${today}T00:00:00.000Z`;
			}

			const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
			const total = (
				db.prepare(`SELECT COUNT(*) AS c FROM vehicles ${where}`).get(params) as {
					c: number;
				}
			).c;

			const offset = (page - 1) * PAGE_SIZE;
			const vehicles = db
				.prepare(
					`SELECT * FROM vehicles ${where} ORDER BY set_id LIMIT @limit OFFSET @offset`,
				)
				.all({ ...params, limit: PAGE_SIZE, offset }) as VehicleRow[];

			json(res, 200, {
				page,
				pageSize: PAGE_SIZE,
				total,
				vehicles: vehicles.map((v) => ({
					...v,
					line_id: v.last_route_id ? lineIdForRoute(v.last_route_id) : null,
				})),
			});
			return;
		}

		const vehicleMatch = url.pathname.match(/^\/api\/v1\/vehicle\/([^/]+)$/);
		if (req.method === "GET" && vehicleMatch) {
			const setId = decodeURIComponent(vehicleMatch[1]);
			const vehicle = db
				.prepare(`SELECT * FROM vehicles WHERE set_id = @set_id`)
				.get({ set_id: setId }) as VehicleRow | undefined;
			if (!vehicle) {
				bad(res, 404, "Vehicle not found");
				return;
			}

			const trips = db
				.prepare(
					`SELECT * FROM trip_records WHERE set_id = @set_id
					ORDER BY started_at DESC LIMIT 60`,
				)
				.all({ set_id: setId });

			const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
			const tripsPerDay = db
				.prepare(
					`SELECT date(started_at) AS day, COUNT(*) AS trips
					FROM trip_records
					WHERE set_id = @set_id AND started_at >= @since
					GROUP BY date(started_at)
					ORDER BY day DESC`,
				)
				.all({ set_id: setId, since: since7d });

			const topRoutes = db
				.prepare(
					`SELECT route_id, COUNT(*) AS c FROM trip_records
					WHERE set_id = @set_id AND started_at >= @since AND route_id IS NOT NULL
					GROUP BY route_id ORDER BY c DESC LIMIT 3`,
				)
				.all({ set_id: setId, since: since7d });

			const sampleHours = (
				db
					.prepare(
						`SELECT COUNT(*) AS c FROM position_samples
						WHERE set_id = @set_id AND recorded_at >= @since`,
					)
					.get({ set_id: setId, since: since7d }) as { c: number }
			).c;

			json(res, 200, {
				vehicle: {
					...vehicle,
					line_id: vehicle.last_route_id
						? lineIdForRoute(vehicle.last_route_id)
						: null,
				},
				tripsLast60: trips,
				tripsPerDay7d: tripsPerDay,
				topRoutes7d: topRoutes,
				trackedSampleCount7d: sampleHours,
			});
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/v1/map.svg") {
			const mapQuery = {
				line: url.searchParams.get("line") ?? undefined,
				set: url.searchParams.get("set") ?? undefined,
				routeId: url.searchParams.get("route_id") ?? undefined,
			};
			const svg = buildFleetMapSvgFromDb(db, mapQuery);
			res.writeHead(200, {
				"Content-Type": "image/svg+xml; charset=utf-8",
				"Cache-Control": "no-store",
			});
			res.end(svg);
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/v1/map.webp") {
			const mapQuery = {
				line: url.searchParams.get("line") ?? undefined,
				set: url.searchParams.get("set") ?? undefined,
				routeId: url.searchParams.get("route_id") ?? undefined,
			};
			try {
				const svg = buildFleetMapSvgFromDb(db, mapQuery);
				const webp = await fleetMapSvgToWebp(svg);
				res.writeHead(200, {
					"Content-Type": "image/webp",
					"Cache-Control": "no-store",
				});
				res.end(webp);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Map render failed";
				bad(res, 500, message);
			}
			return;
		}

		bad(res, 404, "Not found");
}