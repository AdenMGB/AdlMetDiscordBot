/** Guild slash command definitions (registered via `pnpm run register-commands`). */
export const GUILD_COMMANDS = [
	{
		name: "health",
		description: "Check whether Metro Mate and Discord are reachable",
		type: 1,
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
		description: "Train, bus & tram service alerts from Adelaide Metro",
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
		description: "Disruptions for train, bus, or tram",
		type: 1,
		options: [
			{
				name: "type",
				description: "Train, bus, or tram",
				type: 3,
				required: true,
				choices: [
					{ name: "Train", value: "train" },
					{ name: "Bus", value: "bus" },
					{ name: "Tram", value: "tram" },
				],
			},
			{
				name: "line",
				description: "Train only — filter to one line (optional)",
				type: 3,
				required: false,
				autocomplete: true,
			},
		],
	},
	{
		name: "fact",
		description: "Random Adelaide Metro / transport trivia (NVIDIA AI)",
		type: 1,
		options: [
			{
				name: "topic",
				description: "Optional focus (e.g. Seaford, 3000 class, City Loop)",
				type: 3,
				required: false,
			},
		],
	},
	{
		name: "train-map",
		description: "Map of trains running right now (all, one line, or one set)",
		type: 1,
		options: [
			{
				name: "line",
				description: "Rail line (optional)",
				type: 3,
				required: false,
				autocomplete: true,
			},
			{
				name: "set",
				description: "One train set (optional)",
				type: 3,
				required: false,
				autocomplete: true,
			},
		],
	},
	{
		name: "fleet",
		description: "List train sets and what line they’re on (filters like SA Bus Tracker)",
		type: 1,
		options: [
			{
				name: "vehicle",
				description: "Filter by set number (e.g. 4005)",
				type: 3,
				required: false,
			},
			{
				name: "line",
				description: "Filter by line",
				type: 3,
				required: false,
				autocomplete: true,
			},
			{
				name: "active_now",
				description: "Only sets seen in the last ~2 minutes",
				type: 5,
				required: false,
			},
			{
				name: "active_today",
				description: "Only sets seen today (Adelaide)",
				type: 5,
				required: false,
			},
			{
				name: "page",
				description: "Page (20 per page)",
				type: 4,
				required: false,
				min_value: 1,
				max_value: 50,
			},
		],
	},
	{
		name: "set-profile",
		description: "Stored profile & trip history for one train set",
		type: 1,
		options: [
			{
				name: "set",
				description: "Train set (e.g. 4005)",
				type: 3,
				required: true,
				autocomplete: true,
			},
		],
	},
	{
		name: "rail-stats",
		description: "How many trains we’re tracking and activity stats",
		type: 1,
	},
] as const;

export type SlashCommandName = (typeof GUILD_COMMANDS)[number]["name"];
