import {
	InteractionResponseFlags,
	InteractionResponseType,
	InteractionType,
	verifyKey,
} from "discord-interactions";
import { GUILD_COMMANDS } from "./commands";
import { VERIFY_BUTTON_ID, VERIFY_EMBED } from "./config";
import {
	addRole,
	fetchBotIdentity,
	postVerifyMessage,
	registerGuildCommands,
} from "./discord-api";
import type { WorkerEnv } from "./env.d";
import { canManageServer } from "./permissions";

type GuildInteraction = {
	type: number;
	guild_id?: string;
	data?: { custom_id?: string; name?: string };
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

async function handleSlashCommand(
	interaction: GuildInteraction,
	env: WorkerEnv,
): Promise<Response> {
	const name = interaction.data?.name;

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
	async fetch(request: Request, env: WorkerEnv): Promise<Response> {
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
				return handleSlashCommand(interaction, env);
			}

			if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
				if (interaction.data?.custom_id !== VERIFY_BUTTON_ID) {
					return ephemeral("Unknown button.");
				}
				return handleVerifyButton(interaction, env);
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
