import { describe, expect, it } from "vitest";
import {
	defaultMaxTokensForQuestion,
	wantsLongReply,
} from "../src/reply-length";

describe("reply length", () => {
	it("short ping is not long", () => {
		expect(wantsLongReply("when's the next train?")).toBe(false);
		expect(defaultMaxTokensForQuestion("hi", 400)).toBe(220);
	});

	it("detail requests allow more tokens", () => {
		expect(wantsLongReply("explain in detail how metrocard works")).toBe(true);
		expect(defaultMaxTokensForQuestion("explain in detail", 400)).toBe(400);
	});
});
