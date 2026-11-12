import {
	buildMentionChatMessages,
	stripBotMention,
} from "@metro-mate/chat-core";
import { shouldRespondToMessage, type GatewayMessage } from "../src/mention-handler";
import { describe, expect, it } from "vitest";

const BOT = "1569963528171815023";

describe("discord-ai-runner triggers", () => {
	it("responds when mention is only in content (no mentions array)", () => {
		const msg: GatewayMessage = {
			id: "0",
			channel_id: "c",
			content: `<@${BOT}> hello`,
			author: { id: "u", username: "Aden" },
		};
		expect(shouldRespondToMessage(msg, BOT)).toBe(true);
	});

	it("responds to @mention", () => {
		const msg: GatewayMessage = {
			id: "1",
			channel_id: "c",
			content: `<@${BOT}> hello`,
			author: { id: "u", username: "Aden" },
			mentions: [{ id: BOT }],
		};
		expect(shouldRespondToMessage(msg, BOT)).toBe(true);
	});

	it("responds to reply to bot without mention", () => {
		const msg: GatewayMessage = {
			id: "2",
			channel_id: "c",
			content: "follow-up question",
			author: { id: "u", username: "Aden" },
			referenced_message: {
				id: "b",
				content: "prior answer",
				author: { id: BOT, username: "Metro Mate", bot: true },
			},
		};
		expect(shouldRespondToMessage(msg, BOT)).toBe(true);
	});

	it("includes reply context in prompt", () => {
		const messages = buildMentionChatMessages({
			priorMessages: [],
			triggerMessage: {
				id: "3",
				content: "more detail?",
				author: { id: "u", username: "Aden" },
				referenced_message: {
					id: "b",
					content: "Gawler line runs every 15 min off-peak",
					author: { id: BOT, username: "Metro Mate", bot: true },
				},
			},
			botUserId: BOT,
			authorUsername: "Aden",
			userQuestion: "more detail?",
		});
		expect(messages[1].content).toContain("reply feature");
		expect(messages[1].content).toContain("Gawler");
	});

	it("strips mention", () => {
		expect(stripBotMention(`<@${BOT}> when?`, BOT)).toBe("when?");
	});
});
