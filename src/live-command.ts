import {
	InteractionResponseFlags,
	InteractionResponseType,
} from "discord-interactions";
import type { D1Database } from "@cloudflare/workers-types";
import { editInteractionResponse } from "./discord-api";
import { buildExpandedSetEmbed } from "./transit/live-set-detail";
import {
	buildLiveTrainList,
	formatLiveTrainsEmbed,
	liveSetAutocompleteChoices,
} from "./transit/live-trains";
import { isRailLineId, lineChoiceList } from "./transit/lines";
import { fetchLiveRailFeeds, fetchLiveRailVehicles } from "./transit/rt-feed";

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

function lineFilterFromOptions(options: InteractionOption[] | undefined) {
	const lineRaw = stringOption(options, "line");
	if (!lineRaw) return null;
	return isRailLineId(lineRaw) ? lineRaw : null;
}

export async function handleLiveTrainsAutocomplete(
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

	if (focused?.name === "set") {
		try {
			const vehicles = await fetchLiveRailVehicles();
			const lineFilter = lineFilterFromOptions(options);
			const choices = liveSetAutocompleteChoices(vehicles, lineFilter, query);
			return json({
				type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
				data: { choices },
			});
		} catch {
			return json({
				type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
				data: { choices: [] },
			});
		}
	}

	return json({
		type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
		data: { choices: [] },
	});
}

export function handleLiveTrainsCommand(
	interaction: CommandInteraction,
	db: D1Database | undefined,
	applicationId: string,
	ctx: { waitUntil(promise: Promise<unknown>): void },
): Response {
	if (!db) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Live trains need the D1 binding (static trip paths).",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const options = interaction.data?.options;
	const lineRaw = stringOption(options, "line");
	const lineFilter = lineRaw && isRailLineId(lineRaw) ? lineRaw : null;
	if (lineRaw && !lineFilter) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Pick a valid **line** from autocomplete, or leave it blank for all lines.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	const setFilter = stringOption(options, "set") ?? null;

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

	ctx.waitUntil(
		(async () => {
			try {
				const fetchedAt = Math.floor(Date.now() / 1000);
				const { vehicles, tripUpdates } = await fetchLiveRailFeeds();
				const embed = setFilter ?
					await buildExpandedSetEmbed(
						db,
						vehicles,
						tripUpdates,
						setFilter,
						fetchedAt,
					)
				:	formatLiveTrainsEmbed(
						await buildLiveTrainList(
							db,
							vehicles,
							tripUpdates,
							lineFilter,
							null,
						),
						lineFilter,
						fetchedAt,
						null,
					);
				await editInteractionResponse(applicationId, token, { embeds: [embed] });
			} catch (error) {
				const message = error instanceof Error ? error.message : "GTFS-RT fetch failed";
				await editInteractionResponse(applicationId, token, {
					content: `Could not load live trains: ${message}`,
				});
			}
		})(),
	);

	return json({
		type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
		data: {},
	});
}
