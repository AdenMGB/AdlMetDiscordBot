import { describe, it, expect } from "vitest";
import { canManageServer } from "../src/permissions";

describe("canManageServer", () => {
	it("allows administrator", () => {
		expect(canManageServer("8")).toBe(true);
	});

	it("allows manage guild", () => {
		expect(canManageServer("32")).toBe(true);
	});

	it("denies without permission", () => {
		expect(canManageServer("0")).toBe(false);
	});
});
