import {
	InteractionResponseFlags,
	InteractionResponseType,
	InteractionType,
	verifyKey,
} from "discord-interactions";
import { GUILD_COMMANDS } from "./commands";
import {
	DISRUPTIONS_SUBSCRIBE_BUTTON_ID,
	VERIFY_BUTTON_ID,
	VERIFY_EMBED,
} from "./config";
import { handleAlertsAutocomplete, handleAlertsSlashCommand } from "./alerts-command";
import {
	addRole,
	fetchBotIdentity,
	postChannelMessage,
	postVerifyMessage,
	registerGuildCommands,
} from "./discord-api";
import { pushNewRailAlerts } from "./transit/service-alerts";
import type { WorkerEnv } from "./env.d";
import { canManageServer } from "./permissions";
import {
	handleLiveTrainsAutocomplete,
	handleLiveTrainsCommand,
} from "./live-command";
import {
	handleTimetableAutocompleteAsync,
	handleTimetableCommand,
} from "./timetable-command";

type InteractionOption = {
	name: string;
	type: number;
	value?: string | number;
	focused?: boolean;
};

type GuildInteraction = {
	type: number;
	token?: string;
	guild_id?: string;
	data?: {
		custom_id?: string;
		name?: string;
		options?: InteractionOption[];
	};
	member?: { user?: { id: string }; roles?: string[]; permissions?: string };
	user?: { id: string };
};

async function verifyDiscordRequest(
	request: Request,
	env: WorkerEnv,
): Promise<{ valid: boolean; body: string }> {
	const signature = request.headers.get("X-Signature-Ed25519") ?? "";
	const timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
	const body = await request.text();
	const isValid = await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
	return { valid: isValid, body };
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function ephemeral(content: string) {
	return json({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: { content, flags: InteractionResponseFlags.EPHEMERAL },
	});
}

function isDiscordInteractionPath(pathname: string): boolean {
	return pathname === "/" || pathname === "/interactions";
}

function requireSetupSecret(request: Request, env: WorkerEnv): boolean {
	const secret = request.headers.get("Authorization")?.replace("Bearer ", "");
	return Boolean(env.SETUP_SECRET && secret === env.SETUP_SECRET);
}

function requireAlertsCronSecret(request: Request, env: WorkerEnv): boolean {
	const secret = request.headers.get("Authorization")?.replace("Bearer ", "");
	const expected = env.ALERTS_CRON_SECRET || env.SETUP_SECRET;
	return Boolean(expected && secret === expected);
}

async function handleSlashCommand(
	interaction: GuildInteraction,
	env: WorkerEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const name = interaction.data?.name;

	if (name === "timetable") {
		return handleTimetableCommand(interaction, env.DB);
	}

	if (name === "live-trains") {
		return handleLiveTrainsCommand(
			interaction,
			env.DB,
			env.DISCORD_APPLICATION_ID,
			ctx,
		);
	}

	if (name === "alerts") {
		return handleAlertsSlashCommand(interaction, "alerts");
	}

	if (name === "disruption") {
		return handleAlertsSlashCommand(interaction, "disruption");
	}

	if (name === "health") {
		const checks: string[] = ["Worker: **online**"];
		try {
			const bot = await fetchBotIdentity(env.DISCORD_BOT_TOKEN);
			checks.push(`Discord API: **ok** (as \`${bot.username}\`)`);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Discord unreachable";
			checks.push(`Discord API: **failed** — ${message}`);
		}
		checks.push(`Rules channel: <#${env.VERIFY_CHANNEL_ID}>`);
		return ephemeral(["**Metro Mate health**", ...checks].join("\n"));
	}

	if (name === "post-verify") {
		if (!canManageServer(interaction.member?.permissions)) {
			return ephemeral("You need **Manage Server** to run this command.");
		}
		try {
			const message = await postVerifyMessage(
				env.DISCORD_BOT_TOKEN,
				env.VERIFY_CHANNEL_ID,
				VERIFY_EMBED,
				VERIFY_BUTTON_ID,
			);
			return ephemeral(
				`Posted verification embed in <#${env.VERIFY_CHANNEL_ID}> (message \`${message.id}\`).`,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			return ephemeral(`Could not post embed: ${message}`);
		}
	}

	return ephemeral("Unknown slash command.");
}

async function handleDisruptionsSubscribeButton(
	interaction: GuildInteraction,
	env: WorkerEnv,
): Promise<Response> {
	const memberUserId = interaction.member?.user?.id ?? interaction.user?.id;
	if (!memberUserId) {
		return ephemeral("Could not resolve your user account.");
	}

	if (!env.DISRUPTIONS_ROLE_ID) {
		return ephemeral("Disruptions role is not configured on the bot.");
	}

	const roles = interaction.member?.roles ?? [];
	if (roles.includes(env.DISRUPTIONS_ROLE_ID)) {
		return ephemeral(
			"You already have **Disruptions Alerts** — you'll be pinged when new train disruptions are posted.",
		);
	}

	const guildId = interaction.guild_id ?? env.GUILD_ID;
	if (!guildId) {
		return ephemeral("Could not resolve this server. Ask a moderator for help.");
	}

	try {
		await addRole(
			env.DISCORD_BOT_TOKEN,
			guildId,
			memberUserId,
			env.DISRUPTIONS_ROLE_ID,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Role assignment failed";
		const hint = message.includes("(403)")
			? " Drag **Metro Mate** above **Disruptions Alerts** in Server Settings → Roles."
			: "";
		return ephemeral(`Could not assign the role: ${message}.${hint}`);
	}

	return ephemeral(
		"Done — you have **Disruptions Alerts** and will be pinged for future train disruptions. 🚆",
	);
}

async function handleVerifyButton(
	interaction: GuildInteraction,
	env: WorkerEnv,
): Promise<Response> {
	const memberUserId = interaction.member?.user?.id ?? interaction.user?.id;
	if (!memberUserId) {
		return ephemeral("Could not resolve your user account.");
	}

	const roles = interaction.member?.roles ?? [];
	if (roles.includes(env.VERIFIED_ROLE_ID)) {
		return ephemeral("You’re already verified — enjoy the server! 🚋");
	}

	const guildId = interaction.guild_id ?? env.GUILD_ID;
	if (!guildId) {
		return ephemeral("Could not resolve this server. Ask a moderator for help.");
	}

	try {
		await addRole(env.DISCORD_BOT_TOKEN, guildId, memberUserId, env.VERIFIED_ROLE_ID);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Role assignment failed";
		const hint = message.includes("(404)")
			? " Check Cloudflare secrets `GUILD_ID` / `VERIFIED_ROLE_ID` and that the bot role is **above** Verified."
			: message.includes("(403)")
				? " Drag **Metro Mate** above **Verified** in Server Settings → Roles."
				: "";
		return ephemeral(`Verification failed: ${message}.${hint} Ask a moderator if this persists.`);
	}

	return ephemeral(
		"Welcome aboard! You’re verified and can now access the rest of **Adelaide Public Transport**. 🚌🚆",
	);
}

export default {
	async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/health") {
			return json({
				ok: true,
				service: "metro-mate",
				applicationId: env.DISCORD_APPLICATION_ID,
			});
		}

		if (request.method === "POST" && url.pathname === "/setup/verify-embed") {
			if (!requireSetupSecret(request, env)) {
				return json({ error: "Unauthorized" }, 401);
			}
			try {
				const message = await postVerifyMessage(
					env.DISCORD_BOT_TOKEN,
					env.VERIFY_CHANNEL_ID,
					VERIFY_EMBED,
					VERIFY_BUTTON_ID,
				);
				return json({
					ok: true,
					messageId: message.id,
					channelId: env.VERIFY_CHANNEL_ID,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				return json({ error: message }, 500);
			}
		}

		if (request.method === "POST" && url.pathname === "/alerts/push") {
			if (!requireAlertsCronSecret(request, env)) {
				return json({ error: "Unauthorized" }, 401);
			}
			if (!env.DB) {
				return json({ error: "D1 not configured" }, 500);
			}
			if (!env.ALERTS_CHANNEL_ID) {
				return json({ error: "ALERTS_CHANNEL_ID not set" }, 500);
			}
			try {
				const roleId = env.DISRUPTIONS_ROLE_ID ?? "";
				const result = await pushNewRailAlerts(
					env.DB,
					async (payload) => {
						await postChannelMessage(env.DISCORD_BOT_TOKEN, env.ALERTS_CHANNEL_ID, {
							content: payload.content,
							embeds: payload.embeds,
							components: payload.components,
							mentionRoleIds: roleId ? [roleId] : [],
						});
					},
					roleId,
				);
				return json({ ok: true, ...result });
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				return json({ error: message }, 500);
			}
		}

		if (request.method === "POST" && url.pathname === "/setup/register-commands") {
			if (!requireSetupSecret(request, env)) {
				return json({ error: "Unauthorized" }, 401);
			}
			try {
				await registerGuildCommands(
					env.DISCORD_BOT_TOKEN,
					env.DISCORD_APPLICATION_ID,
					env.GUILD_ID,
					GUILD_COMMANDS,
				);
				return json({ ok: true, commands: GUILD_COMMANDS.map((c) => c.name) });
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				return json({ error: message }, 500);
			}
		}

		if (request.method === "POST" && isDiscordInteractionPath(url.pathname)) {
			const { valid, body } = await verifyDiscordRequest(request, env);
			if (!valid) {
				return new Response("Invalid request signature", { status: 401 });
			}

			const interaction = JSON.parse(body) as GuildInteraction;

			if (interaction.type === InteractionType.PING) {
				return json({ type: InteractionResponseType.PONG });
			}

			if (interaction.type === InteractionType.APPLICATION_COMMAND) {
				return handleSlashCommand(interaction, env, ctx);
			}

			if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
				if (interaction.data?.name === "live-trains") {
					return handleLiveTrainsAutocomplete(interaction);
				}
				if (
					interaction.data?.name === "alerts" ||
					interaction.data?.name === "disruption"
				) {
					return handleAlertsAutocomplete(interaction);
				}
				if (interaction.data?.name === "timetable") {
					return handleTimetableAutocompleteAsync(interaction, env.DB);
				}
				return json({
					type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					data: { choices: [] },
				});
			}

			if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
				const customId = interaction.data?.custom_id;
				if (customId === DISRUPTIONS_SUBSCRIBE_BUTTON_ID) {
					return handleDisruptionsSubscribeButton(interaction, env);
				}
				if (customId === VERIFY_BUTTON_ID) {
					return handleVerifyButton(interaction, env);
				}
				return ephemeral("Unknown button.");
			}

			return json({ error: "Unhandled interaction type" }, 400);
		}

		if (request.method === "GET" && url.pathname === "/") {
			return json({
				service: "metro-mate",
				hint: "Discord interactions POST here; GET /health for status.",
				slashCommands: GUILD_COMMANDS.map((c) => c.name),
			});
		}

		return new Response("Not found", { status: 404 });
	},
};
