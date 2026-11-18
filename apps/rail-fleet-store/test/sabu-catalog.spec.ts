import { describe, expect, it } from "vitest";
import {
	parseSabuDetailText,
	parseSabuStatus,
	sabuLastSeenToIso,
} from "../src/sabu-catalog";

describe("sabu catalog", () => {
	it("parses in-service block", () => {
		const s = parseSabuStatus("SEAFRD\nSeaford\nNext Stop: Emerson Railway Station");
		expect(s.last_route_id).toBe("SEAFRD");
		expect(s.last_headsign).toBe("Seaford");
		expect(s.next_stop_hint).toContain("Emerson");
	});

	it("parses glued detail text", () => {
		const p = parseSabuDetailText(
			"Comeng/Clyde3000 ClassLast Seen 19-11-2026 10:06:34",
		);
		expect(p.chassis).toBe("Comeng/Clyde");
		expect(p.bodyClass).toBe("3000 Class");
	});

	it("converts sabu datetime", () => {
		const iso = sabuLastSeenToIso("19-11-2026 10:06:34");
		expect(iso).toBe("2026-11-18T23:36:34.000Z");
	});
});