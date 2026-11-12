import {
	editChannelMessage,
	fetchChannelMessages,
	postChannelReply,
	type DiscordChannelMessage,
} from "./discord-api";
import type { WorkerEnv } from "./env.d";
import { nvidiaChatCompletion, type ChatMessage } from "./nvidia-chat";

export const MENTION_THINKING_TEXT = "_Metro Mate is thinking…_";

const MENTION_SYSTEM_PROMPT = [
	"You are Metro Mate, the Adelaide Public Transport Discord assistant.",
	"Answer questions about Adelaide Metro trains, trams, buses, stations, and service info.",
	"Use the recent channel context when it helps; do not invent timetables or live delays.",
	"If unsure, say what you are unsure about. English only. Under 1800 characters.",
].join(" ");

export type MentionChatEvent = {
	channel_id: string;
	guild_id?: string;
	message_id: string;
	author_id: string;
	author_username: string;
	content: string;
	bot_user_id: string;
};

export function stripBotMention(content: string, botUserId: string): string {
	return content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
}

export function buildMentionChatMessages(
	priorMessages: DiscordChannelMessage[],
	authorUsername: string,
	userQuestion: string,
): ChatMessage[] {
	const lines = priorMessages
		.filter((m) => m.content.trim().length > 0)
		.map((m) => {
			const who = m.author.bot ? "Metro Mate" : m.author.username;
			return `${who}: ${m.content.trim().slice(0, 600)}`;
		});

	const context =
		lines.length > 0 ?
			`Recent messages in this channel (oldest first):\n${lines.join("\n")}`
		:	"(No prior channel context.)";

	const question = userQuestion.trim() || "(No text after the mention.)";

	return [
		{ role: "system", content: MENTION_SYSTEM_PROMPT },
		{
			role: "user",
			content: `${context}\n\n${authorUsername} asked:\n${question}`,
		},
	];
}

export function truncateDiscordContent(text: string, max = 2000): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}

export async function processMentionChat(
	env: WorkerEnv,
	event: MentionChatEvent,
): Promise<void> {
	const apiKey = env.NVIDIA_API_KEY;
	const token = env.DISCORD_BOT_TOKEN;
	const question = stripBotMention(event.content, event.bot_user_id);

	let thinkingMessageId: string | null = null;
	try {
		const thinking = await postChannelReply(token, event.channel_id, {
			content: MENTION_THINKING_TEXT,
			replyToMessageId: event.message_id,
			guildId: event.guild_id,
		});
		thinkingMessageId = thinking.id;
	} catch (error) {
		console.error("mention-chat: could not post thinking placeholder", error);
		return;
	}

	const finish = async (content: string): Promise<void> => {
		const body = truncateDiscordContent(content);
		await editChannelMessage(token, event.channel_id, thinkingMessageId!, { content: body });
	};

	if (!apiKey) {
		await finish(
			"Mention chat is not configured — set **NVIDIA_API_KEY** on the worker.",
		);
		return;
	}

	try {
		const prior = await fetchChannelMessages(token, event.channel_id, {
			before: event.message_id,
			limit: 5,
		});
		const chronological = [...prior].reverse();
		const messages = buildMentionChatMessages(
			chronological,
			event.author_username,
			question,
		);
		const answer = await nvidiaChatCompletion(apiKey, messages, {
			maxTokens: 700,
			timeoutMs: 50_000,
		});
		await finish(answer);
	} catch (error) {
		const message = error instanceof Error ? error.message : "AI request failed";
		console.error("mention-chat:", message);
		await finish(`Sorry — I could not answer that: ${message}`);
	}
}
