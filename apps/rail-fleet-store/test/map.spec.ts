import { describe, expect, it } from "vitest";
import { buildFleetMapSvg } from "@metro-mate/rail-fleet-core/map-svg";
import type { VehicleRow } from "../src/db";

describe("fleet map svg", () => {
	it("renders svg with a marker", () => {
		const v: VehicleRow = {
			set_id: "4005",
			body_class: "4000 Class",
			chassis: "Bombardier",
			first_seen_at: "2026-01-01T00:00:00.000Z",
			last_seen_at: "2026-01-01T00:00:00.000Z",
			last_lat: -34.92,
			last_lon: 138.59,
			last_bearing: 90,
			last_speed_mps: 5,
			last_route_id: "GAW",
			last_trip_id: "t1",
			last_headsign: "City",
			last_stop_id: null,
			last_status: "IN SERVICE",
		};
		const svg = buildFleetMapSvg([v], [], { title: "Test", baseLayer: "osm" });
		expect(svg).toContain("4005");
		expect(svg).toContain("openstreetmap.org");
		expect(svg).not.toContain("Rail lines (GTFS)");
	});
});