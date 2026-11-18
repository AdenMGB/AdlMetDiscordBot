import { describe, expect, it } from "vitest";
import { inferFleetMeta, lineIdForRoute, routeIdsForLine } from "../src/index";

describe("rail-fleet-core", () => {
	it("infers 4000 class", () => {
		expect(inferFleetMeta("4005").body).toContain("4000");
	});

	it("maps routes to lines", () => {
		expect(lineIdForRoute("GAW")).toBe("gawler");
		expect(routeIdsForLine("seaford")).toContain("SEAFRD");
	});
});