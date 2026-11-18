import type { D1Database } from "@cloudflare/workers-types";
import { clampCount } from "./transit/format";
import { fetchUpcomingDepartures, listStationsForLine } from "./transit/db";
import { buildLiveTrainList, type ResolvedLiveTrain } from "./transit/live-trains";
import { RAIL_LINES, type RailLineId } from "./transit/lines";
import { fetchLiveRailFeeds } from "./transit/rt-feed";
import {
	fetchServiceAlerts,
	filterAlertsByLine,
	filterAlertsByMode,
	type AlertMode,
	type ServiceAlert,
} from "./transit/service-alerts";
import { formatAdelaideTime } from "./transit/format";
import { splitDepartures } from "./transit/timetable";

/** Shown only to the model — not an instruction to quote slash commands to users. */
export const INTERNAL_TOOLS_PREAMBLE =
	"You (Metro Mate) already called internal tools below. Answer the user using this text; do not redirect them to slash commands.";

function lineFromQuestion(question: string): RailLineId | null {
	const q = question.toLowerCase();
	for (const [id, line] of Object.entries(RAIL_LINES)) {
		if (q.includes(line.label.toLowerCase())) return id as RailLineId;
	}
	if (/\bgawler\b/.test(q)) return "gawler";
	if (/\bseaford\b|\bnoarlunga\b/.test(q)) return "seaford";
	if (/\bflinders\b/.test(q)) return "flinders";
	if (/\bbelair\b/.test(q)) return "belair";
	if (/\bouter\s*harbor\b|\bosborn\b|\bglanville\b/.test(q)) return "outer-harbor";
	if (/\bgrange\b/.test(q)) return "grange";
	if (/\bport\s*dock\b/.test(q)) return "port-dock";
	return null;
}

async function guessStation(
	db: D1Database,
	lineId: RailLineId,
	question: string,
): Promise<string | null> {
	const q = question.toLowerCase();
	const tokens = q
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 3 && !/^(when|next|train|from|what|about|metro|mate)$/.test(w));
	for (const token of tokens) {
		const stations = await listStationsForLine(db, lineId, token, 5);
		if (stations.length === 1) return stations[0]!.name;
		for (const s of stations) {
			if (s.name.toLowerCase().includes(token)) return s.name;
		}
	}
	if (/\badelaide\b/.test(q) && (/\bcity\b/.test(q) || /\bstation\b/.test(q))) {
		const adelaide = await listStationsForLine(db, lineId, "Adelaide", 3);
		const match = adelaide.find((s) => /adelaide/i.test(s.name));
		if (match) return match.name;
	}
	return null;
}

function wantsAlerts(question: string): boolean {
	return /\b(alert|disruption|cancel|suspended|track\s*work|diversion|detour|not\s*running|service\s*change)\b/i.test(
		question,
	);
}

function wantsLive(question: string): boolean {
	return /\b(live|delay|late|running|where\s+is|set\s*\d|position|on\s*time)\b/i.test(question);
}

function wantsTimetable(question: string): boolean {
	return (
		/\b(timetable|departure|depart|leaving|next\s+train|when.*train|arrival|from\s+\w+)\b/i.test(
			question,
		) ||
		lineFromQuestion(question) !== null ||
		isTransportQuestion(question)
	);
}

function isTransportQuestion(question: string): boolean {
	return /\b(train|tram|bus|metro|station|rail|delay|cancel|disruption|commute|adelaide)\b/i.test(
		question,
	);
}

function alertModeFromQuestion(question: string): AlertMode | null {
	if (/\b(bus|buses)\b/i.test(question)) return "bus";
	if (/\b(tram|trams|glenelg)\b/i.test(question)) return "tram";
	if (/\b(train|rail)\b/i.test(question)) return "train";
	return null;
}

function formatAlertsBlock(alerts: ServiceAlert[], heading: string): string {
	if (alerts.length === 0) return `${heading}\n(none active right now)`;
	const lines = alerts.slice(0, 6).map((a) => {
		const desc = a.description.trim().slice(0, 200);
		return `• [${a.mode}] ${a.header}${desc ? ` — ${desc}` : ""}`;
	});
	return `${heading}\n${lines.join("\n")}`;
}

function formatLiveBlock(trains: ResolvedLiveTrain[], lineFilter: RailLineId | null): string {
	if (trains.length === 0) {
		return "Live trains\nNo live trains matched what they asked for.";
	}
	const scope = lineFilter ? RAIL_LINES[lineFilter].label : "all lines";
	const lines = trains.slice(0, 10).map(
		(t) =>
			`• Set ${t.setLabel} (${t.lineLabel}) ${t.statusEmoji} ${t.headsign} — ${t.locationLine}`,
	);
	return `Live trains (${scope}, up to 10 sets)\n${lines.join("\n")}`;
}

async function runTimetableTool(
	db: D1Database,
	question: string,
): Promise<string | null> {
	const lineId = lineFromQuestion(question);
	if (!lineId) return null;
	const station = await guessStation(db, lineId, question);
	if (!station) {
		return `Timetable (${RAIL_LINES[lineId].label})\nCould not match a station from their message — ask which stop (e.g. Adelaide, Gawler Central).`;
	}

	const nowSec = Math.floor(Date.now() / 1000);
	const count = clampCount(6);
	const departures = await fetchUpcomingDepartures(db, lineId, station, nowSec, 120);
	if (departures.length === 0) {
		return `Timetable (${RAIL_LINES[lineId].label} @ ${station})\nNo upcoming departures in the timetable cache.`;
	}
	const { city, outbound } = splitDepartures(departures, count, nowSec);
	const fmt = (rows: typeof city) =>
		rows.map((r) => `  ${formatAdelaideTime(r.depart_at, nowSec)} → ${r.headsign}`).join("\n");
	return [
		`Timetable (${RAIL_LINES[lineId].label} @ ${station})`,
		"Towards City:",
		fmt(city) || "  (none)",
		`Towards ${RAIL_LINES[lineId].terminal}:`,
		fmt(outbound) || "  (none)",
	].join("\n");
}

async function runLiveTool(
	db: D1Database,
	question: string,
): Promise<string | null> {
	const lineFilter = lineFromQuestion(question);
	try {
		const { vehicles, tripUpdates } = await fetchLiveRailFeeds();
		const trains = await buildLiveTrainList(db, vehicles, tripUpdates, lineFilter, null);
		return formatLiveBlock(trains, lineFilter);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "fetch failed";
		const short = /too many SQL variables/i.test(msg)
			? "live-train database query failed (too many active trips — fix deploying)"
			: msg;
		return `Live trains\nCould not load: ${short}`;
	}
}

async function runAlertsTool(question: string): Promise<string | null> {
	if (!wantsAlerts(question) && !isTransportQuestion(question)) return null;
	try {
		const all = await fetchServiceAlerts();
		let filtered = all.filter((a) => a.active);
		const mode = alertModeFromQuestion(question);
		if (mode) filtered = filterAlertsByMode(filtered, mode);
		const line = lineFromQuestion(question);
		if (line) filtered = filterAlertsByLine(filtered, line);
		return formatAlertsBlock(filtered, "Service alerts");
	} catch (error) {
		const msg = error instanceof Error ? error.message : "fetch failed";
		return `Service alerts\nCould not load: ${msg}`;
	}
}

/** Real command-backed facts for mention chat (runs on the Worker where D1/GTFS-RT live). */
export async function buildMentionToolContext(
	db: D1Database | undefined,
	question: string,
): Promise<string> {
	const blocks: string[] = [INTERNAL_TOOLS_PREAMBLE];

	if (!db) {
		blocks.push("(Timetable database not available — skipped.)");
	} else {
		const line = lineFromQuestion(question);
		const transport = isTransportQuestion(question);
		const tasks: Promise<string | null>[] = [];
		if (transport || wantsAlerts(question) || line) {
			tasks.push(runAlertsTool(question));
		}
		if (wantsTimetable(question) || line) {
			tasks.push(runTimetableTool(db, question));
		}
		if (wantsLive(question) || line || transport) {
			tasks.push(runLiveTool(db, question));
		}
		const results = await Promise.all(tasks);
		for (const block of results) {
			if (block) blocks.push(block);
		}
	}

	if (blocks.length === 1) {
		blocks.push("(No transport tools matched — general chat OK.)");
	}

	return blocks.join("\n\n");
}