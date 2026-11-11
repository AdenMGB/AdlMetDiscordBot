import type { D1Database } from "@cloudflare/workers-types";
import type { LatLon } from "./geography";
import { locateBetweenStops } from "./geography";
import { loadLiveDbContext } from "./db-live";
import { RAIL_LINES, lineIdForRoute, ALL_RAIL_ROUTE_IDS } from "./lines";
import type { LiveTripUpdate, LiveVehicle } from "./rt-feed";

const PASSED_SHOW = 8;
const UPCOMING_SHOW = 8;

export type ProgressSlice = {
	passed: LatLon[];
	currentFrom: LatLon | null;
	currentTo: LatLon | null;
	atStation: LatLon | null;
	upcoming: LatLon[];
	currentLeg: number;
	totalStops: number;
	inTransit: boolean;
};

function indexOnPath(path: LatLon[], stopId: string): number {
	return path.findIndex((s) => s.stopId === stopId);
}

export function computeProgressSlice(
	path: LatLon[],
	vehicle: LiveVehicle,
	tu: LiveTripUpdate | undefined,
): ProgressSlice {
	const totalStops = path.length;
	if (totalStops === 0) {
		return {
			passed: [],
			currentFrom: null,
			currentTo: null,
			atStation: null,
			upcoming: [],
			currentLeg: 0,
			totalStops: 0,
			inTransit: false,
		};
	}

	const future = tu?.stops
		.filter((s) => s.stopSequence && s.stopSequence < 900)
		.sort((a, b) => a.stopSequence - b.stopSequence);

	let fromIdx = 0;
	let toIdx = Math.min(1, totalStops - 1);
	let atStation: LatLon | null = null;
	let inTransit = vehicle.speedMps >= 1.2;

	if (future?.length) {
		const nextSeq = future[0].stopSequence;
		toIdx = Math.min(Math.max(nextSeq - 1, 0), totalStops - 1);
		fromIdx = Math.max(toIdx - 1, 0);
		const nearNext =
			path[toIdx] &&
			Math.hypot(
				(vehicle.lat - path[toIdx].lat) * 111_000,
				(vehicle.lon - path[toIdx].lon) * 111_000,
			) < 200;
		if (vehicle.speedMps < 1.2 && nearNext) {
			atStation = path[toIdx];
			inTransit = false;
			fromIdx = Math.max(toIdx - 1, 0);
		}
	} else {
		const segment = locateBetweenStops(vehicle.lat, vehicle.lon, path);
		if (segment) {
			fromIdx = indexOnPath(path, segment.from.stopId);
			toIdx = indexOnPath(path, segment.to.stopId);
			if (fromIdx < 0 || toIdx < 0) {
				fromIdx = 0;
				toIdx = 1;
			}
			inTransit = !segment.atStation;
			if (segment.atStation) atStation = segment.from;
		}
	}

	const passed = path.slice(0, Math.max(toIdx, 0));
	const upcomingStart = toIdx + 1;
	const upcoming = path.slice(upcomingStart, upcomingStart + UPCOMING_SHOW);

	return {
		passed: passed.slice(-PASSED_SHOW),
		currentFrom: atStation ? null : path[fromIdx] ?? null,
		currentTo: atStation ? null : path[toIdx] ?? null,
		atStation,
		upcoming,
		currentLeg: atStation ? toIdx + 1 : toIdx,
		totalStops,
		inTransit,
	};
}

export function buildProgressBar(currentLeg: number, totalStops: number): string {
	if (totalStops <= 1) return "`🚃`";
	const slots = 18;
	const ratio = Math.max(0, Math.min(1, (currentLeg - 0.5) / (totalStops - 1)));
	const pos = Math.round(ratio * (slots - 1));
	const track = Array.from({ length: slots }, (_, i) => (i === pos ? "🚃" : "─"));
	return `\`▏${track.join("")}▕\``;
}

function stopHistoryLines(slice: ProgressSlice, speedKmh: number): string {
	const lines: string[] = [];
	const hiddenPassed = Math.max(
		0,
		slice.currentLeg - 1 - PASSED_SHOW,
	);

	if (hiddenPassed > 0) {
		lines.push(`_…${hiddenPassed} earlier stop${hiddenPassed === 1 ? "" : "s"}_`);
	}

	for (const s of slice.passed) {
		lines.push(`✅ ${s.name}`);
	}

	if (slice.atStation) {
		lines.push(`🚏 **At ${slice.atStation.name}**`);
	} else if (slice.currentFrom && slice.currentTo) {
		lines.push(
			`🚃 **${slice.currentFrom.name}** → **${slice.currentTo.name}** · ${speedKmh.toFixed(0)} km/h`,
		);
	}

	for (const s of slice.upcoming) {
		lines.push(`⏳ ${s.name}`);
	}

	const moreUp =
		slice.totalStops -
		slice.currentLeg -
		slice.upcoming.length -
		(slice.atStation ? 0 : 1);
	if (moreUp > 0) {
		lines.push(`_…${moreUp} more to ${slice.totalStops > 0 ? "terminus" : "end"}_`);
	}

	return lines.join("\n").slice(0, 1024);
}

function delayStatus(delaySec: number): { emoji: string; label: string } {
	if (delaySec <= 45) return { emoji: "🟢", label: "On time" };
	if (delaySec < 300) return { emoji: "🟡", label: `${Math.round(delaySec / 60)} min late` };
	return { emoji: "🔴", label: `${Math.round(delaySec / 60)} min late` };
}

export async function buildExpandedSetEmbed(
	db: D1Database,
	vehicles: LiveVehicle[],
	tripUpdates: Map<string, LiveTripUpdate>,
	setFilter: string,
	fetchedAtSec: number,
): Promise<Record<string, unknown>> {
	const vehicle = vehicles.find(
		(v) =>
			v.setLabel.trim() === setFilter &&
			ALL_RAIL_ROUTE_IDS.has(v.routeId) &&
			v.tripId,
	);

	if (!vehicle) {
		return {
			title: `Set ${setFilter}`,
			description: `No live GTFS-RT position for set **${setFilter}** right now.`,
			color: 0x007dc3,
		};
	}

	const lineId = lineIdForRoute(vehicle.routeId);
	if (!lineId) {
		return {
			title: `Set ${setFilter}`,
			description: "Could not map this trip to a known line.",
			color: 0x007dc3,
		};
	}

	const tu = tripUpdates.get(vehicle.tripId);
	const stopIds = tu?.stops.map((s) => s.stopId) ?? [];
	const ctx = await loadLiveDbContext(db, [vehicle.tripId], stopIds);
	const meta = ctx.tripMeta.get(vehicle.tripId);
	const headsign = meta?.headsign?.trim() || RAIL_LINES[lineId].terminal;
	const path = ctx.tripPaths.get(vehicle.tripId) ?? [];

	const slice = computeProgressSlice(path, vehicle, tu);
	const speedKmh = vehicle.speedMps * 3.6;
	const delaySec = Math.max(
		tu?.delaySec ?? 0,
		tu?.stops[0]?.arrivalDelaySec ?? 0,
		tu?.stops[0]?.departureDelaySec ?? 0,
	);
	const { emoji, label } = delayStatus(delaySec);

	const progressPct =
		slice.totalStops > 1 ?
			Math.round(((slice.currentLeg - 0.5) / (slice.totalStops - 1)) * 100)
		:	0;

	const bar = buildProgressBar(slice.currentLeg, slice.totalStops);
	const history = stopHistoryLines(slice, speedKmh);

	const motion = slice.atStation ? "🚏 At platform" : slice.inTransit ? "🚃 In motion" : "⏸️ Slow / stopped";

	return {
		title: `Set ${setFilter} · ${RAIL_LINES[lineId].label} line`,
		description:
			`${emoji} **${label}** · ${motion} · **${headsign}**\n` +
			`${bar}  **${progressPct}%** of trip · stop **${slice.currentLeg}/${slice.totalStops}**`,
		color: 0x007dc3,
		fields: [
			{
				name: "Route progress",
				value: history || "_No stop list in static GTFS for this trip._",
			},
			{
				name: "Trip",
				value: [
					`Route \`${vehicle.routeId}\` · trip \`${vehicle.tripId}\``,
					`Speed **${speedKmh.toFixed(0)} km/h**${vehicle.bearing !== undefined ? ` · heading **${Math.round(vehicle.bearing)}°**` : ""}`,
					`✅ passed · 🚃 between · 🚏 here · ⏳ ahead`,
				].join("\n"),
			},
		],
		timestamp: new Date(fetchedAtSec * 1000).toISOString(),
		footer: { text: "GTFS-RT + static route · run again to refresh" },
	};
}
