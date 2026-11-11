import { describe, expect, it } from "vitest";
import { isRailAlert } from "../src/transit/service-alerts";

describe("service alerts filter", () => {
	it("accepts known rail route ids", () => {
		expect(isRailAlert(["SEAFRD"], [], "", "")).toBe(true);
	});

	it("rejects ordinary bus routes", () => {
		expect(isRailAlert(["245"], [0], "Stop closure", "Bus stop moved")).toBe(false);
	});

	it("accepts train keywords in text", () => {
		expect(
			isRailAlert([], [], "Gawler line delay", "Trains may run late"),
		).toBe(true);
	});
});
