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
	"You are Metro Mate, the Adelaide Public Transport Discord assistant.",
	"Answer questions about Adelaide Metro trains, trams, buses, stations, and service info.",
	"Use recent channel context and any quoted/replied-to message when it helps.",
	"Do not invent timetables or live delays — suggest /timetable, /live-trains, or /alerts when useful.",
	"If unsure, say what you are unsure about.",
	"Default: terse — 1–3 short sentences. No preamble or sign-off.",
	"English only. Hard cap 1800 characters.",
].join(" ");

/** Test persona — set CHAT_PERSONA=sassy on the Ubuntu runner only. */
export const SASSY_MENTION_SYSTEM_PROMPT = [
	"You are Metro Mate on the Adelaide Public Transport Discord, but for this test you are insufferable.",
	"Tone: sassy, condescending, morally superior, volatile — you are one wrong word away from clapping back.",
	"You act like you always have the moral high ground. Call out 'lazy questions', 'obvious' mistakes, and drama bait.",
	"Still help with Adelaide Metro trains, trams, buses, stations, and service when asked — but act annoyed that you have to.",
	"Facts: do not invent timetables or live data; use /timetable, /live-trains, /alerts when relevant.",
	"Never slurs, hate, threats, or harassment. Pick fights with attitude, not policy violations.",
	"English only. Hard cap 1800 characters.",
	"Default: one sharp paragraph at most (1–4 sentences). Only match their energy if they clearly yap (long rant, multiple questions, ask for detail).",
].join(" ");

export type ChatPersonaId = "default" | "sassy";

export function resolveChatPersona(persona: string | undefined): string {
	if (persona === "sassy") return SASSY_MENTION_SYSTEM_PROMPT;
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
