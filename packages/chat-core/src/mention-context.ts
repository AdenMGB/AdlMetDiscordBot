import type { ChatMessage } from "./nvidia-chat";

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
	"If unsure, say what you are unsure about. English only. Under 1800 characters.",
].join(" ");

export type BuildChatContextOptions = {
	priorMessages: DiscordChannelMessage[];
	triggerMessage: DiscordChannelMessage;
	botUserId: string;
	authorUsername: string;
	userQuestion: string;
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
	const { priorMessages, triggerMessage, botUserId, authorUsername, userQuestion } = options;

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

	return [
		{ role: "system", content: MENTION_SYSTEM_PROMPT },
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
