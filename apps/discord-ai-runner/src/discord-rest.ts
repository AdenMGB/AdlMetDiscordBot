import type { DiscordChannelMessage } from "@metro-mate/chat-core";

const DISCORD_API = "https://discord.com/api/v10";

async function discordFetch(
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

export async function fetchChannelMessages(
	token: string,
	channelId: string,
	options?: { limit?: number; before?: string },
): Promise<DiscordChannelMessage[]> {
	const limit = Math.min(Math.max(options?.limit ?? 5, 1), 100);
	const params = new URLSearchParams({ limit: String(limit) });
	if (options?.before) params.set("before", options.before);

	const response = await discordFetch(
		token,
		`/channels/${channelId}/messages?${params.toString()}`,
	);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Failed to fetch channel messages (${response.status}): ${body}`);
	}
	return (await response.json()) as DiscordChannelMessage[];
}

export async function postChannelReply(
	token: string,
	channelId: string,
	payload: {
		content?: string;
		replyToMessageId: string;
		guildId?: string;
	},
): Promise<{ id: string }> {
	const messageReference: Record<string, string | boolean> = {
		message_id: payload.replyToMessageId,
		fail_if_not_exists: false,
	};
	if (payload.guildId) {
		messageReference.channel_id = channelId;
		messageReference.guild_id = payload.guildId;
	}

	const response = await discordFetch(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify({
			content: payload.content,
			allowed_mentions: { parse: [] },
			message_reference: messageReference,
		}),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Failed to post channel message (${response.status}): ${body}`);
	}
	return (await response.json()) as { id: string };
}

export async function editChannelMessage(
	token: string,
	channelId: string,
	messageId: string,
	data: { content?: string },
): Promise<void> {
	const response = await discordFetch(token, `/channels/${channelId}/messages/${messageId}`, {
		method: "PATCH",
		body: JSON.stringify(data),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Failed to edit channel message (${response.status}): ${body}`);
	}
}
