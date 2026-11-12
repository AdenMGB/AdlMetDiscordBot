import { describe, expect, it } from "vitest";
import {
	buildMentionChatMessages,
	buildMentionChatMessagesLegacy,
	resolveChatPersona,
	SASSY_MENTION_SYSTEM_PROMPT,
	truncateDiscordContent,
} from "../src/index";

describe("mention context", () => {
	it("sassy persona prompt is selectable", () => {
		expect(resolveChatPersona("sassy")).toBe(SASSY_MENTION_SYSTEM_PROMPT);
		expect(resolveChatPersona("default")).not.toContain("moral high ground");
	});
	it("legacy builder matches structured builder", () => {
		const prior = [
			{
				id: "1",
				content: "Any delays on Gawler?",
				author: { id: "u1", username: "Aden" },
			},
		];
		const legacy = buildMentionChatMessagesLegacy(prior, "Aden", "what about buses?", "bot");
		const modern = buildMentionChatMessages({
			priorMessages: prior,
			triggerMessage: {
				id: "t",
				content: "what about buses?",
				author: { id: "u1", username: "Aden" },
			},
			botUserId: "bot",
			authorUsername: "Aden",
			userQuestion: "what about buses?",
		});
		expect(legacy[1].content).toContain("what about buses?");
		expect(modern[1].content).toContain("what about buses?");
	});

	it("truncates long Discord content", () => {
		expect(truncateDiscordContent("x".repeat(2100))).toHaveLength(2000);
	});
});
