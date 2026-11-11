import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { D1Database } from "@cloudflare/workers-types";
import { disruptionSubscribeComponents } from "../config";
import { htmlToDiscordMarkdown } from "./html-discord";
import { ALL_RAIL_ROUTE_IDS, lineIdForRoute, RAIL_LINES, type RailLineId } from "./lines";

const ALERTS_URL = "https://gtfs.adelaidemetro.com.au/v1/realtime/service_alerts";

const TRAIN_TEXT =
	/\b(train|railway|rail\s|gawler|seaford|belair|outer\s*harbor|flinders|port\s*dock|grange\s*line|noarlunga|salisbury|tonlsey)\b/i;
const TRAM_TEXT = /\b(tram|glenelg|tramway|jetty\s*road)\b/i;
const BUS_TEXT = /\b(bus|bus\s+route|route\s+\d{1,4}[a-z]?)\b/i;
/** Bus route ids are typically numeric; rail uses letter codes like SEAFRD. */
const BUS_ROUTE_ID = /^\d{1,4}[A-Za-z]?$/;
/** Route numbers listed at end of alert titles, e.g. `(751, 751A, H30)`. */
const ROUTE_LIST_IN_TEXT = /\(([\dA-Za-z]+(?:\s*,\s*[\dA-Za-z]+)*)\)\s*$/gm;

export type AlertMode = "train" | "bus" | "tram";

export const ALERT_MODE_CHOICES: { name: string; value: AlertMode }[] = [
	{ name: "Train", value: "train" },
	{ name: "Bus", value: "bus" },
	{ name: "Tram", value: "tram" },
];

export function isAlertMode(value: string): value is AlertMode {
	return value === "train" || value === "bus" || value === "tram";
}

export type ServiceAlert = {
	id: string;
	header: string;
	description: string;
	routeIds: string[];
	lineIds: RailLineId[];
	mode: AlertMode;
	url?: string;
	causeLabel: string;
	effectLabel: string;
	active: boolean;
	startSec?: number;
	endSec?: number;
};

/** @deprecated Use `ServiceAlert` */
export type RailAlert = ServiceAlert;

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

const MODE_EMOJI: Record<AlertMode, string> = {
	train: "🚆",
	bus: "🚌",
	tram: "🚋",
};

const MODE_LABEL: Record<AlertMode, string> = {
	train: "train",
	bus: "bus",
	tram: "tram",
};

function translationText(
	field: { translation?: { text?: string | null }[] | null } | null | undefined,
): string {
	const t = field?.translation?.[0]?.text;
	return htmlToDiscordMarkdown(t?.trim() ?? "");
}

function routeIdsMentionedInText(header: string, description: string): string[] {
	const ids: string[] = [];
	const hay = `${header}\n${description}`;
	for (const match of hay.matchAll(ROUTE_LIST_IN_TEXT)) {
		const chunk = match[1];
		for (const part of chunk.split(",")) {
			const id = part.trim();
			if (id) ids.push(id);
		}
	}
	return ids;
}

function mergeRouteIds(fromFeed: string[], header: string, description: string): string[] {
	return [...new Set([...fromFeed, ...routeIdsMentionedInText(header, description)])];
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
	if (/\b(tram|bus\s+route|stop\s+\d+[a-z]?)\b/i.test(text) && !/\btrain\b/i.test(text)) {
		return false;
	}
	return true;
}

function isLikelyBusRouteId(routeId: string): boolean {
	return BUS_ROUTE_ID.test(routeId);
}

export function classifyAlertMode(
	routeIds: string[],
	routeTypes: number[],
	header: string,
	description: string,
): AlertMode | null {
	const allRouteIds = mergeRouteIds(routeIds, header, description);

	if (isRailAlert(allRouteIds, routeTypes, header, description)) return "train";

	const text = `${header}\n${description}`;
	const hasNumericRoutes = allRouteIds.some((r) => isLikelyBusRouteId(r));
	const mentionsBus = BUS_TEXT.test(text) || /\bbus\s+service\b/i.test(text);
	const mentionsTram = TRAM_TEXT.test(text);

	// Adelaide Metro often uses GTFS route_type 0 on bus alerts — never treat 0 alone as tram.
	const isBus =
		routeTypes.includes(3) ||
		hasNumericRoutes ||
		mentionsBus ||
		(routeTypes.includes(0) && !mentionsTram);

	if (isBus && !mentionsTram) return "bus";
	if (mentionsTram && !mentionsBus && !hasNumericRoutes) return "tram";
	if (isBus) return "bus";
	if (mentionsTram) return "tram";

	return null;
}

export function parseServiceAlerts(buffer: ArrayBuffer, nowSec: number): ServiceAlert[] {
	const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
		new Uint8Array(buffer),
	);
	const out: ServiceAlert[] = [];

	for (const ent of feed.entity) {
		const a = ent.alert;
		if (!a) continue;
		const header = translationText(a.headerText);
		const description = translationText(a.descriptionText);
		const feedRouteIds = (a.informedEntity ?? [])
			.map((e) => e.routeId)
			.filter((r): r is string => Boolean(r));
		const routeIds = mergeRouteIds(feedRouteIds, header, description);
		const routeTypes = (a.informedEntity ?? [])
			.map((e) => e.routeType)
			.filter((t): t is number => t !== undefined && t !== null);

		const mode = classifyAlertMode(routeIds, routeTypes, header, description);
		if (!mode) continue;

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

		const defaultHeader =
			mode === "train" ? "Rail service alert"
			: mode === "tram" ? "Tram service alert"
			: "Bus service alert";

		out.push({
			id: ent.id,
			header: header || defaultHeader,
			description,
			routeIds,
			lineIds,
			mode,
			url: a.url?.translation?.[0]?.text ?? undefined,
			causeLabel: CAUSE[a.cause ?? 1] ?? "Alert",
			effectLabel: EFFECT[a.effect ?? 7] ?? "Service change",
			active: isActiveNow(periods, nowSec),
			startSec,
			endSec,
		});
	}

	return out.sort((a, b) => a.mode.localeCompare(b.mode) || a.header.localeCompare(b.header));
}

/** @deprecated Use `parseServiceAlerts` */
export function parseRailAlerts(buffer: ArrayBuffer, nowSec: number): ServiceAlert[] {
	return parseServiceAlerts(buffer, nowSec).filter((a) => a.mode === "train");
}

export async function fetchServiceAlerts(
	nowSec = Math.floor(Date.now() / 1000),
): Promise<ServiceAlert[]> {
	const res = await fetch(ALERTS_URL);
	if (!res.ok) {
		throw new Error(`GTFS-RT service_alerts unreachable (${res.status})`);
	}
	return parseServiceAlerts(await res.arrayBuffer(), nowSec);
}

/** @deprecated Use `fetchServiceAlerts` */
export async function fetchRailAlerts(nowSec = Math.floor(Date.now() / 1000)): Promise<ServiceAlert[]> {
	return fetchServiceAlerts(nowSec);
}

export function filterAlertsByMode(
	alerts: ServiceAlert[],
	mode: AlertMode,
	activeOnly = true,
): ServiceAlert[] {
	return alerts.filter((a) => (!activeOnly || a.active) && a.mode === mode);
}

export function filterAlertsByLine(
	alerts: ServiceAlert[],
	lineId: RailLineId | null,
	activeOnly = true,
): ServiceAlert[] {
	return alerts.filter((a) => {
		if (activeOnly && !a.active) return false;
		if (!lineId) return true;
		if (a.mode !== "train") return false;
		return a.lineIds.includes(lineId) || a.routeIds.some((r) => RAIL_LINES[lineId].routeIds.has(r));
	});
}

function routeLabelForAlert(a: ServiceAlert): string {
	if (a.mode === "train") {
		if (a.lineIds.length > 0) {
			return a.lineIds.map((id) => RAIL_LINES[id].label).join(", ");
		}
		if (a.routeIds.length > 0) return a.routeIds.join(", ");
		return "Rail network";
	}
	if (a.routeIds.length > 0) {
		return a.mode === "bus" ? `Routes ${a.routeIds.join(", ")}` : `Tram ${a.routeIds.join(", ")}`;
	}
	return a.mode === "bus" ? "Bus network" : "Tram network";
}

function alertCountsByMode(alerts: ServiceAlert[]): Record<AlertMode, number> {
	const counts: Record<AlertMode, number> = { train: 0, bus: 0, tram: 0 };
	for (const a of alerts) counts[a.mode] += 1;
	return counts;
}

function formatCountSummary(alerts: ServiceAlert[]): string {
	const c = alertCountsByMode(alerts);
	const parts: string[] = [];
	if (c.train > 0) parts.push(`🚆 **${c.train}** train`);
	if (c.bus > 0) parts.push(`🚌 **${c.bus}** bus`);
	if (c.tram > 0) parts.push(`🚋 **${c.tram}** tram`);
	return parts.join(" · ");
}

/** Combined across every embed on one message (not per embed). */
export const DISCORD_MESSAGE_EMBED_CHAR_MAX = 6000;
const DISCORD_MESSAGE_EMBED_CHAR_SAFE = 5800;
const DISCORD_MESSAGE_CONTENT_MAX = 2000;

/** @deprecated Use `DISCORD_MESSAGE_EMBED_CHAR_MAX` */
export const DISCORD_EMBED_CHAR_MAX = DISCORD_MESSAGE_EMBED_CHAR_MAX;

const EMBED_FOOTER_TEXT = "Adelaide Metro GTFS-RT service_alerts";

type AlertEmbedField = { name: string; value: string };

export type AlertEmbedDraft = {
	title: string;
	description: string;
	color: number;
	fields: AlertEmbedField[];
	footer?: { text: string };
};

export function discordEmbedCharLength(embed: AlertEmbedDraft): number {
	let n = embed.title.length + embed.description.length;
	for (const f of embed.fields) {
		n += f.name.length + f.value.length;
	}
	if (embed.footer?.text) n += embed.footer.text.length;
	return n;
}

function alertEmbedField(a: ServiceAlert, descriptionMax: number): AlertEmbedField {
	const lines = routeLabelForAlert(a);
	const rawDesc = a.description ?? "";
	const body =
		rawDesc.length > 0 ?
			`\n${rawDesc.slice(0, descriptionMax)}${rawDesc.length > descriptionMax ? "…" : ""}`
		:	"";
	const link = a.url ? `\n[More info](${a.url})` : "";
	return {
		name: `${MODE_EMOJI[a.mode]} ${a.effectLabel} · ${lines}`.slice(0, 256),
		value: `**${a.header}**${body}${link}`.slice(0, 1024),
	};
}

function withFooter(embed: AlertEmbedDraft): AlertEmbedDraft {
	return { ...embed, footer: { text: EMBED_FOOTER_TEXT } };
}

function fieldFitsMessageBudget(embed: AlertEmbedDraft, field: AlertEmbedField): boolean {
	return (
		discordEmbedCharLength(withFooter({ ...embed, fields: [...embed.fields, field] })) <=
		DISCORD_MESSAGE_EMBED_CHAR_SAFE
	);
}

function fitAlertField(embed: AlertEmbedDraft, alert: ServiceAlert): AlertEmbedField {
	for (const descriptionMax of [280, 200, 140, 80, 40, 0]) {
		const field = alertEmbedField(alert, descriptionMax);
		if (fieldFitsMessageBudget(embed, field)) return field;
	}
	return alertEmbedField(alert, 0);
}

function buildOverflowContent(overflow: ServiceAlert[]): string {
	const header = `**${overflow.length} more alert${overflow.length === 1 ? "" : "s"}**\n`;
	const lines: string[] = [];
	let length = header.length;

	for (const alert of overflow) {
		const routes =
			alert.routeIds.length > 0 ? ` (\`${alert.routeIds.slice(0, 4).join("`, `")}\`)` : "";
		const line = `${MODE_EMOJI[alert.mode]} **${alert.header.slice(0, 100)}**${routes}`;
		if (length + line.length + 1 > DISCORD_MESSAGE_CONTENT_MAX - 60) break;
		lines.push(line);
		length += line.length + 1;
	}

	const notListed = overflow.length - lines.length;
	let text = header + lines.join("\n");
	if (notListed > 0) {
		text += `\n_…and **${notListed}** more not listed._`;
	}
	return text.slice(0, DISCORD_MESSAGE_CONTENT_MAX);
}

export function formatAlertDiscordPayload(
	alerts: ServiceAlert[],
	title: string,
): { embeds: Record<string, unknown>[]; content?: string } {
	if (alerts.length === 0) {
		return {
			embeds: [
				{
					title,
					description:
						"No active **train, bus, or tram** disruptions in the GTFS-RT feed right now.",
					color: 0x007dc3,
				},
			],
		};
	}

	const summary = formatCountSummary(alerts);
	const embed: AlertEmbedDraft = {
		title,
		description: `${summary} — **${alerts.length}** active alert${alerts.length === 1 ? "" : "s"}.`,
		color: 0xc23b33,
		fields: [],
	};

	const included: ServiceAlert[] = [];

	for (const alert of alerts) {
		const field = fitAlertField(embed, alert);
		if (fieldFitsMessageBudget(embed, field)) {
			embed.fields.push(field);
			included.push(alert);
			continue;
		}
		if (included.length === 0) {
			embed.fields.push(field);
			included.push(alert);
		}
		break;
	}

	while (
		embed.fields.length > 0 &&
		discordEmbedCharLength(withFooter(embed)) > DISCORD_MESSAGE_EMBED_CHAR_MAX
	) {
		embed.fields.pop();
		included.pop();
	}

	const overflow = alerts.filter((a) => !included.includes(a));

	if (overflow.length > 0) {
		const note = `\n_**${included.length}** detailed in embed · **${overflow.length}** listed below._`;
		const trial = { ...embed, description: embed.description + note };
		if (discordEmbedCharLength(withFooter(trial)) <= DISCORD_MESSAGE_EMBED_CHAR_SAFE) {
			embed.description += note;
		}
	}

	const draft = withFooter(embed);
	const content = overflow.length > 0 ? buildOverflowContent(overflow) : undefined;
	return { embeds: [draft], content };
}

export function formatAlertEmbeds(
	alerts: ServiceAlert[],
	title: string,
): Record<string, unknown>[] {
	return formatAlertDiscordPayload(alerts, title).embeds;
}

export function messageEmbedCharTotal(embeds: AlertEmbedDraft[]): number {
	return embeds.reduce((sum, embed) => sum + discordEmbedCharLength(embed), 0);
}

/** @deprecated Use `formatAlertDiscordPayload` */
export function formatAlertEmbed(
	alerts: ServiceAlert[],
	title: string,
): Record<string, unknown> {
	return formatAlertDiscordPayload(alerts, title).embeds[0] ?? {
		title,
		description: "No alerts.",
		color: 0x007dc3,
	};
}

export function formatDiscordAlertPost(
	alert: ServiceAlert,
	roleId: string,
): {
	content: string;
	embeds: Record<string, unknown>[];
	components: ReturnType<typeof disruptionSubscribeComponents>;
} {
	const mention = roleId ? `<@&${roleId}> ` : "";
	const lines = routeLabelForAlert(alert);
	const emoji = MODE_EMOJI[alert.mode];
	const modeWord = MODE_LABEL[alert.mode];

	const embed: Record<string, unknown> = {
		title: `${emoji} ${alert.effectLabel}`,
		description: `**${alert.header}**`,
		color: 0xc23b33,
		fields: [
			{
				name: "Service / routes",
				value:
					lines +
					(alert.routeIds.length ? ` (\`${alert.routeIds.join("`, `")}\`)` : ""),
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
		content: `${mention}**New ${modeWord} disruption**`.trim(),
		embeds: [embed],
		components: disruptionSubscribeComponents(),
	};
}

export async function pushNewServiceAlerts(
	db: D1Database,
	postMessage: (payload: {
		content: string;
		embeds: Record<string, unknown>[];
		components: ReturnType<typeof disruptionSubscribeComponents>;
	}) => Promise<void>,
	roleId: string,
	nowSec = Math.floor(Date.now() / 1000),
): Promise<{ posted: string[]; active: number; skipped: number }> {
	const alerts = filterAlertsByLine(await fetchServiceAlerts(nowSec), null, true);
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
			.bind(alert.id, nowSec, `[${alert.mode}] ${alert.header.slice(0, 480)}`)
			.run();
		posted.push(alert.id);
	}

	return { posted, active: alerts.length, skipped };
}

/** @deprecated Use `pushNewServiceAlerts` */
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
	return pushNewServiceAlerts(db, postMessage, roleId, nowSec);
}
