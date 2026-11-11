const DISCORD_API = "https://discord.com/api/v10";

export async function discordFetch(
	token: string,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	return fetch(`${DISCORD_API}${path}`, {
		...init,
		headers: {
			Authorization: `Bot ${token}`,
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
}

export async function addRole(
	token: string,
	guildId: string,
	userId: string,
	roleId: string,
): Promise<void> {
	const response = await discordFetch(
		token,
		`/guilds/${guildId}/members/${userId}/roles/${roleId}`,
		{ method: "PUT" },
	);
	if (!response.ok && response.status !== 204) {
		const body = await response.text();
		throw new Error(`Failed to add role (${response.status}): ${body}`);
	}
}

export async function postVerifyMessage(
	token: string,
	channelId: string,
	embed: (typeof import("./config"))["VERIFY_EMBED"],
	buttonCustomId: string,
): Promise<{ id: string }> {
	const payload = {
		embeds: [embed],
		components: [
			{
				type: 1,
				components: [
					{
						type: 2,
						style: 3,
						label: "Verify",
						custom_id: buttonCustomId,
					},
				],
			},
		],
	};
	const response = await discordFetch(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Failed to post verify message (${response.status}): ${body}`);
	}
	return (await response.json()) as { id: string };
}

export async function registerGuildCommands(
	token: string,
	applicationId: string,
	guildId: string,
	commands: readonly Record<string, unknown>[],
): Promise<void> {
	const response = await discordFetch(
		token,
		`/applications/${applicationId}/guilds/${guildId}/commands`,
		{
			method: "PUT",
			body: JSON.stringify(commands),
		},
	);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Failed to register commands (${response.status}): ${body}`);
	}
}

export async function postChannelMessage(
	token: string,
	channelId: string,
	payload: {
		content?: string;
		embeds?: unknown[];
		components?: unknown[];
		allowed_mentions?: { parse?: string[]; roles?: string[] };
		mentionRoleIds?: string[];
	},
): Promise<{ id: string }> {
	const { mentionRoleIds, ...rest } = payload;
	const response = await discordFetch(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify({
			...rest,
			allowed_mentions: rest.allowed_mentions ?? {
				parse: [],
				roles: mentionRoleIds ?? [],
			},
		}),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Failed to post channel message (${response.status}): ${body}`);
	}
	return (await response.json()) as { id: string };
}

export async function editInteractionResponse(
	applicationId: string,
	interactionToken: string,
	data: {
		content?: string;
		embeds?: unknown[];
		components?: unknown[];
		flags?: number;
	},
): Promise<void> {
	const response = await fetch(
		`${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		},
	);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Failed to edit interaction (${response.status}): ${body}`);
	}
}

export async function fetchBotIdentity(
	token: string,
): Promise<{ id: string; username: string }> {
	const response = await discordFetch(token, `/users/@me`);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Discord API unhealthy (${response.status}): ${body}`);
	}
	return (await response.json()) as { id: string; username: string };
}
