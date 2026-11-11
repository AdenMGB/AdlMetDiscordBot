import type { D1Database } from "@cloudflare/workers-types";
import {
	loadLiveDbContext,
	getStopFromContext,
	getTripStopBySequence,
	type LiveDbContext,
} from "./db-live";
import { locateBetweenStops } from "./geography";
import {
	ALL_RAIL_ROUTE_IDS,
	lineIdForRoute,
	RAIL_LINES,
	type RailLineId,
} from "./lines";
import type { LiveTripUpdate, LiveVehicle } from "./rt-feed";

export function liveSetAutocompleteChoices(
	vehicles: LiveVehicle[],
	lineFilter: RailLineId | null,
	query: string,
): { name: string; value: string }[] {
	const q = query.trim().toLowerCase();
	const seen = new Set<string>();
	const choices: { name: string; value: string }[] = [];

	for (const v of vehicles) {
		if (!ALL_RAIL_ROUTE_IDS.has(v.routeId)) continue;
		const lineId = lineIdForRoute(v.routeId);
		if (!lineId) continue;
		if (lineFilter && lineId !== lineFilter) continue;
		if (v.scheduleRelationship === 2 || v.scheduleRelationship === 3) continue;
		const label = v.setLabel.trim();
		if (!label || seen.has(label)) continue;
		if (q && !label.toLowerCase().includes(q) && !RAIL_LINES[lineId].label.toLowerCase().includes(q)) {
			continue;
		}
		seen.add(label);
		choices.push({
			name: `${label} · ${RAIL_LINES[lineId].label}`.slice(0, 100),
			value: label.slice(0, 100),
		});
	}

	choices.sort((a, b) =>
		a.value.localeCompare(b.value, undefined, { numeric: true }),
	);
	return choices.slice(0, 25);
}

export type ResolvedLiveTrain = {
	setLabel: string;
	lineId: RailLineId;
	lineLabel: string;
	headsign: string;
	delaySec: number;
	statusEmoji: string;
	motionEmoji: string;
	locationLine: string;
};

function delayStatusEmoji(delaySec: number): string {
	if (delaySec <= 45) return "🟢";
	if (delaySec < 300) return "🟡";
	return "🔴";
}

function delayLabel(delaySec: number): string {
	if (delaySec <= 45) return "On time";
	return `${Math.round(delaySec / 60)} min late`;
}

function motionEmoji(speedMps: number, atStation: boolean): string {
	if (atStation) return "🚏";
	if (speedMps < 1.2) return "⏸️";
	return "🚃";
}

function isCityHeadsign(headsign: string): boolean {
	return /\bcity\b/i.test(headsign) || /^adelaide/i.test(headsign);
}

function resolvePlacement(
	ctx: LiveDbContext,
	vehicle: LiveVehicle,
	tu: LiveTripUpdate | undefined,
	headsign: string,
): { locationLine: string; atStation: boolean; delaySec: number } {
	let delaySec = tu?.delaySec ?? 0;
	let atStation = vehicle.speedMps < 1.2;

	const futureStops =
		tu?.stops.filter((s) => s.stopSequence && s.stopSequence < 900).sort(
			(a, b) => a.stopSequence - b.stopSequence,
		) ?? [];

	if (futureStops.length > 0) {
		const next = futureStops[0];
		delaySec = Math.max(
			delaySec,
			next.departureDelaySec,
			next.arrivalDelaySec,
		);
		const nextStop = getStopFromContext(ctx, next.stopId);
		const prevStop = getTripStopBySequence(
			ctx,
			vehicle.tripId,
			next.stopSequence - 1,
		);

		if (nextStop && prevStop) {
			const dToNext = Math.hypot(
				(vehicle.lat - nextStop.lat) * 111_000,
				(vehicle.lon - nextStop.lon) * 111_000,
			);
			if (atStation && dToNext < 200) {
				return {
					locationLine: `At **${nextStop.name}**`,
					atStation: true,
					delaySec,
				};
			}
			return {
				locationLine: `**${prevStop.name}** → **${nextStop.name}**`,
				atStation: false,
				delaySec,
			};
		}
		if (nextStop) {
			return {
				locationLine: `→ **${nextStop.name}**`,
				atStation: false,
				delaySec,
			};
		}
	}

	const path = ctx.tripPaths.get(vehicle.tripId) ?? [];
	const segment = locateBetweenStops(vehicle.lat, vehicle.lon, path);
	if (segment) {
		atStation = segment.atStation || atStation;
		if (segment.atStation) {
			return {
				locationLine: `At **${segment.from.name}**`,
				atStation: true,
				delaySec,
			};
		}
		return {
			locationLine: `**${segment.from.name}** → **${segment.to.name}**`,
			atStation: false,
			delaySec,
		};
	}

	const dir = isCityHeadsign(headsign) ? "City-bound" : "Outbound";
	return {
		locationLine: `📍 ${dir} (position only)`,
		atStation,
		delaySec,
	};
}

export async function buildLiveTrainList(
	db: D1Database,
	vehicles: LiveVehicle[],
	tripUpdates: Map<string, LiveTripUpdate>,
	lineFilter: RailLineId | null,
	setFilter: string | null = null,
): Promise<ResolvedLiveTrain[]> {
	const filtered: LiveVehicle[] = [];
	const seen = new Set<string>();
	const stopIds: string[] = [];

	for (const v of vehicles) {
		if (!ALL_RAIL_ROUTE_IDS.has(v.routeId)) continue;
		const lineId = lineIdForRoute(v.routeId);
		if (!lineId) continue;
		if (lineFilter && lineId !== lineFilter) continue;
		if (setFilter && v.setLabel.trim() !== setFilter) continue;
		if (!v.tripId || seen.has(v.tripId)) continue;
		if (v.scheduleRelationship === 2 || v.scheduleRelationship === 3) continue;
		seen.add(v.tripId);
		filtered.push(v);
		const tu = tripUpdates.get(v.tripId);
		for (const st of tu?.stops ?? []) {
			if (st.stopId) stopIds.push(st.stopId);
		}
	}

	const tripIds = filtered.map((v) => v.tripId);
	const ctx = await loadLiveDbContext(db, tripIds, stopIds);
	const out: ResolvedLiveTrain[] = [];

	for (const v of filtered) {
		const lineId = lineIdForRoute(v.routeId)!;
		const meta = ctx.tripMeta.get(v.tripId);
		const headsign =
			meta?.headsign?.trim() || RAIL_LINES[lineId].terminal;

		const placement = resolvePlacement(
			ctx,
			v,
			tripUpdates.get(v.tripId),
			headsign,
		);

		out.push({
			setLabel: v.setLabel,
			lineId,
			lineLabel: RAIL_LINES[lineId].label,
			headsign,
			delaySec: placement.delaySec,
			statusEmoji: delayStatusEmoji(placement.delaySec),
			motionEmoji: motionEmoji(v.speedMps, placement.atStation),
			locationLine: placement.locationLine,
		});
	}

	out.sort((a, b) => {
		const line = a.lineLabel.localeCompare(b.lineLabel);
		if (line !== 0) return line;
		return a.setLabel.localeCompare(b.setLabel, undefined, { numeric: true });
	});

	return out;
}

export function formatLiveTrainsEmbed(
	trains: ResolvedLiveTrain[],
	lineFilter: RailLineId | null,
	fetchedAtSec: number,
	setFilter: string | null = null,
): Record<string, unknown> {
	if (trains.length === 0) {
		const scope = setFilter ?
			`set **${setFilter}**`
		: lineFilter ?
			`the **${RAIL_LINES[lineFilter].label}** line`
		:	"the network";
		return {
			title: "Live trains",
			description: `No live position for ${scope} in GTFS-RT right now.`,
			color: 0x007dc3,
		};
	}

	const grouped = new Map<string, ResolvedLiveTrain[]>();
	for (const t of trains) {
		const list = grouped.get(t.lineLabel) ?? [];
		list.push(t);
		grouped.set(t.lineLabel, list);
	}

	const fields = [...grouped.entries()].map(([label, items]) => {
		const lines = items.map(
			(t) =>
				`${t.motionEmoji}${t.statusEmoji} **${t.setLabel}** · ${t.headsign}\n` +
				`${t.locationLine} · _${delayLabel(t.delaySec)}_`,
		);
		return {
			name: label,
			value: lines.join("\n\n").slice(0, 1024),
		};
	});

	const title = setFilter ?
		`Live train set ${setFilter}`
	: lineFilter ?
		`Live trains — ${RAIL_LINES[lineFilter].label}`
	:	"Live trains — Adelaide Metro";

	return {
		title,
		description:
			"Set numbers and positions from **GTFS Realtime**. " +
			"🟢 on time · 🟡 delayed · 🚏 at stop · 🚃 between stations",
		color: 0x007dc3,
		fields,
		timestamp: new Date(fetchedAtSec * 1000).toISOString(),
		footer: { text: "GTFS-RT · run again to refresh" },
	};
}
