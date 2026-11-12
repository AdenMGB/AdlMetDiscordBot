#!/usr/bin/env node
/**
 * Listens on Discord Gateway for @mentions and POSTs them to the Worker.
 * HTTP interactions cannot receive MESSAGE_CREATE — this relay is required.
 *
 * Needs MESSAGE CONTENT intent enabled in Developer Portal → Bot.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = process.env.GATEWAY_RELAY_ENV ?? join(ROOT, ".gateway-relay.env");

function loadEnvFile(path) {
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

loadEnvFile(ENV_FILE);

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_BASE = (process.env.API_BASE ?? "https://api.adlmetbot.adenmgb.com").replace(/\/$/, "");
const RELAY_SECRET = process.env.GATEWAY_RELAY_SECRET ?? process.env.SETUP_SECRET ?? "";

const GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 15); // GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT

if (!DISCORD_BOT_TOKEN) {
	console.error(`Set DISCORD_BOT_TOKEN in ${ENV_FILE} or the environment.`);
	process.exit(1);
}
if (!RELAY_SECRET) {
	console.error(`Set GATEWAY_RELAY_SECRET or SETUP_SECRET in ${ENV_FILE}.`);
	process.exit(1);
}

let botUserId = null;
let sequence = null;
let heartbeatTimer = null;
const seenMessages = new Set();

function pruneSeen() {
	if (seenMessages.size > 500) {
		for (const id of [...seenMessages].slice(0, 250)) {
			seenMessages.delete(id);
		}
	}
}

async function forwardMention(message) {
	const payload = {
		channel_id: message.channel_id,
		guild_id: message.guild_id ?? undefined,
		message_id: message.id,
		author_id: message.author.id,
		author_username: message.author.username,
		content: message.content ?? "",
		bot_user_id: botUserId,
		referenced_message: message.referenced_message ?? null,
	};

	const response = await fetch(`${API_BASE}/discord/mention`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${RELAY_SECRET}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const body = await response.text();
		if (response.status === 401) {
			throw new Error(
				"Worker returned 401 Unauthorized — SETUP_SECRET or GATEWAY_RELAY_SECRET in .gateway-relay.env must match the same wrangler secret on production. Run: bash scripts/test-mention-auth.sh",
			);
		}
		throw new Error(`Worker /discord/mention ${response.status}: ${body.slice(0, 200)}`);
	}
}

function onMessageCreate(message) {
	if (!botUserId || !message?.author || message.author.bot) return;
	if (seenMessages.has(message.id)) return;
	seenMessages.add(message.id);
	pruneSeen();

	const mentioned =
		Array.isArray(message.mentions) &&
		message.mentions.some((user) => user.id === botUserId);
	if (!mentioned) return;

	console.log(
		`Mention from ${message.author.username} in #${message.channel_id} — forwarding to worker`,
	);

	forwardMention(message).catch((error) => {
		console.error("Forward failed:", error instanceof Error ? error.message : error);
	});
}

function connect() {
	const gateway = "wss://gateway.discord.gg/?v=10&encoding=json";
	const ws = new WebSocket(gateway);

	ws.on("open", () => {
		console.log("Gateway socket open");
	});

	ws.on("message", (data) => {
		let payload;
		try {
			payload = JSON.parse(data.toString());
		} catch {
			return;
		}

		if (payload.s !== null && payload.s !== undefined) {
			sequence = payload.s;
		}

		if (payload.op === 10) {
			const interval = payload.d.heartbeat_interval;
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			heartbeatTimer = setInterval(() => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ op: 1, d: sequence }));
				}
			}, interval);

			ws.send(
				JSON.stringify({
					op: 2,
					d: {
						token: DISCORD_BOT_TOKEN,
						intents: GATEWAY_INTENTS,
						properties: {
							os: "linux",
							browser: "metro-mate-relay",
							device: "metro-mate-relay",
						},
					},
				}),
			);
			return;
		}

		if (payload.op === 0 && payload.t === "READY") {
			botUserId = payload.d.user.id;
			console.log(`Ready as ${payload.d.user.username} (${botUserId})`);
			return;
		}

		if (payload.op === 0 && payload.t === "MESSAGE_CREATE") {
			onMessageCreate(payload.d);
		}
	});

	ws.on("close", (code, reason) => {
		console.warn(`Gateway closed (${code}) ${reason?.toString() ?? ""} — reconnecting in 5s`);
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		setTimeout(connect, 5000);
	});

	ws.on("error", (error) => {
		console.error("Gateway error:", error.message);
	});
}

console.log(`Metro Mate gateway relay → ${API_BASE}/discord/mention`);
console.log(`Auth secret loaded (${RELAY_SECRET.length} chars from GATEWAY_RELAY_SECRET or SETUP_SECRET)`);
connect();
