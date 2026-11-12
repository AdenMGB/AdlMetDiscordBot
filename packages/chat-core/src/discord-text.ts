export const MENTION_THINKING_TEXT = "_Metro Mate is thinking…_";

export function stripBotMention(content: string, botUserId: string): string {
	return content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
}

export function truncateDiscordContent(text: string, max = 2000): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}
