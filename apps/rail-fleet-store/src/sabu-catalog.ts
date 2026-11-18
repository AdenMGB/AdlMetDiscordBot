import { inferFleetMeta, isoUtcNow } from "@metro-mate/rail-fleet-core";
import type Database from "better-sqlite3";

export type SabuFleetRow = {
	setId: string;
	chassis: string;
	bodyClass: string;
	lastSeenRaw: string;
	statusText: string;
};

/** Parse manufacturer, class line, and optional Last Seen from a SABU details cell. */
export function parseSabuDetailText(details: string): {
	chassis: string;
	bodyClass: string;
	lastSeenRaw: string;
} {
	const lastSeenRaw =
		details.match(
			/Last Seen\s*(\d{2}-\d{2}-\d{4}\s+\d{1,2}:\d{2}:\d{2})/i,
		)?.[1] ?? "";
	const withoutLast = details
		.replace(/\s*Last Seen\s*\d{2}-\d{2}-\d{4}\s+\d{1,2}:\d{2}:\d{2}/i, "")
		.trim();

	const classAt = withoutLast.search(/\d{3,4}\s*Class\b/i);
	let chassis = "";
	let bodyClass = "";
	if (classAt >= 0) {
		chassis = withoutLast.slice(0, classAt).trim();
		bodyClass = withoutLast.slice(classAt).trim();
	} else {
		const lines = withoutLast
			.split(/\n+/)
			.map((s) => s.trim())
			.filter(Boolean);
		chassis = lines.find((l) => /comeng|bombardier|clyde/i.test(l)) ?? "";
		bodyClass = lines.find((l) => /\bclass\b/i.test(l)) ?? "";
		if (!bodyClass) {
			const classMatch = withoutLast.match(/\d{3,4}\s*Class[\sA-Za-z-]*/i);
			bodyClass = classMatch?.[0]?.trim() ?? "";
		}
		if (!chassis && bodyClass) {
			const idx = withoutLast.indexOf(bodyClass);
			chassis = (idx > 0 ? withoutLast.slice(0, idx) : withoutLast.replace(bodyClass, ""))
				.trim();
		}
	}

	return { chassis, bodyClass, lastSeenRaw };
}

export function normalizeSabuFleetRow(row: SabuFleetRow): SabuFleetRow {
	const blob = `${row.chassis}\n${row.bodyClass}`.trim();
	const parsed = parseSabuDetailText(
		row.lastSeenRaw ? `${blob} Last Seen ${row.lastSeenRaw}` : blob,
	);
	const statusText = row.statusText
		.replace(/\s*View Vehicle Details\s*/gi, "")
		.trim();
	return {
		setId: row.setId,
		chassis: parsed.chassis || row.chassis,
		bodyClass: parsed.bodyClass || row.bodyClass,
		lastSeenRaw: parsed.lastSeenRaw || row.lastSeenRaw,
		statusText,
	};
}

/** DD-MM-YYYY HH:MM:SS in Adelaide → UTC ISO (approximate offset for SA). */
export function sabuLastSeenToIso(raw: string): string | null {
	const m = raw.trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
	if (!m) return null;
	const [, dd, mm, yyyy, hh, mi, ss] = m;
	const pad = (n: string) => n.padStart(2, "0");
	const local = `${yyyy}-${pad(mm)}-${pad(dd)}T${pad(hh)}:${mi}:${ss}`;
	const month = Number.parseInt(mm, 10);
	const day = Number.parseInt(dd, 10);
	// SA daylight: Oct–Mar +10:30, else +09:30 (simplified month rule)
	const offset =
		month >= 10 || month <= 3 || (month === 4 && day < 7) ? "+10:30" : "+09:30";
	const ms = Date.parse(`${local}${offset}`);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function parseSabuStatus(statusText: string): {
	last_status: string;
	last_route_id: string | null;
	last_headsign: string | null;
	next_stop_hint: string | null;
} {
	const lines = statusText
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
	const flat = lines.join(" ");

	if (/not in service/i.test(flat)) {
		return {
			last_status: "NOT IN SERVICE",
			last_route_id: null,
			last_headsign: null,
			next_stop_hint: null,
		};
	}

	const nextStop =
		flat.match(/Next Stop:\s*(.+)$/i)?.[1]?.trim() ??
		lines.find((l) => /^Next Stop:/i.test(l))?.replace(/^Next Stop:\s*/i, "") ??
		null;

	const route_id = lines[0]?.match(/^[A-Z0-9_]+$/) ? lines[0] : null;
	const headsign = lines[1] && !/^Next Stop:/i.test(lines[1]) ? lines[1] : null;

	if (/between trips/i.test(flat)) {
		return {
			last_status: "BETWEEN TRIPS",
			last_route_id: route_id,
			last_headsign: headsign,
			next_stop_hint: nextStop,
		};
	}

	return {
		last_status: route_id ? "IN SERVICE" : "LAST KNOWN",
		last_route_id: route_id,
		last_headsign: headsign,
		next_stop_hint: nextStop,
	};
}

export function ensureCatalogColumns(db: Database.Database): void {
	const cols = db
		.prepare(`PRAGMA table_info(vehicles)`)
		.all() as { name: string }[];
	const names = new Set(cols.map((c) => c.name));
	if (!names.has("next_stop_hint")) {
		db.exec(`ALTER TABLE vehicles ADD COLUMN next_stop_hint TEXT`);
	}
	if (!names.has("catalog_updated_at")) {
		db.exec(`ALTER TABLE vehicles ADD COLUMN catalog_updated_at TEXT`);
	}
}

export function upsertSabuCatalogRow(
	db: Database.Database,
	row: SabuFleetRow,
	importedAt: string,
): boolean {
	row = normalizeSabuFleetRow(row);
	if (!/^\d{4}$/.test(row.setId)) return false;

	const lastSeen =
		sabuLastSeenToIso(row.lastSeenRaw) ?? (row.lastSeenRaw || importedAt);
	const status = parseSabuStatus(row.statusText);
	const meta = inferFleetMeta(row.setId);
	const body =
		row.bodyClass.trim() || meta.body;
	const chassis =
		row.chassis.trim() || meta.chassis;

	const existing = db
		.prepare(`SELECT * FROM vehicles WHERE set_id = ?`)
		.get(row.setId) as Record<string, unknown> | undefined;

	const useSabuLive =
		!existing ||
		!existing.last_lat ||
		Date.parse(String(lastSeen)) >= Date.parse(String(existing.last_seen_at));

	const stmt = db.prepare(
		`INSERT INTO vehicles (
			set_id, body_class, chassis, first_seen_at, last_seen_at,
			last_lat, last_lon, last_bearing, last_speed_mps,
			last_route_id, last_trip_id, last_headsign, last_stop_id, last_status,
			next_stop_hint, catalog_updated_at
		) VALUES (
			@set_id, @body_class, @chassis, @first_seen, @last_seen,
			NULL, NULL, NULL, NULL,
			@route_id, NULL, @headsign, NULL, @status,
			@next_stop, @catalog_updated_at
		)
		ON CONFLICT(set_id) DO UPDATE SET
			body_class = @body_class,
			chassis = @chassis,
			first_seen_at = CASE
				WHEN datetime(@first_seen) < datetime(vehicles.first_seen_at) THEN @first_seen
				ELSE vehicles.first_seen_at
			END,
			last_seen_at = CASE
				WHEN datetime(@last_seen) > datetime(vehicles.last_seen_at) THEN @last_seen
				ELSE vehicles.last_seen_at
			END,
			last_route_id = CASE WHEN @apply_live THEN @route_id ELSE vehicles.last_route_id END,
			last_headsign = CASE WHEN @apply_live THEN @headsign ELSE vehicles.last_headsign END,
			last_status = CASE WHEN @apply_live THEN @status ELSE vehicles.last_status END,
			next_stop_hint = CASE WHEN @apply_live THEN @next_stop ELSE vehicles.next_stop_hint END,
			catalog_updated_at = @catalog_updated_at`,
	);

	stmt.run({
		set_id: row.setId,
		body_class: body,
		chassis,
		first_seen: lastSeen,
		last_seen: lastSeen,
		route_id: status.last_route_id,
		headsign: status.last_headsign,
		status: status.last_status,
		next_stop: status.next_stop_hint,
		catalog_updated_at: importedAt,
		apply_live: useSabuLive ? 1 : 0,
	});
	return true;
}

export function scrapeRowsFromPageHtml(html: string): SabuFleetRow[] {
	const rows: SabuFleetRow[] = [];
	const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
	let trMatch: RegExpExecArray | null;
	while ((trMatch = trRe.exec(html))) {
		const tr = trMatch[1];
		if (!/<td/i.test(tr)) continue;
		const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
			stripTags(m[1]).replace(/\s+/g, " ").trim(),
		);
		if (tds.length < 3) continue;
		const setId = tds[0].match(/\b(3\d{3}|4\d{3})\b/)?.[1];
		if (!setId) continue;
		const detailsRaw = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)][1]?.[1] ?? "";
		const detailsText = stripTags(detailsRaw);
		const detailLines = detailsText
			.split(/\n+/)
			.map((s) => s.trim())
			.filter(Boolean);
		const chassis =
			detailLines.find((l) => /comeng|bombardier|clyde/i.test(l)) ?? detailLines[0] ?? "";
		const bodyClass =
			detailLines.find((l) => /class/i.test(l)) ??
			detailLines[1] ??
			"";
		const lastSeen =
			detailsText.match(
				/Last Seen\s*(\d{2}-\d{2}-\d{4}\s+\d{1,2}:\d{2}:\d{2})/i,
			)?.[1] ?? "";
		const statusCell = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)][2]?.[1] ?? "";
		const statusText = stripTags(statusCell).trim();
		rows.push({ setId, chassis, bodyClass, lastSeenRaw: lastSeen, statusText });
	}
	return rows;
}

function stripTags(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
}