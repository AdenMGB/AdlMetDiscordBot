import {
	InteractionResponseFlags,
	InteractionResponseType,
} from "discord-interactions";
import { isRailLineId, lineChoiceList, RAIL_LINES, type RailLineId } from "./transit/lines";
import { disruptionSubscribeComponents } from "./config";
import {
	fetchRailAlerts,
	filterAlertsByLine,
	formatAlertEmbed,
} from "./transit/service-alerts";

type InteractionOption = {
	name: string;
	type: number;
	value?: string | number;
	focused?: boolean;
};

type CommandInteraction = {
	data?: {
		name?: string;
		options?: InteractionOption[];
	};
};

function json(data: unknown): Response {
	return new Response(JSON.stringify(data), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function stringOption(
	options: InteractionOption[] | undefined,
	name: string,
): string | undefined {
	const raw = options?.find((o) => o.name === name)?.value;
	if (raw === undefined || raw === null) return undefined;
	const s = String(raw).trim();
	return s.length > 0 ? s : undefined;
}

export async function handleAlertsAutocomplete(
	interaction: CommandInteraction,
): Promise<Response> {
	const options = interaction.data?.options ?? [];
	const focused = options.find((o) => o.focused);
	const query = focused?.value !== undefined ? String(focused.value) : "";
	if (focused?.name === "line") {
		return json({
			type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
			data: {
				choices: lineChoiceList(query).slice(0, 25).map((c) => ({
					name: c.name,
					value: c.value,
				})),
			},
		});
	}
	return json({
		type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
		data: { choices: [] },
	});
}

export async function handleAlertsSlashCommand(
	interaction: CommandInteraction,
	commandName: "alerts" | "disruption",
): Promise<Response> {
	const lineRaw = stringOption(interaction.data?.options, "line");
	const lineFilter =
		lineRaw && isRailLineId(lineRaw) ? lineRaw : null;
	if (lineRaw && !lineFilter) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Pick a valid **line** from autocomplete, or leave it blank for all rail lines.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	try {
		const alerts = filterAlertsByLine(await fetchRailAlerts(), lineFilter, true);
		const title =
			commandName === "disruption" ?
				lineFilter ?
					`Disruptions — ${RAIL_LINES[lineFilter].label}`
				:	"Train disruptions"
			: lineFilter ?
				`Rail alerts — ${RAIL_LINES[lineFilter].label}`
			:	"Rail service alerts";

		const data: Record<string, unknown> = {
			embeds: [formatAlertEmbed(alerts, title)],
		};
		if (commandName === "disruption") {
			data.components = disruptionSubscribeComponents();
		}

		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Could not load alerts";
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: `Alerts unavailable: ${message}`,
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}
}
