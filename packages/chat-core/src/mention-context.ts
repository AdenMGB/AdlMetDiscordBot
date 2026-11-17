import type { ChatMessage } from "./nvidia-chat";
import { replyLengthHint, wantsLongReply } from "./reply-length";

export type DiscordAuthor = {
	id: string;
	username: string;
	bot?: boolean;
};

export type DiscordChannelMessage = {
	id: string;
	content: string;
	author: DiscordAuthor;
	referenced_message?: DiscordChannelMessage | null;
};

export const MENTION_SYSTEM_PROMPT = [
	"You are Metro Mate in the Adelaide Public Transport Discord — helpful, relaxed, a bit witty.",
	"Talk like a mate who knows the network, not a corporate FAQ. Light humour is fine; stay kind and never sarcastic or condescending.",
	"Answer trains, trams, buses, stations, fares, and getting around when it comes up naturally in the chat.",
	"Use recent messages and reply quotes when they help. Chat can be off-topic — roll with it unless they want transport info.",
	"Do not invent live times, delays, or timetables. If they need exact departures or disruption status and you cannot know, say so in plain language — only mention bot slash commands as an optional extra, never as the main answer or a lecture.",
	"If unsure, say what you are unsure about.",
	"Default: terse — 1–3 short sentences. No preamble or sign-off.",
	"English only. Hard cap 1800 characters.",
].join(" ");

/** @deprecated CHAT_PERSONA=sassy — kept only so old .env values fall back to helpful default. */
export const SASSY_MENTION_SYSTEM_PROMPT = MENTION_SYSTEM_PROMPT;

export type ChatPersonaId = "default" | "sassy";

export function resolveChatPersona(_persona?: string): string {
	return MENTION_SYSTEM_PROMPT;
}

export type BuildChatContextOptions = {
	priorMessages: DiscordChannelMessage[];
	triggerMessage: DiscordChannelMessage;
	botUserId: string;
	authorUsername: string;
	userQuestion: string;
	/** Overrides default Metro Mate system prompt (e.g. CHAT_PERSONA=sassy). */
	systemPrompt?: string;
};

function labelAuthor(author: DiscordAuthor, botUserId: string): string {
	if (author.bot || author.id === botUserId) return "Metro Mate";
	return author.username;
}

function formatMessageLine(message: DiscordChannelMessage, botUserId: string): string {
	const who = labelAuthor(message.author, botUserId);
	const body = message.content.trim().slice(0, 800);
	if (!body) return "";
	let line = `${who}: ${body}`;
	const ref = message.referenced_message;
	if (ref?.content?.trim()) {
		const refWho = labelAuthor(ref.author, botUserId);
		line += ` (replying to ${refWho}: «${ref.content.trim().slice(0, 200)}»)`;
	}
	return line;
}

/** Builds multi-turn chat when recent history alternates user/assistant with the bot. */
export function buildMentionChatMessages(options: BuildChatContextOptions): ChatMessage[] {
	const {
		priorMessages,
		triggerMessage,
		botUserId,
		authorUsername,
		userQuestion,
		systemPrompt = MENTION_SYSTEM_PROMPT,
	} = options;

	const transcriptLines: string[] = [];
	for (const message of priorMessages) {
		const line = formatMessageLine(message, botUserId);
		if (line) transcriptLines.push(line);
	}

	const triggerLine = formatMessageLine(triggerMessage, botUserId);
	if (triggerLine) transcriptLines.push(triggerLine);

	const recentBlock =
		transcriptLines.length > 0 ?
			`Recent channel messages (oldest first):\n${transcriptLines.join("\n")}`
		:	"(No prior channel context.)";

	const question = userQuestion.trim() || "(No text besides the mention or reply.)";

	const replyHint =
		triggerMessage.referenced_message ?
			`\nThe user used Discord's reply feature; treat the quoted thread as primary context.`
		:	"";

	const lengthHint = replyLengthHint(wantsLongReply(question));

	return [
		{ role: "system", content: `${systemPrompt}\n\n${lengthHint}` },
		{
			role: "user",
			content: `${recentBlock}${replyHint}\n\n${authorUsername} asked:\n${question}`,
		},
	];
}

/** @deprecated Use buildMentionChatMessages with full trigger message */
export function buildMentionChatMessagesLegacy(
	priorMessages: DiscordChannelMessage[],
	authorUsername: string,
	userQuestion: string,
	botUserId: string,
): ChatMessage[] {
	const syntheticTrigger: DiscordChannelMessage = {
		id: "trigger",
		content: userQuestion,
		author: { id: "trigger-user", username: authorUsername },
	};
	return buildMentionChatMessages({
		priorMessages,
		triggerMessage: syntheticTrigger,
		botUserId,
		authorUsername,
		userQuestion,
	});
}
