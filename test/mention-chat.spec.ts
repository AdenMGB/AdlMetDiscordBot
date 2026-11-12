import { describe, expect, it } from "vitest";
import {
	buildMentionChatMessages,
	stripBotMention,
	truncateDiscordContent,
} from "../src/mention-chat";
import type { DiscordChannelMessage } from "../src/discord-api";

describe("mention chat", () => {
	it("strips bot mention from content", () => {
		expect(stripBotMention("<@1569963528171815023> when is the next train?", "1569963528171815023")).toBe(
			"when is the next train?",
		);
	});

	it("builds chat messages with prior context", () => {
		const prior: DiscordChannelMessage[] = [
			{
				id: "1",
				content: "Any delays on Gawler?",
				author: { id: "u1", username: "Aden" },
			},
			{
				id: "2",
				content: "Check /live-trains",
				author: { id: "bot", username: "Metro Mate", bot: true },
			},
		];
		const messages = buildMentionChatMessages({
			priorMessages: prior,
			triggerMessage: {
				id: "3",
				content: "what about buses?",
				author: { id: "u1", username: "Aden" },
			},
			botUserId: "1569963528171815023",
			authorUsername: "Aden",
			userQuestion: "what about buses?",
		});
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe("system");
		expect(messages[1].content).toContain("Aden:");
		expect(messages[1].content).toContain("what about buses?");
	});

	it("truncates long Discord content", () => {
		expect(truncateDiscordContent("x".repeat(2100))).toHaveLength(2000);
	});
});
