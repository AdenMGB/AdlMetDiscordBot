import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { D1Database } from "@cloudflare/workers-types";
import { disruptionSubscribeComponents } from "../config";
import { ALL_RAIL_ROUTE_IDS, lineIdForRoute, RAIL_LINES, type RailLineId } from "./lines";

const ALERTS_URL = "https://gtfs.adelaidemetro.com.au/v1/realtime/service_alerts";

const TRAIN_TEXT =
	/\b(train|railway|rail\s|gawler|seaford|belair|outer\s*harbor|flinders|port\s*dock|grange\s*line|noarlunga|salisbury|tonlsey)\b/i;
const EXCLUDE_TEXT = /\b(tram|bus\s+route|stop\s+\d+[a-z]?)\b/i;

export type RailAlert = {
	id: string;
	header: string;
	description: string;
	routeIds: string[];
	lineIds: RailLineId[];
	url?: string;
	causeLabel: string;
	effectLabel: string;
	active: boolean;
	startSec?: number;
	endSec?: number;
};

const CAUSE: Record<number, string> = {
	1: "Unknown cause",
	2: "Other cause",
	3: "Technical problem",
	4: "Strike",
	5: "Demonstration",
	6: "Accident",
	7: "Holiday",
	8: "Weather",
	9: "Maintenance",
	10: "Construction",
	11: "Police activity",
	12: "Medical emergency",
};

const EFFECT: Record<number, string> = {
	1: "No service",
	2: "Reduced service",
	3: "Significant delays",
	4: "Detour",
	5: "Additional service",
	6: "Modified service",
	7: "Other effect",
	8: "Stop moved",
	9: "No effect",
	10: "Accessibility issue",
};

function translationText(
	field: { translation?: { text?: string | null }[] | null } | null | undefined,
): string {
	const t = field?.translation?.[0]?.text;
	return t?.trim() ?? "";
}

function num(v: unknown): number | undefined {
	if (typeof v === "bigint") return Number(v);
	if (typeof v === "number") return v;
	return undefined;
}

function isActiveNow(
	periods: { start?: unknown; end?: unknown }[] | null | undefined,
	nowSec: number,
): boolean {
	if (!periods?.length) return true;
	return periods.some((p) => {
		const start = num(p.start) ?? 0;
		const end = num(p.end);
		if (start && nowSec < start) return false;
		if (end && nowSec > end) return false;
		return true;
	});
}

export function isRailAlert(
	routeIds: string[],
	routeTypes: number[],
	header: string,
	description: string,
): boolean {
	if (routeIds.some((r) => ALL_RAIL_ROUTE_IDS.has(r))) return true;
	if (routeTypes.includes(2)) return true;
	const text = `${header}\n${description}`;
	if (!TRAIN_TEXT.test(text)) return false;
	if (EXCLUDE_TEXT.test(text) && !/\btrain\b/i.test(text)) return false;
	return true;
}

export function parseRailAlerts(buffer: ArrayBuffer, nowSec: number): RailAlert[] {
	const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
		new Uint8Array(buffer),
	);
	const out: RailAlert[] = [];

	for (const ent of feed.entity) {
		const a = ent.alert;
		if (!a) continue;
		const header = translationText(a.headerText);
		const description = translationText(a.descriptionText);
		const routeIds = [
			...new Set(
				(a.informedEntity ?? [])
					.map((e) => e.routeId)
					.filter((r): r is string => Boolean(r)),
			),
		];
		const routeTypes = (a.informedEntity ?? [])
			.map((e) => e.routeType)
			.filter((t): t is number => t !== undefined && t !== null);

		if (!isRailAlert(routeIds, routeTypes, header, description)) continue;

		const lineIds = [
			...new Set(
				routeIds
					.map((r) => lineIdForRoute(r))
					.filter((x): x is RailLineId => x !== null),
			),
		];

		const periods = a.activePeriod ?? [];
		const startSec = num(periods[0]?.start);
		const endSec = num(periods[0]?.end);

		out.push({
			id: ent.id,
			header: header || "Rail service alert",
			description,
			routeIds,
			lineIds,
			url: a.url?.translation?.[0]?.text ?? undefined,
			causeLabel: CAUSE[a.cause ?? 1] ?? "Alert",
			effectLabel: EFFECT[a.effect ?? 7] ?? "Service change",
			active: isActiveNow(periods, nowSec),
			startSec,
			endSec,
		});
	}

	return out.sort((a, b) => a.header.localeCompare(b.header));
}

export async function fetchRailAlerts(nowSec = Math.floor(Date.now() / 1000)): Promise<RailAlert[]> {
	const res = await fetch(ALERTS_URL);
	if (!res.ok) {
		throw new Error(`GTFS-RT service_alerts unreachable (${res.status})`);
	}
	return parseRailAlerts(await res.arrayBuffer(), nowSec);
}

export function filterAlertsByLine(
	alerts: RailAlert[],
	lineId: RailLineId | null,
	activeOnly = true,
): RailAlert[] {
	return alerts.filter((a) => {
		if (activeOnly && !a.active) return false;
		if (!lineId) return true;
		return a.lineIds.includes(lineId) || a.routeIds.some((r) => RAIL_LINES[lineId].routeIds.has(r));
	});
}

export function formatAlertEmbed(
	alerts: RailAlert[],
	title: string,
): Record<string, unknown> {
	if (alerts.length === 0) {
		return {
			title,
			description: "No active **train** disruptions in the GTFS-RT feed right now.",
			color: 0x007dc3,
		};
	}

	const fields = alerts.slice(0, 10).map((a) => {
		const lines =
			a.lineIds.length > 0 ?
				a.lineIds.map((id) => RAIL_LINES[id].label).join(", ")
			:	a.routeIds.length > 0 ?
				a.routeIds.join(", ")
			:	"Rail network";
		const body = a.description ? `\n${a.description.slice(0, 400)}` : "";
		const link = a.url ? `\n[More info](${a.url})` : "";
		return {
			name: `${a.effectLabel} · ${lines}`.slice(0, 256),
			value: `**${a.header}**${body}${link}`.slice(0, 1024),
		};
	});

	return {
		title,
		description:
			`🚆 **${alerts.length}** active train-related alert${alerts.length === 1 ? "" : "s"} (buses/trams filtered out).`,
		color: 0xc23b33,
		fields,
		footer: { text: "Adelaide Metro GTFS-RT service_alerts" },
	};
}

export function formatDiscordAlertPost(
	alert: RailAlert,
	roleId: string,
): {
	content: string;
	embeds: Record<string, unknown>[];
	components: ReturnType<typeof disruptionSubscribeComponents>;
} {
	const mention = roleId ? `<@&${roleId}> ` : "";
	const lines =
		alert.lineIds.length > 0 ?
			alert.lineIds.map((id) => RAIL_LINES[id].label).join(", ")
		:	"Adelaide Metro rail";

	const embed: Record<string, unknown> = {
		title: `🚆 ${alert.effectLabel}`,
		description: `**${alert.header}**`,
		color: 0xc23b33,
		fields: [
			{
				name: "Lines / routes",
				value: lines + (alert.routeIds.length ? ` (\`${alert.routeIds.join("`, `")}\`)` : ""),
			},
			...(alert.description ?
				[{ name: "Details", value: alert.description.slice(0, 1024) }]
			:	[]),
		],
		footer: { text: `${alert.causeLabel} · Metro Mate disruptions` },
	};
	if (alert.url) {
		embed.url = alert.url;
	}

	return {
		content: `${mention}**New train disruption**`.trim(),
		embeds: [embed],
		components: disruptionSubscribeComponents(),
	};
}

export async function pushNewRailAlerts(
	db: D1Database,
	postMessage: (payload: {
		content: string;
		embeds: Record<string, unknown>[];
		components: ReturnType<typeof disruptionSubscribeComponents>;
	}) => Promise<void>,
	roleId: string,
	nowSec = Math.floor(Date.now() / 1000),
): Promise<{ posted: string[]; active: number; skipped: number }> {
	const alerts = filterAlertsByLine(await fetchRailAlerts(nowSec), null, true);
	const posted: string[] = [];
	let skipped = 0;

	for (const alert of alerts) {
		const existing = await db
			.prepare(`SELECT alert_id FROM posted_alerts WHERE alert_id = ? LIMIT 1`)
			.bind(alert.id)
			.first<{ alert_id: string }>();
		if (existing) {
			skipped += 1;
			continue;
		}

		await postMessage(formatDiscordAlertPost(alert, roleId));
		await db
			.prepare(
				`INSERT INTO posted_alerts (alert_id, posted_at, summary) VALUES (?, ?, ?)`,
			)
			.bind(alert.id, nowSec, alert.header.slice(0, 500))
			.run();
		posted.push(alert.id);
	}

	return { posted, active: alerts.length, skipped };
}
