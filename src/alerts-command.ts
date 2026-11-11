import {
	InteractionResponseFlags,
	InteractionResponseType,
} from "discord-interactions";
import { isRailLineId, lineChoiceList, RAIL_LINES, type RailLineId } from "./transit/lines";
import { editInteractionResponse } from "./discord-api";
import { disruptionSubscribeComponents } from "./config";
import {
	fetchServiceAlerts,
	filterAlertsByLine,
	filterAlertsByMode,
	formatAlertDiscordPayload,
	isAlertMode,
	type AlertMode,
} from "./transit/service-alerts";

type InteractionOption = {
	name: string;
	type: number;
	value?: string | number;
	focused?: boolean;
};

type CommandInteraction = {
	token?: string;
	data?: {
		name?: string;
		options?: InteractionOption[];
	};
};

const MODE_LABEL: Record<AlertMode, string> = {
	train: "Train",
	bus: "Bus",
	tram: "Tram",
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
	const commandName = interaction.data?.name;
	const options = interaction.data?.options ?? [];
	const focused = options.find((o) => o.focused);
	const query = focused?.value !== undefined ? String(focused.value) : "";

	if (focused?.name === "line") {
		if (commandName === "disruption") {
			const modeRaw = stringOption(options, "type");
			if (modeRaw !== "train") {
				return json({
					type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					data: { choices: [] },
				});
			}
		}
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

export function handleAlertsSlashCommand(
	interaction: CommandInteraction,
	commandName: "alerts" | "disruption",
	applicationId: string,
	ctx: { waitUntil(promise: Promise<unknown>): void },
): Response {
	const options = interaction.data?.options;

	let modeFilter: AlertMode | null = null;
	if (commandName === "disruption") {
		const modeRaw = stringOption(options, "type");
		if (!modeRaw || !isAlertMode(modeRaw)) {
			return json({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					content: "Choose **type**: Train, Bus, or Tram.",
					flags: InteractionResponseFlags.EPHEMERAL,
				},
			});
		}
		modeFilter = modeRaw;
	}

	const lineRaw = stringOption(options, "line");
	const lineFilter: RailLineId | null =
		lineRaw && isRailLineId(lineRaw) ? lineRaw : null;
	if (lineRaw && !lineFilter) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Pick a valid **line** from autocomplete, or leave it blank.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	if (commandName === "disruption" && modeFilter !== "train" && lineFilter) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "**Line** only applies when **type** is Train — pick a line or leave it blank.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const token = interaction.token;
	if (!token) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Could not read interaction token.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const effectiveLineFilter =
		commandName === "disruption" && modeFilter !== "train" ? null : lineFilter;

	ctx.waitUntil(
		(async () => {
			try {
				let alerts = await fetchServiceAlerts();
				if (modeFilter) {
					alerts = filterAlertsByMode(alerts, modeFilter);
				}
				alerts = filterAlertsByLine(alerts, effectiveLineFilter, true);

				const title =
					commandName === "disruption" && modeFilter ?
						effectiveLineFilter ?
							`${MODE_LABEL[modeFilter]} disruptions — ${RAIL_LINES[effectiveLineFilter].label}`
						:	`${MODE_LABEL[modeFilter]} disruptions`
					: effectiveLineFilter ?
						`Service alerts — ${RAIL_LINES[effectiveLineFilter].label} (+ bus & tram)`
					:	"Train, bus & tram service alerts";

				const formatted = formatAlertDiscordPayload(alerts, title);
				const payload: {
					content?: string;
					embeds: Record<string, unknown>[];
					components?: ReturnType<typeof disruptionSubscribeComponents>;
				} = {
					embeds: formatted.embeds,
				};
				if (formatted.content) {
					payload.content = formatted.content;
				}
				if (commandName === "disruption") {
					payload.components = disruptionSubscribeComponents();
				}

				await editInteractionResponse(applicationId, token, payload);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Could not load alerts";
				await editInteractionResponse(applicationId, token, {
					content: `Alerts unavailable: ${message}`,
				});
			}
		})(),
	);

	return json({
		type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
		data: {},
	});
}
