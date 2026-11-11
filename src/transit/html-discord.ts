const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** Convert Adelaide Metro HTML alert copy to Discord-safe markdown. */
export function htmlToDiscordMarkdown(raw: string): string {
	const input = raw.trim();
	if (!input) return "";

	if (!input.includes("<") && !input.includes("&")) {
		return collapseBlankLines(input);
	}

	let text = input;

	text = text.replace(
		/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
		(_match, href: string, inner: string) => {
			const label = stripTags(inner).trim() || href;
			return `[${label}](${href})`;
		},
	);

	text = text.replace(/<br\s*\/?>/gi, "\n");
	text = text.replace(/<\/(p|div|li|h[1-6]|tr|table|ul|ol)>/gi, "\n");
	text = text.replace(/<(p|div|li|h[1-6]|tr|table|ul|ol)[^>]*>/gi, "\n");

	for (const tag of ["strong", "b", "em", "i"]) {
		const mark = tag === "strong" || tag === "b" ? "**" : "*";
		text = text.replace(new RegExp(`<${tag}[^>]*>`, "gi"), mark);
		text = text.replace(new RegExp(`</${tag}>`, "gi"), mark);
	}

	text = stripTags(text);
	text = decodeHtmlEntities(text);
	text = text.replace(/[ \t]+\n/g, "\n");
	return collapseBlankLines(text);
}

function stripTags(html: string): string {
	return html.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_m, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 10)),
		)
		.replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name] ?? match);
}

function collapseBlankLines(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}
