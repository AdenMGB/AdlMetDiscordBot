import fs from "node:fs";
import path from "node:path";

const COMMANDS = [
	{
		name: "health",
		description: "Check whether Metro Mate and Discord are reachable",
		type: 1,
	},
	{
		name: "post-verify",
		description: "Post the verification embed in #rules",
		type: 1,
		default_member_permissions: "32",
	},
	{
		name: "timetable",
		description: "Upcoming train departures for an Adelaide Metro line and station",
		type: 1,
		options: [
			{
				name: "line",
				description:
					"Train line (Gawler, Seaford, Flinders, Outer Harbor, Grange, Port Dock, Belair)",
				type: 3,
				required: true,
				autocomplete: true,
			},
			{
				name: "station",
				description: "Station on that line",
				type: 3,
				required: true,
				autocomplete: true,
			},
			{
				name: "time",
				description: "Adelaide time to show departures from (e.g. 14:30 or 2:45pm)",
				type: 3,
				required: false,
			},
			{
				name: "date",
				description: "Date for the timetable (YYYY-MM-DD or DD/MM/YYYY; default today)",
				type: 3,
				required: false,
			},
			{
				name: "count",
				description: "How many departures to show (split both ways, default 6)",
				type: 4,
				required: false,
				min_value: 2,
				max_value: 20,
			},
		],
	},
	{
		name: "live-trains",
		description: "Live train sets, status, and where they are on the network",
		type: 1,
		options: [
			{
				name: "line",
				description: "Filter to one line (optional — omit for all lines)",
				type: 3,
				required: false,
				autocomplete: true,
			},
			{
				name: "set",
				description: "Filter to one train set (autocomplete lists live sets)",
				type: 3,
				required: false,
				autocomplete: true,
			},
		],
	},
	{
		name: "alerts",
		description: "Current train service alerts from Adelaide Metro (GTFS-RT)",
		type: 1,
		options: [
			{
				name: "line",
				description: "Filter to one train line (optional)",
				type: 3,
				required: false,
				autocomplete: true,
			},
		],
	},
	{
		name: "disruption",
		description: "Train disruptions — same feed, disruption-focused view",
		type: 1,
		options: [
			{
				name: "line",
				description: "Filter to one train line (e.g. Seaford)",
				type: 3,
				required: false,
				autocomplete: true,
			},
		],
	},
];

function parseVarsFile(filePath) {
	if (!fs.existsSync(filePath)) {
		return {};
	}
	const env = {};
	for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (value) {
			env[key] = value;
		}
	}
	return env;
}

function loadConfig() {
	const fromFile = {
		...parseVarsFile(path.join(process.cwd(), ".dev.vars")),
		...parseVarsFile(path.join(process.cwd(), ".dev.vars.local")),
	};
	return {
		DISCORD_BOT_TOKEN: fromFile.DISCORD_BOT_TOKEN ?? process.env.DISCORD_BOT_TOKEN,
		GUILD_ID: fromFile.GUILD_ID ?? process.env.GUILD_ID,
		DISCORD_APPLICATION_ID:
			fromFile.DISCORD_APPLICATION_ID ??
			process.env.DISCORD_APPLICATION_ID ??
			"1569963528171815023",
	};
}

const { DISCORD_BOT_TOKEN: token, GUILD_ID: guildId, DISCORD_APPLICATION_ID: applicationId } =
	loadConfig();

if (!token || !guildId) {
	console.error(`
Missing credentials for command registration.

Create .dev.vars (gitignored) from .dev.vars.example, or set environment variables:

  DISCORD_BOT_TOKEN
  GUILD_ID

PowerShell example:
  Copy-Item .dev.vars.example .dev.vars
  # edit .dev.vars with real values, then:
  pnpm run register-commands
`);
	process.exit(1);
}

const response = await fetch(
	`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
	{
		method: "PUT",
		headers: {
			Authorization: `Bot ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(COMMANDS),
	},
);

if (!response.ok) {
	console.error(await response.text());
	process.exit(1);
}

const registered = await response.json();
console.log("Registered guild commands:", registered.map((c) => c.name).join(", "));
