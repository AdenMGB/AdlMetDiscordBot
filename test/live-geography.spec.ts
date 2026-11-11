import { describe, expect, it } from "vitest";
import { haversineM, locateBetweenStops } from "../src/transit/geography";

describe("live geography", () => {
	it("locates a point between two stops", () => {
		const stops = [
			{ stopId: "a", name: "Alpha", lat: -35.0, lon: 138.5 },
			{ stopId: "b", name: "Beta", lat: -35.1, lon: 138.51 },
			{ stopId: "c", name: "Gamma", lat: -35.2, lon: 138.52 },
		];
		const hit = locateBetweenStops(-35.105, 138.505, stops);
		expect(hit).not.toBeNull();
		expect(hit?.from.name).toBe("Beta");
		expect(hit?.to.name).toBe("Gamma");
	});

	it("haversine is sane", () => {
		expect(haversineM(-35, 138.5, -35, 138.51)).toBeGreaterThan(800);
	});
});
