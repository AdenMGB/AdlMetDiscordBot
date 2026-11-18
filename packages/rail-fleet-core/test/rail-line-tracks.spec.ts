import { describe, expect, it } from "vitest";
import { getRailLineTracks } from "../src/rail-line-tracks";

describe("rail line tracks", () => {
	it("includes GTFS shapes for gawler", () => {
		const tracks = getRailLineTracks({ line: "gawler" });
		expect(tracks.length).toBeGreaterThan(0);
		expect(tracks[0].points.length).toBeGreaterThan(10);
		expect(tracks[0].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
	});
});