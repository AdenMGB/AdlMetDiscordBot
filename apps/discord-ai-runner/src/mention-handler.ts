import {
	buildMentionChatMessages,
	defaultMaxTokensForQuestion,
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
} from "./discord-rest";
import type { RunnerConfig } from "./env";

export type GatewayMessage = {
	id: string;
	channel_id: string;
	guild_id?: string;
	content?: string;
	author: { id: string; username: string; bot?: boolean };
	mentions?: Array<{ id: string }>;
	message_reference?: { message_id: string; channel_id?: string; guild_id?: string };
	referenced_message?: DiscordChannelMessage | null;
};

function isReplyToBot(message: GatewayMessage, botUserId: string): boolean {
	const ref = message.referenced_message;
	if (ref?.author?.id === botUserId) return true;
	return false;
}

function contentMentionsBot(content: string | undefined, botUserId: string): boolean {
	if (!content) return false;
	return (
		content.includes(`<@${botUserId}>`) || content.includes(`<@!${botUserId}>`)
	);
}

export function shouldRespondToMessage(message: GatewayMessage, botUserId: string): boolean {
	if (!message?.author || message.author.bot) return false;
	const mentioned =
		(Array.isArray(message.mentions) &&
			message.mentions.some((user) => user.id === botUserId)) ||
		contentMentionsBot(message.content, botUserId);
	if (mentioned) return true;
	return isReplyToBot(message, botUserId);
}

export class ThrottledEditor {
	private lastEditAt = 0;
	private lastSent = "";
	private pending: string | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly throttleMs: number,
		private readonly flush: (content: string) => Promise<void>,
	) {}

	async push(text: string): Promise<void> {
		this.pending = text;
		const now = Date.now();
		const elapsed = now - this.lastEditAt;
		if (elapsed >= this.throttleMs && text.length - this.lastSent.length >= 24) {
			await this.doEdit(text);
			return;
		}
		if (!this.timer) {
			const wait = Math.max(0, this.throttleMs - elapsed);
			this.timer = setTimeout(() => {
				this.timer = null;
				const next = this.pending;
				if (next && next !== this.lastSent) {
					void this.doEdit(next);
				}
			}, wait);
		}
	}

	async finish(text: string): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		await this.doEdit(text);
	}

	private async doEdit(text: string): Promise<void> {
		const body = truncateDiscordContent(text);
		if (body === this.lastSent) return;
		this.lastEditAt = Date.now();
		this.lastSent = body;
		await this.flush(body);
	}
}

export async function processGatewayMessage(
	config: RunnerConfig,
	botUserId: string,
	message: GatewayMessage,
): Promise<void> {
	const token = config.discordBotToken;
	const question = stripBotMention(message.content ?? "", botUserId);

	let thinkingId: string;
	try {
		const thinking = await postChannelReply(token, message.channel_id, {
			content: MENTION_THINKING_TEXT,
			replyToMessageId: message.id,
			guildId: message.guild_id,
		});
		thinkingId = thinking.id;
	} catch (error) {
		console.error("Could not post thinking placeholder:", error);
		return;
	}

	const finish = async (content: string) => {
		await editChannelMessage(token, message.channel_id, thinkingId, {
			content: truncateDiscordContent(content),
		});
	};

	const editor = new ThrottledEditor(config.editThrottleMs, async (content) => {
		await editChannelMessage(token, message.channel_id, thinkingId, { content });
	});

	try {
		const prior = await fetchChannelMessages(token, message.channel_id, {
			before: message.id,
			limit: config.contextMessageLimit,
		});
		const chronological = [...prior].reverse();

		const triggerMessage: DiscordChannelMessage = {
			id: message.id,
			content: message.content ?? "",
			author: message.author,
			referenced_message: message.referenced_message ?? null,
		};

		const chatMessages = buildMentionChatMessages({
			priorMessages: chronological,
			triggerMessage,
			botUserId,
			authorUsername: message.author.username,
			userQuestion: question,
			systemPrompt: config.systemPrompt,
		});

		const maxTokens = defaultMaxTokensForQuestion(question, config.nvidiaMaxTokens);

		const answer = await nvidiaChatCompletion(config.nvidiaApiKey, chatMessages, {
			model: config.nvidiaModel,
			maxTokens,
			timeoutMs: 120_000,
			onChunk: async (partial: string) => {
				await editor.push(partial);
			},
		});
		await editor.finish(answer);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "AI request failed";
		console.error("mention-handler:", msg);
		await finish(`Sorry — I could not answer that: ${msg}`);
	}
}
