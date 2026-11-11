import {
	InteractionResponseFlags,
	InteractionResponseType,
} from "discord-interactions";
import { editInteractionResponse } from "./discord-api";
import type { WorkerEnv } from "./env.d";
import { nvidiaChatCompletion } from "./nvidia-chat";

type InteractionOption = {
	name: string;
	type: number;
	value?: string | number;
};

type CommandInteraction = {
	token?: string;
	data?: {
		options?: InteractionOption[];
	};
};

const FACT_SYSTEM_PROMPT = [
	"You are Metro Mate for the Adelaide Public Transport Discord.",
	"Share exactly one interesting, accurate fact about Adelaide Metro trains,",
	"trams, buses, or South Australian public transport (history, fleet, stations, operations).",
	"If you are not confident it is accurate, say so briefly instead of inventing details.",
	"Write in a friendly tone in English only. No title line. Max about 800 characters.",
].join(" ");

async function safeEditFactResponse(
	applicationId: string,
	token: string,
	data: { content?: string; embeds?: unknown[] },
): Promise<void> {
	try {
		await editInteractionResponse(applicationId, token, data);
	} catch (error) {
		console.error("Failed to edit /fact interaction response:", error);
	}
}

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

function factEmbed(fact: string, topic: string | undefined) {
	const title = topic ? `Metro fact — ${topic.slice(0, 80)}` : "Adelaide Metro fact";
	return {
		title,
		description: fact.slice(0, 4096),
		color: 0x3a86ff,
		footer: { text: "Generated via NVIDIA · double-check unusual claims" },
	};
}

export function handleFactCommand(
	interaction: CommandInteraction,
	env: WorkerEnv,
	applicationId: string,
	ctx: { waitUntil(promise: Promise<unknown>): void },
): Response {
	const apiKey = env.NVIDIA_API_KEY;
	if (!apiKey) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content:
					"`/fact` is not configured — set **NVIDIA_API_KEY** (`wrangler secret put` or `.dev.vars`).",
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

	const topic = stringOption(interaction.data?.options, "topic");

	ctx.waitUntil(
		(async () => {
			try {
				const userPrompt = topic
					? `Topic focus: ${topic}. One fact only.`
					: "Random Adelaide Metro / public transport fact. One fact only.";
				const fact = await nvidiaChatCompletion(apiKey, [
					{ role: "system", content: FACT_SYSTEM_PROMPT },
					{ role: "user", content: userPrompt },
				]);
				await safeEditFactResponse(applicationId, token, {
					embeds: [factEmbed(fact, topic)],
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : "Fact generation failed";
				await safeEditFactResponse(applicationId, token, {
					content: `Could not generate a fact: ${message}`,
				});
			}
		})(),
	);

	return json({
		type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
		data: {},
	});
}
