/** Guild slash command definitions (registered via `pnpm run register-commands`). */
export const GUILD_COMMANDS = [
	{
		name: "health",
		description: "Check whether Metro Mate and Discord are reachable",
		type: 1,
	},
	{
		name: "post-verify",
		description: "Post the verification embed in #rules",
		type: 1,
		default_member_permissions: "32", // Manage Server
	},
] as const;

export type SlashCommandName = (typeof GUILD_COMMANDS)[number]["name"];
