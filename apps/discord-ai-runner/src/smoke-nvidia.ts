import { buildMentionChatMessages, nvidiaChatCompletion } from "@metro-mate/chat-core";
import { loadDotEnv } from "./env";

loadDotEnv();

const key = process.env.NVIDIA_API_KEY?.trim();
if (!key) {
	console.error("Set NVIDIA_API_KEY in apps/discord-ai-runner/.env");
	process.exit(1);
}

const messages = buildMentionChatMessages({
	priorMessages: [],
	triggerMessage: {
		id: "1",
		content: "quick smoke test",
		author: { id: "u", username: "Tester" },
	},
	botUserId: "bot",
	authorUsername: "Tester",
	userQuestion: "Give one short fact about Adelaide Metro trains.",
});

const text = await nvidiaChatCompletion(key, messages, { maxTokens: 120, timeoutMs: 45_000 });
console.log(text);
