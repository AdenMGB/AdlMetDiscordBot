import WebSocket from "ws";
import type { RunnerConfig } from "./env";
import { type GatewayMessage, processGatewayMessage, shouldRespondToMessage } from "./mention-handler";

const GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 15); // GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT

export type GatewayController = {
	stop: () => void;
};

export function startDiscordGateway(
	config: RunnerConfig,
	botUserId: string,
	onReady?: (username: string) => void,
): GatewayController {
	let sequence: number | null = null;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let ws: WebSocket | null = null;
	let stopped = false;
	const seenMessages = new Set<string>();
	const inFlight = new Set<string>();

	function pruneSeen() {
		if (seenMessages.size > 800) {
			for (const id of [...seenMessages].slice(0, 400)) {
				seenMessages.delete(id);
			}
		}
	}

	function onMessageCreate(message: GatewayMessage) {
		if (!shouldRespondToMessage(message, botUserId)) return;
		if (seenMessages.has(message.id) || inFlight.has(message.id)) return;
		seenMessages.add(message.id);
		pruneSeen();
		inFlight.add(message.id);

		const mode =
			message.mentions?.some((u: { id: string }) => u.id === botUserId) ?
				"@mention"
			:	"reply-thread";
		console.log(
			`${mode} from ${message.author.username} in #${message.channel_id} — NVIDIA stream`,
		);

		processGatewayMessage(config, botUserId, message)
			.catch((error: unknown) => {
				console.error("processGatewayMessage failed:", error);
			})
			.finally(() => {
				inFlight.delete(message.id);
			});
	}

	function connect() {
		if (stopped) return;
		const gateway = "wss://gateway.discord.gg/?v=10&encoding=json";
		ws = new WebSocket(gateway);

		ws.on("open", () => {
			console.log("Discord Gateway socket open");
		});

		ws.on("message", (data) => {
			let payload: { op: number; t?: string; s?: number | null; d?: unknown };
			try {
				payload = JSON.parse(data.toString());
			} catch {
				return;
			}

			if (payload.s !== null && payload.s !== undefined) {
				sequence = payload.s;
			}

			if (payload.op === 10) {
				const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
				if (heartbeatTimer) clearInterval(heartbeatTimer);
				heartbeatTimer = setInterval(() => {
					if (ws?.readyState === WebSocket.OPEN) {
						ws.send(JSON.stringify({ op: 1, d: sequence }));
					}
				}, interval);

				const socket = ws;
				if (!socket) return;
				socket.send(
					JSON.stringify({
						op: 2,
						d: {
							token: config.discordBotToken,
							intents: GATEWAY_INTENTS,
							properties: {
								os: "linux",
								browser: "discord-ai-runner",
								device: "discord-ai-runner",
							},
						},
					}),
				);
				return;
			}

			if (payload.op === 0 && payload.t === "READY") {
				const user = (payload.d as { user: { id: string; username: string } }).user;
				onReady?.(user.username);
				console.log(`Ready as ${user.username} (${user.id})`);
				return;
			}

			if (payload.op === 0 && payload.t === "MESSAGE_CREATE") {
				const message = payload.d as GatewayMessage;
				if (
					message?.author &&
					!message.author.bot &&
					(message.mentions?.length ||
						message.content?.includes("<@") ||
						message.referenced_message)
				) {
					console.log(
						`MESSAGE_CREATE #${message.channel_id} from ${message.author.username}`,
					);
				}
				onMessageCreate(message);
			}
		});

		ws.on("close", (code, reason) => {
			console.warn(
				`Gateway closed (${code}) ${reason?.toString() ?? ""} — reconnecting in 5s`,
			);
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			if (!stopped) setTimeout(connect, 5000);
		});

		ws.on("error", (error) => {
			console.error("Gateway error:", error.message);
		});
	}

	connect();

	return {
		stop: () => {
			stopped = true;
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			ws?.close();
		},
	};
}
