import {
	InteractionResponseFlags,
	InteractionResponseType,
} from "discord-interactions";
import type { D1Database } from "@cloudflare/workers-types";
import { clampCount, resolveTimetableReference } from "./transit/format";
import { lineChoiceList, isRailLineId } from "./transit/lines";
import {
	fetchUpcomingDepartures,
	getGtfsMeta,
	getStationOnLine,
	stationAutocompleteChoices,
} from "./transit/db";
import { buildTimetableEmbed } from "./transit/timetable";

type InteractionOption = {
	name: string;
	type: number;
	value?: string | number;
	focused?: boolean;
};

type AutocompleteInteraction = {
	data?: {
		name?: string;
		options?: InteractionOption[];
	};
};

type CommandInteraction = AutocompleteInteraction & {
	data?: {
		name?: string;
		options?: InteractionOption[];
	};
};

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function optionValue(
	options: InteractionOption[] | undefined,
	name: string,
): string | number | undefined {
	return options?.find((o) => o.name === name)?.value;
}

function stringOption(
	options: InteractionOption[] | undefined,
	name: string,
): string | undefined {
	const raw = optionValue(options, name);
	if (raw === undefined || raw === null) return undefined;
	const s = String(raw).trim();
	return s.length > 0 ? s : undefined;
}

function focusedAutocomplete(options: InteractionOption[] | undefined): string {
	const focused = options?.find((o) => o.focused);
	if (focused?.value !== undefined) return String(focused.value);
	return "";
}

export async function handleTimetableAutocompleteAsync(
	interaction: AutocompleteInteraction,
	db: D1Database | undefined,
): Promise<Response> {
	if (!db) {
		return json({
			type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
			data: { choices: [] },
		});
	}
	const options = interaction.data?.options ?? [];
	const focusedName = options.find((o) => o.focused)?.name;
	const query = focusedAutocomplete(options);

	if (focusedName === "line") {
		const choices = lineChoiceList(query).slice(0, 25).map((c) => ({
			name: c.name,
			value: c.value,
		}));
		return json({
			type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
			data: { choices },
		});
	}

	if (focusedName === "station") {
		const lineRaw = String(optionValue(options, "line") ?? "");
		const choices = await stationAutocompleteChoices(db, lineRaw, query);
		return json({
			type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
			data: { choices },
		});
	}

	return json({
		type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
		data: { choices: [] },
	});
}

export async function handleTimetableCommand(
	interaction: CommandInteraction,
	db: D1Database | undefined,
): Promise<Response> {
	if (!db) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content:
					"Timetable data is not configured on this Worker (missing D1 binding).",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const options = interaction.data?.options ?? [];
	const lineRaw = String(optionValue(options, "line") ?? "");
	const stopId = String(optionValue(options, "station") ?? "");
	const count = clampCount(optionValue(options, "count"));
	const timeRaw = stringOption(options, "time");
	const dateRaw = stringOption(options, "date");

	if (!isRailLineId(lineRaw)) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content:
					"Choose a valid **train line** (Gawler, Seaford, Flinders, Outer Harbor, Grange, Port Dock, Belair).",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	if (!stopId) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Choose a **station** on that line.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const station = await getStationOnLine(db, lineRaw, stopId);
	if (!station) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "That station is not on the selected line. Pick again from autocomplete.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const actualNowSec = Math.floor(Date.now() / 1000);
	const reference = resolveTimetableReference(timeRaw, dateRaw, actualNowSec);
	if (!reference.ok) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: reference.message,
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const nowSec = reference.referenceSec;
	const departures = await fetchUpcomingDepartures(
		db,
		lineRaw,
		station.name,
		nowSec,
		Math.max(200, count * 20),
	);
	if (departures.length === 0) {
		const imported = await getGtfsMeta(db, "imported_at");
		const hint = imported
			? reference.custom
				? "No scheduled departures after that **time/date** in the cached feed for this stop. If you chose an earlier time today, re-run `pnpm run import-gtfs --apply-remote` so the full day is cached."
				: "No upcoming departures in the cached feed for this stop — the schedule may have ended for today."
			: "GTFS data has not been imported yet. Run `pnpm run import-gtfs` and apply it to D1.";
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: hint,
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const feedUpdated = (await getGtfsMeta(db, "imported_at")) ?? undefined;
	const embed = buildTimetableEmbed(
		lineRaw,
		station.name,
		departures,
		count,
		nowSec,
		feedUpdated,
		reference.custom ? reference.label : undefined,
	);

	return json({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: { embeds: [embed] },
	});
}
