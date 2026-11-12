import { NVIDIA_DEFAULT_MODEL } from "@metro-mate/chat-core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadDotEnv(path = join(APP_ROOT, ".env")): void {
	try {
		const text = readFileSync(path, "utf8");
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq <= 0) continue;
			const key = trimmed.slice(0, eq).trim();
			const value = trimmed.slice(eq + 1).trim();
			if (!process.env[key]) process.env[key] = value;
		}
	} catch {
		// optional file
	}
}

export function readConfig() {
	const token = process.env.DISCORD_BOT_TOKEN?.trim();
	const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
	if (!token) throw new Error("DISCORD_BOT_TOKEN is required (.env or environment)");
	if (!nvidiaKey) throw new Error("NVIDIA_API_KEY is required (.env or environment)");

	return {
		discordBotToken: token,
		nvidiaApiKey: nvidiaKey,
		nvidiaModel: (process.env.NVIDIA_MODEL ?? NVIDIA_DEFAULT_MODEL).trim(),
		contextMessageLimit: Math.min(
			100,
			Math.max(5, Number(process.env.CONTEXT_MESSAGE_LIMIT ?? "20") || 20),
		),
		nvidiaMaxTokens: Math.min(4096, Math.max(64, Number(process.env.NVIDIA_MAX_TOKENS ?? "700") || 700)),
		editThrottleMs: Math.min(5000, Math.max(400, Number(process.env.EDIT_THROTTLE_MS ?? "900") || 900)),
	};
}

export type RunnerConfig = ReturnType<typeof readConfig>;
