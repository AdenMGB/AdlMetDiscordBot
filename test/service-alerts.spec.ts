import { describe, expect, it } from "vitest";
import {
	classifyAlertMode,
	DISCORD_MESSAGE_EMBED_CHAR_MAX,
	filterAlertsByMode,
	formatAlertDiscordPayload,
	isAlertMode,
	isRailAlert,
	messageEmbedCharTotal,
	type AlertEmbedDraft,
	type ServiceAlert,
} from "../src/transit/service-alerts";

describe("service alerts filter", () => {
	it("accepts known rail route ids", () => {
		expect(isRailAlert(["SEAFRD"], [], "", "")).toBe(true);
	});

	it("rejects ordinary bus routes for rail filter", () => {
		expect(isRailAlert(["245"], [0], "Stop closure", "Bus stop moved")).toBe(false);
	});

	it("accepts train keywords in text", () => {
		expect(
			isRailAlert([], [], "Gawler line delay", "Trains may run late"),
		).toBe(true);
	});

	it("classifies bus alerts", () => {
		expect(classifyAlertMode(["245"], [3], "Route diversion", "Bus via Main Rd")).toBe(
			"bus",
		);
	});

	it("treats Adelaide route_type 0 with numeric routes as bus", () => {
		expect(
			classifyAlertMode(
				["751"],
				[0],
				"Detour and Stop closure - Main Rd (751, 751A)",
				"From first bus service, Wednesday",
			),
		).toBe("bus");
	});

	it("classifies tram alerts", () => {
		expect(
			classifyAlertMode([], [], "Glenelg tram delay", "Trams running late"),
		).toBe("tram");
	});

	it("prefers train over bus when rail route id matches", () => {
		expect(classifyAlertMode(["SEAFRD"], [], "", "")).toBe("train");
	});

	it("filters alerts by mode", () => {
		const sample: ServiceAlert = {
			id: "1",
			header: "H",
			description: "",
			routeIds: [],
			lineIds: [],
			mode: "bus",
			causeLabel: "Weather",
			effectLabel: "Detour",
			active: true,
		};
		expect(isAlertMode("bus")).toBe(true);
		expect(isAlertMode("metro")).toBe(false);
		expect(filterAlertsByMode([sample], "bus")).toHaveLength(1);
		expect(filterAlertsByMode([sample], "train")).toHaveLength(0);
	});

	it("keeps combined embed text under Discord message limit", () => {
		const alerts: ServiceAlert[] = Array.from({ length: 40 }, (_, i) => ({
			id: `id-${i}`,
			header: `Long heading for alert number ${i}`,
			description: "Detour detail. ".repeat(80),
			routeIds: [`${100 + i}`],
			lineIds: [],
			mode: i % 3 === 0 ? "train" : i % 3 === 1 ? "bus" : "tram",
			causeLabel: "Maintenance",
			effectLabel: "Modified service",
			active: true,
		}));

		const { embeds, content } = formatAlertDiscordPayload(alerts, "Test disruptions");
		expect(embeds.length).toBe(1);
		expect(messageEmbedCharTotal(embeds as AlertEmbedDraft[])).toBeLessThanOrEqual(
			DISCORD_MESSAGE_EMBED_CHAR_MAX,
		);
		expect(content?.length ?? 0).toBeLessThanOrEqual(2000);
		expect((content ?? "").length).toBeGreaterThan(0);
	});
});
