import { describe, it, expect } from "vitest";
import { commandRegistrationGuildIds, parseExtraCommandGuildIds } from "../src/guilds";
import type { WorkerEnv } from "../src/env.d";

describe("command guild ids", () => {
	it("parses comma-separated extra guild ids", () => {
		expect(parseExtraCommandGuildIds("1533757414564696184")).toEqual([
			"1533757414564696184",
		]);
		expect(parseExtraCommandGuildIds(" a , b , a ")).toEqual(["a", "b"]);
		expect(parseExtraCommandGuildIds("")).toEqual([]);
	});

	it("merges primary and extra without duplicates", () => {
		const env = {
			GUILD_ID: "111",
			COMMAND_GUILD_IDS: "111,1533757414564696184",
		} as WorkerEnv;
		expect(commandRegistrationGuildIds(env)).toEqual([
			"111",
			"1533757414564696184",
		]);
	});
});