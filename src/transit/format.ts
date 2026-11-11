const ADELAIDE_TZ = "Australia/Adelaide";

/** Matches GTFS import window in `scripts/import-rail-gtfs.py`. */
export const TIMETABLE_CACHE_DAYS = 14;

export function displayStationName(stopName: string): string {
	return stopName.replace(/\s+Railway Station$/i, "").trim() || stopName;
}

export function isCityBoundHeadsign(headsign: string): boolean {
	const h = headsign.trim();
	return /\bcity\b/i.test(h) || /^adelaide\b/i.test(h);
}

export function formatAdelaideTime(unixSec: number, nowSec: number): string {
	const time = new Intl.DateTimeFormat("en-AU", {
		timeZone: ADELAIDE_TZ,
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(new Date(unixSec * 1000));

	const deltaMin = Math.round((unixSec - nowSec) / 60);
	if (deltaMin > 0 && deltaMin <= 90) {
		return `${time} (${deltaMin} min)`;
	}
	return time;
}

export function clampCount(raw: unknown): number {
	const n = typeof raw === "number" ? raw : 6;
	if (!Number.isFinite(n)) return 6;
	return Math.min(20, Math.max(2, Math.floor(n)));
}

export function perDirectionLimit(total: number): number {
	return Math.max(1, Math.ceil(total / 2));
}

function adelaideParts(unixSec: number): {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
} {
	const fmt = new Intl.DateTimeFormat("en-GB", {
		timeZone: ADELAIDE_TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	const map: Record<string, string> = {};
	for (const p of fmt.formatToParts(new Date(unixSec * 1000))) {
		if (p.type !== "literal") map[p.type] = p.value;
	}
	return {
		year: Number(map.year),
		month: Number(map.month),
		day: Number(map.day),
		hour: Number(map.hour),
		minute: Number(map.minute),
	};
}

/** Convert Adelaide local civil time to Unix seconds (handles DST). */
export function adelaideLocalToUnix(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
): number {
	const wantUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
	let guessMs = wantUtcMs - 10.5 * 60 * 60 * 1000;
	for (let i = 0; i < 6; i++) {
		const got = adelaideParts(Math.floor(guessMs / 1000));
		const gotAsUtcMs = Date.UTC(
			got.year,
			got.month - 1,
			got.day,
			got.hour,
			got.minute,
			0,
		);
		const diff = wantUtcMs - gotAsUtcMs;
		if (diff === 0) break;
		guessMs += diff;
	}
	return Math.floor(guessMs / 1000);
}

function startOfAdelaideDay(year: number, month: number, day: number): number {
	return adelaideLocalToUnix(year, month, day, 0, 0);
}

function parseDateString(raw: string): { year: number; month: number; day: number } | null {
	const s = raw.trim();
	let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (m) {
		return { year: +m[1], month: +m[2], day: +m[3] };
	}
	m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
	if (m) {
		return { year: +m[3], month: +m[2], day: +m[1] };
	}
	return null;
}

function parseTimeString(raw: string): { hour: number; minute: number } | null {
	const trimmed = raw.trim();
	const isoTime = /T(\d{1,2}):(\d{2})(?::\d{2})?/i.exec(trimmed);
	if (isoTime) {
		const hour = +isoTime[1];
		const minute = +isoTime[2];
		if (hour <= 23 && minute <= 59) return { hour, minute };
	}
	const s = trimmed.toLowerCase().replace(/\s+/g, "");
	let m = /^(\d{1,2}):(\d{2})$/.exec(s);
	if (m) {
		const hour = +m[1];
		const minute = +m[2];
		if (hour > 23 || minute > 59) return null;
		return { hour, minute };
	}
	m = /^(\d{1,2}):(\d{2})(am|pm)$/.exec(s);
	if (m) {
		let hour = +m[1];
		const minute = +m[2];
		const ampm = m[3];
		if (hour < 1 || hour > 12 || minute > 59) return null;
		if (ampm === "am") {
			if (hour === 12) hour = 0;
		} else if (hour !== 12) {
			hour += 12;
		}
		return { hour, minute };
	}
	m = /^(\d{1,2})(am|pm)$/.exec(s);
	if (m) {
		let hour = +m[1];
		if (hour < 1 || hour > 12) return null;
		if (m[2] === "am") {
			if (hour === 12) hour = 0;
		} else if (hour !== 12) {
			hour += 12;
		}
		return { hour, minute: 0 };
	}
	return null;
}

export function formatAdelaideReference(unixSec: number): string {
	return new Intl.DateTimeFormat("en-AU", {
		timeZone: ADELAIDE_TZ,
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(new Date(unixSec * 1000));
}

export type TimetableReference =
	| { ok: true; referenceSec: number; custom: boolean; label: string }
	| { ok: false; message: string };

/** Resolve optional Discord `time` / `date` strings against actual now. */
export function resolveTimetableReference(
	timeRaw: string | undefined,
	dateRaw: string | undefined,
	actualNowSec: number,
): TimetableReference {
	const hasTime = Boolean(timeRaw?.trim());
	const hasDate = Boolean(dateRaw?.trim());

	if (!hasTime && !hasDate) {
		return {
			ok: true,
			referenceSec: actualNowSec,
			custom: false,
			label: "now",
		};
	}

	let year: number;
	let month: number;
	let day: number;
	let hour: number;
	let minute: number;

	if (hasDate) {
		const parsed = parseDateString(dateRaw!);
		if (!parsed) {
			return {
				ok: false,
				message:
					"Could not parse **date**. Use `YYYY-MM-DD` or `DD/MM/YYYY` (Adelaide calendar).",
			};
		}
		({ year, month, day } = parsed);
	} else {
		const today = adelaideParts(actualNowSec);
		year = today.year;
		month = today.month;
		day = today.day;
	}

	if (hasTime) {
		const parsed = parseTimeString(timeRaw!);
		if (!parsed) {
			return {
				ok: false,
				message:
					"Could not parse **time**. Use `HH:MM` (24h), `3:45pm`, or `3pm` (Adelaide time).",
			};
		}
		({ hour, minute } = parsed);
	} else {
		hour = 0;
		minute = 0;
	}

	const referenceSec = hasTime
		? adelaideLocalToUnix(year, month, day, hour, minute)
		: startOfAdelaideDay(year, month, day);

	const dayStart = startOfAdelaideDay(
		adelaideParts(actualNowSec).year,
		adelaideParts(actualNowSec).month,
		adelaideParts(actualNowSec).day,
	);
	const maxSec =
		dayStart + TIMETABLE_CACHE_DAYS * 86400 + 86400 - 1;
	if (referenceSec < dayStart - 86400) {
		return {
			ok: false,
			message: "That **date** is before the cached GTFS window. Re-import or pick a later day.",
		};
	}
	if (referenceSec > maxSec) {
		return {
			ok: false,
			message: `That **date** is more than **${TIMETABLE_CACHE_DAYS} days** ahead of the cache. Re-run the GTFS import or pick a nearer day.`,
		};
	}

	return {
		ok: true,
		referenceSec,
		custom: true,
		label: formatAdelaideReference(referenceSec),
	};
}
