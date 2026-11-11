import { displayStationName, formatAdelaideTime, isCityBoundHeadsign, perDirectionLimit } from "./format";
import { RAIL_LINES, type RailLineId } from "./lines";

export type DepartureRow = {
	depart_at: number;
	headsign: string;
	direction_kind: "city" | "outbound";
};

export function splitDepartures(
	rows: DepartureRow[],
	totalCount: number,
	nowSec: number,
): { city: DepartureRow[]; outbound: DepartureRow[] } {
	const limit = perDirectionLimit(totalCount);
	const city: DepartureRow[] = [];
	const outbound: DepartureRow[] = [];

	for (const row of rows) {
		if (row.depart_at < nowSec) continue;
		if (row.direction_kind === "city" && city.length < limit) {
			city.push(row);
		} else if (row.direction_kind === "outbound" && outbound.length < limit) {
			outbound.push(row);
		}
		if (city.length >= limit && outbound.length >= limit) break;
	}

	return { city, outbound };
}

function departuresField(
	label: string,
	rows: DepartureRow[],
	nowSec: number,
): { name: string; value: string } {
	if (rows.length === 0) {
		return { name: label, value: "_No further scheduled departures in the feed._" };
	}
	const lines = rows.map(
		(r) => `• **${formatAdelaideTime(r.depart_at, nowSec)}** → ${r.headsign}`,
	);
	return { name: label, value: lines.join("\n").slice(0, 1024) };
}

export function buildTimetableEmbed(
	lineId: RailLineId,
	stationName: string,
	rows: DepartureRow[],
	totalCount: number,
	nowSec: number,
	feedUpdated?: string,
	referenceLabel?: string,
): Record<string, unknown> {
	const line = RAIL_LINES[lineId];
	const shortName = displayStationName(stationName);
	const { city, outbound } = splitDepartures(rows, totalCount, nowSec);

	const cityLabel = "Towards City";
	const outLabel = `Towards ${line.terminal}`;

	const fields = [
		departuresField(cityLabel, city, nowSec),
		departuresField(outLabel, outbound, nowSec),
	];

	const description = referenceLabel
		? `Scheduled departures from **${shortName}** starting **${referenceLabel}** (Adelaide). Times below are from that moment onward.`
		: `Upcoming scheduled trains from **${shortName}** (Adelaide time).`;

	return {
		title: `${line.label} line — ${shortName}`,
		description,
		color: 0x007dc3,
		fields,
		footer: {
			text: feedUpdated
				? `Adelaide Metro GTFS • updated ${feedUpdated}`
				: "Adelaide Metro GTFS • scheduled times only",
		},
		timestamp: new Date(nowSec * 1000).toISOString(),
	};
}

/** Classify headsign for display grouping (import uses same rule). */
export function directionKindFromHeadsign(headsign: string): "city" | "outbound" {
	return isCityBoundHeadsign(headsign) ? "city" : "outbound";
}
