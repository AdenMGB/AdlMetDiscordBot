import { describe, expect, it } from "vitest";
import { htmlToDiscordMarkdown } from "../src/transit/html-discord";

describe("htmlToDiscordMarkdown", () => {
	it("strips div/p wrappers and decodes entities", () => {
		const html =
			'<div id="component_1661032"><p>From first bus service, Wednesday 4 November due to Stevens Drv &amp; Heaslip Rd.</p></div>';
		expect(htmlToDiscordMarkdown(html)).toBe(
			"From first bus service, Wednesday 4 November due to Stevens Drv & Heaslip Rd.",
		);
	});

	it("converts links", () => {
		const html = '<a href="https://example.com/page">More info</a>';
		expect(htmlToDiscordMarkdown(html)).toBe("[More info](https://example.com/page)");
	});
});
