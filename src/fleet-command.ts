import {
	InteractionResponseFlags,
	InteractionResponseType,
} from "discord-interactions";
import {
	editInteractionResponse,
	editInteractionResponseMultipart,
} from "./discord-api";
import type { WorkerEnv } from "./env.d";
import { isRailLineId, lineChoiceList, RAIL_LINES, type RailLineId } from "./transit/lines";
import {
	fleetActiveSetIds,
	fleetList,
	fleetStats,
	fleetVehicleDetails,
} from "./transit/fleet-d1";
import { fetchFleetMapWebp } from "./transit/rail-store-client";
import { liveSetAutocompleteChoices } from "./transit/live-trains";
import { fetchLiveRailVehicles } from "./transit/rt-feed";

type InteractionOption = {
	name: string;
	type: number;
	value?: string | number;
	focused?: boolean;
};

type CommandInteraction = {
	token?: string;
	data?: { name?: string; options?: InteractionOption[] };
};

function json(data: unknown): Response {
	return new Response(JSON.stringify(data), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function stringOption(
	options: InteractionOption[] | undefined,
	name: string,
): string | undefined {
	const raw = options?.find((o) => o.name === name)?.value;
	if (raw === undefined || raw === null) return undefined;
	const s = String(raw).trim();
	return s.length > 0 ? s : undefined;
}

function boolOption(options: InteractionOption[] | undefined, name: string): boolean {
	const raw = options?.find((o) => o.name === name)?.value;
	return raw === true || raw === 1 || raw === "1" || raw === "true";
}

export async function handleFleetAutocomplete(
	interaction: CommandInteraction,
	env: WorkerEnv,
): Promise<Response> {
	const options = interaction.data?.options ?? [];
	const focused = options.find((o) => o.focused);
	const query = focused?.value !== undefined ? String(focused.value) : "";

	if (focused?.name === "line") {
		return json({
			type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
			data: {
				choices: lineChoiceList(query).slice(0, 25).map((c) => ({
					name: c.name,
					value: c.value,
				})),
			},
		});
	}

	if (focused?.name === "set") {
		try {
			if (env.DB) {
				const sets = await fleetActiveSetIds(env.DB, 80);
				const filtered = sets
					.filter((id) => id.includes(query))
					.slice(0, 25)
					.map((id) => ({ name: id, value: id }));
				if (filtered.length > 0) {
					return json({
						type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
						data: { choices: filtered },
					});
				}
			}
			const vehicles = await fetchLiveRailVehicles();
			const lineRaw = stringOption(options, "line");
			const lineFilter =
				lineRaw && isRailLineId(lineRaw) ? (lineRaw as RailLineId) : null;
			const choices = liveSetAutocompleteChoices(vehicles, lineFilter, query);
			return json({
				type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
				data: { choices },
			});
		} catch {
			return json({
				type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
				data: { choices: [] },
			});
		}
	}

	return json({
		type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
		data: { choices: [] },
	});
}

export function handleFleetCommands(
	interaction: CommandInteraction,
	env: WorkerEnv,
	ctx: { waitUntil(promise: Promise<unknown>): void },
): Response {
	const name = interaction.data?.name;
	const token = interaction.token;
	const applicationId = env.DISCORD_APPLICATION_ID;

	if (!token) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Missing interaction token.",
				flags: InteractionResponseFlags.EPHEMERAL,
			},
		});
	}

	ctx.waitUntil(
		(async () => {
			if (!env.DB) {
				await editInteractionResponse(applicationId, token, {
					content: "Train tracking isn’t set up on this bot yet — poke an admin if it keeps happening.",
				});
				return;
			}
			const db = env.DB;
			try {
				if (name === "rail-stats") {
					const s = await fleetStats(db);
					const embed = {
						title: "Adelaide Metro rail · quick stats",
						color: 0xf6c445,
						fields: [
							{ name: "Tracked sets", value: String(s.vehiclesTracked), inline: true },
							{ name: "In service now", value: String(s.activeNow), inline: true },
							{ name: "Seen today", value: String(s.activeToday), inline: true },
							{ name: "Trips recorded", value: String(s.tripsRecorded), inline: true },
							{ name: "Position samples", value: String(s.samplesRecorded), inline: true },
							{
								name: "Last poll",
								value: s.lastPoll ? `<t:${Math.floor(new Date(s.lastPoll).getTime() / 1000)}:R>` : "—",
								inline: false,
							},
						],
						footer: {
							text: "Refreshes about every 15 minutes",
						},
					};
					await editInteractionResponse(applicationId, token, { embeds: [embed] });
					return;
				}

				if (name === "fleet") {
					const opts = interaction.data?.options;
					const q = new URLSearchParams();
					const page = Number(stringOption(opts, "page") ?? "1");
					q.set("page", String(Math.max(1, page)));
					const vehicle = stringOption(opts, "vehicle");
					if (vehicle) q.set("vehicle_filter", vehicle);
					const line = stringOption(opts, "line");
					if (line && isRailLineId(line)) q.set("line", line);
					if (boolOption(opts, "active_now")) q.set("active_now", "1");
					if (boolOption(opts, "active_today")) q.set("active_today", "1");

					const data = await fleetList(db, q);
					const lines = data.vehicles
						.map((v) => {
							const route = v.last_route_id ?? "—";
							const hs = v.last_headsign ?? "";
							return `**${v.set_id}** · ${route} ${hs ? `→ ${hs}` : ""} · ${v.last_status}`;
						})
						.join("\n");
					const embed = {
						title: `Fleet listing (page ${data.page}/${Math.max(1, Math.ceil(data.total / data.pageSize))})`,
						description: lines.length > 0 ? lines.slice(0, 3900) : "_No vehicles match._",
						color: 0x2e7d32,
						footer: { text: `${data.total} matching train${data.total === 1 ? "" : "s"}` },
					};
					await editInteractionResponse(applicationId, token, { embeds: [embed] });
					return;
				}

				if (name === "set-profile") {
					const setId = stringOption(interaction.data?.options, "set");
					if (!setId) {
						await editInteractionResponse(applicationId, token, {
							content: "Provide a **set** (e.g. 4005).",
						});
						return;
					}
					const data = await fleetVehicleDetails(db, setId);
					if (!data) {
						await editInteractionResponse(applicationId, token, {
							content: `No history for set **${setId}** yet — give it a bit once the train has been running.`,
						});
						return;
					}
					const v = data.vehicle;
					const tripLines = data.tripsLast60
						.slice(0, 12)
						.map((t) => {
							const end = t.ended_at ? "ended" : "active";
							return `• ${t.route_id ?? "?"} → ${t.headsign ?? "?"} (${end})`;
						})
						.join("\n");
					const embed = {
						title: `Set ${v.set_id} · ${v.body_class}`,
						description:
							`${v.chassis}\n` +
							`Last seen <t:${Math.floor(new Date(v.last_seen_at).getTime() / 1000)}:R>\n` +
							(v.last_headsign
								? `Current trip: **${v.last_route_id}** → ${v.last_headsign}`
								: `Route: **${v.last_route_id ?? "—"}**`) +
							(v.next_stop_hint
								? `\nNext stop: ${v.next_stop_hint}`
								: ""),
						fields: [
							{
								name: "Last 7 days",
								value: `${data.trackedSampleCount7d} samples · top route ${data.topRoutes7d[0]?.route_id ?? "—"}`,
								inline: false,
							},
							{
								name: "Recent trips",
								value: tripLines || "No trips logged yet.",
								inline: false,
							},
						],
						color: 0x1565c0,
						footer: { text: "Metro Mate" },
					};
					await editInteractionResponse(applicationId, token, { embeds: [embed] });
					return;
				}

				if (name === "train-map") {
					const opts = interaction.data?.options;
					const set = stringOption(opts, "set");
					const line = stringOption(opts, "line");
					const q = new URLSearchParams();
					if (set) q.set("set", set);
					if (line && isRailLineId(line)) q.set("line", line);
					const webp = await fetchFleetMapWebp(env, q);
					const title = set
						? `Set ${set}`
						: line && isRailLineId(line)
							? RAIL_LINES[line].label
							: "All trains";
					await editInteractionResponseMultipart(applicationId, token, {
						content: `**${title}**`,
					}, [
						{
							name: "train-map.webp",
							data: webp,
							contentType: "image/webp",
						},
					]);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "Something broke";
				await editInteractionResponse(applicationId, token, {
					content: `Couldn’t load that just now: ${message}`,
				});
			}
		})(),
	);

	return json({
		type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
		data: {},
	});
}