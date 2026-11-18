import { describe, expect, it } from "vitest";
import { parseFleetSyncBody } from "../src/transit/fleet-sync";

describe("fleet sync payload", () => {
	it("accepts a minimal valid body", () => {
		const body = {
			syncedAt: "2026-01-01T00:00:00.000Z",
			meta: { last_poll: "2026-01-01T00:00:00.000Z" },
			vehicles: [],
			tripRecords: [],
			positionSamples: [],
		};
		expect(parseFleetSyncBody(body)).toEqual(body);
	});

	it("rejects missing arrays", () => {
		expect(parseFleetSyncBody({ syncedAt: "x" })).toBeNull();
	});
});