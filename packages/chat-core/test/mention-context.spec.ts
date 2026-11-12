import { describe, expect, it } from "vitest";
import {
	buildMentionChatMessages,
	buildMentionChatMessagesLegacy,
	truncateDiscordContent,
} from "../src/index";

describe("mention context", () => {
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
