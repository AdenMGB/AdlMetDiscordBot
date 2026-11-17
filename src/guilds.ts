import type { WorkerEnv } from "./env.d";

/** Comma-separated extra server IDs that receive slash commands (no verify/alerts setup). */
export function parseExtraCommandGuildIds(raw: string | undefined): string[] {
	if (!raw?.trim()) {
		return [];
	}
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const part of raw.split(",")) {
		const id = part.trim();
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

/** All guild IDs where slash commands should be registered. */
export function commandRegistrationGuildIds(env: WorkerEnv): string[] {
	const seen = new Set<string>();
	const ids: string[] = [];
	const add = (id: string | undefined) => {
		const trimmed = id?.trim();
		if (!trimmed || seen.has(trimmed)) {
			return;
		}
		seen.add(trimmed);
		ids.push(trimmed);
	};
	add(env.GUILD_ID);
	for (const id of parseExtraCommandGuildIds(env.COMMAND_GUILD_IDS)) {
		add(id);
	}
	return ids;
}