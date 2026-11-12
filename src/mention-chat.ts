import {
	buildMentionChatMessages,
	MENTION_THINKING_TEXT,
	nvidiaChatCompletion,
	stripBotMention,
	truncateDiscordContent,
	type DiscordChannelMessage,
} from "@metro-mate/chat-core";
import {
	editChannelMessage,
	fetchChannelMessages,
	postChannelReply,
} from "./discord-api";
import type { WorkerEnv } from "./env.d";

export { MENTION_THINKING_TEXT, stripBotMention, truncateDiscordContent };

export type MentionChatEvent = {
	channel_id: string;
	guild_id?: string;
	message_id: string;
	author_id: string;
	author_username: string;
	content: string;
	bot_user_id: string;
	/** Serialized reply target from the gateway relay / runner when available */
	referenced_message?: DiscordChannelMessage | null;
};

export { buildMentionChatMessages };

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
			limit: 15,
		});
		const chronological = [...prior].reverse();

		const triggerMessage: DiscordChannelMessage = {
			id: event.message_id,
			content: event.content,
			author: { id: event.author_id, username: event.author_username },
			referenced_message: event.referenced_message ?? null,
		};

		const messages = buildMentionChatMessages({
			priorMessages: chronological,
			triggerMessage,
			botUserId: event.bot_user_id,
			authorUsername: event.author_username,
			userQuestion: question,
		});
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
