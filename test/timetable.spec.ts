import { describe, expect, it } from "vitest";
import {
	adelaideLocalToUnix,
	isCityBoundHeadsign,
	perDirectionLimit,
	resolveTimetableReference,
} from "../src/transit/format";
import { lineChoiceList } from "../src/transit/lines";
import { buildTimetableEmbed, splitDepartures } from "../src/transit/timetable";

describe("timetable helpers", () => {
	it("detects city headsigns", () => {
		expect(isCityBoundHeadsign("City")).toBe(true);
		expect(isCityBoundHeadsign("Adelaide")).toBe(true);
		expect(isCityBoundHeadsign("Seaford")).toBe(false);
	});

	it("splits departures evenly", () => {
		const now = 1_700_000_000;
		const rows = [
			{ depart_at: now + 60, headsign: "City", direction_kind: "city" as const },
			{ depart_at: now + 120, headsign: "City", direction_kind: "city" as const },
			{ depart_at: now + 90, headsign: "Seaford", direction_kind: "outbound" as const },
			{ depart_at: now + 180, headsign: "Seaford", direction_kind: "outbound" as const },
		];
		const { city, outbound } = splitDepartures(rows, 6, now);
		expect(city).toHaveLength(2);
		expect(outbound).toHaveLength(2);
		expect(perDirectionLimit(6)).toBe(3);
	});

	it("filters line autocomplete", () => {
		const choices = lineChoiceList("sea");
		expect(choices.some((c) => c.value === "seaford")).toBe(true);
	});

	it("resolves date and time in Adelaide", () => {
		const noon = adelaideLocalToUnix(2026, 11, 12, 12, 0);
		const ref = resolveTimetableReference("12:00", "2026-11-12", noon - 3600);
		expect(ref.ok).toBe(true);
		if (ref.ok) {
			expect(ref.referenceSec).toBe(noon);
			expect(ref.custom).toBe(true);
		}
		const todayOnly = resolveTimetableReference("3:30pm", undefined, noon);
		expect(todayOnly.ok).toBe(true);
	});

	it("builds embed fields for both directions", () => {
		const now = 1_700_000_000;
		const embed = buildTimetableEmbed(
			"seaford",
			"Brighton Railway Station",
			[
				{ depart_at: now + 300, headsign: "City", direction_kind: "city" },
				{ depart_at: now + 600, headsign: "Seaford", direction_kind: "outbound" },
			],
			6,
			now,
		);
		expect(embed.title).toContain("Brighton");
		const fields = embed.fields as { name: string }[];
		expect(fields.some((f) => f.name === "Towards City")).toBe(true);
		expect(fields.some((f) => f.name === "Towards Seaford")).toBe(true);
	});
});
