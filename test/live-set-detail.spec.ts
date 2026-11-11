import { describe, expect, it } from "vitest";
import { buildProgressBar, computeProgressSlice } from "../src/transit/live-set-detail";
import type { LiveVehicle } from "../src/transit/rt-feed";

const path = [
	{ stopId: "1", name: "A", lat: -35, lon: 138.5 },
	{ stopId: "2", name: "B", lat: -35.01, lon: 138.51 },
	{ stopId: "3", name: "C", lat: -35.02, lon: 138.52 },
	{ stopId: "4", name: "D", lat: -35.03, lon: 138.53 },
];

const baseVehicle: LiveVehicle = {
	tripId: "t1",
	routeId: "SEAFRD",
	setLabel: "4001",
	lat: -35.015,
	lon: 138.515,
	speedMps: 8,
	timestampSec: 0,
	scheduleRelationship: 0,
};

describe("live set detail", () => {
	it("builds a progress bar", () => {
		expect(buildProgressBar(2, 4)).toContain("🚃");
	});

	it("marks passed and upcoming from trip update", () => {
		const slice = computeProgressSlice(path, baseVehicle, {
			tripId: "t1",
			routeId: "SEAFRD",
			delaySec: 0,
			stops: [{ stopId: "3", stopSequence: 3, arrivalDelaySec: 0, departureDelaySec: 0 }],
		});
		expect(slice.passed.map((s) => s.name)).toEqual(["A", "B"]);
		expect(slice.currentTo?.name).toBe("C");
		expect(slice.upcoming[0]?.name).toBe("D");
	});
});
