import { afterEach, describe, expect, it, vi } from "vitest";
import { nvidiaChatCompletion, parseSseChatChunks } from "../src/nvidia-chat";

describe("parseSseChatChunks", () => {
	it("accumulates streamed content deltas", () => {
		const sse = [
			'data: {"choices":[{"delta":{"content":"Hello"}}]}',
			"",
			'data: {"choices":[{"delta":{"content":" world"}}]}',
			"",
			"data: [DONE]",
			"",
		].join("\n");
		const { text, rest } = parseSseChatChunks(sse);
		expect(text).toBe("Hello world");
		expect(rest).toBe("");
	});
});

describe("nvidiaChatCompletion", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses streaming for the default nemotron model", async () => {
		const payload = [
			'data: {"choices":[{"delta":{"content":"The Seaford line runs to Brighton."}}]}',
			"",
			"data: [DONE]",
			"",
		].join("\n");

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(payload));
						controller.close();
					},
				}),
			}),
		);

		const text = await nvidiaChatCompletion("test-key", [
			{ role: "user", content: "fact" },
		]);
		expect(text).toBe("The Seaford line runs to Brighton.");
		const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
			body: string;
		};
		expect(JSON.parse(init.body).stream).toBe(true);
		expect(JSON.parse(init.body).model).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
	});

	it("throws on API errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 401,
				text: async () => "Invalid credentials",
			}),
		);

		await expect(
			nvidiaChatCompletion("bad", [{ role: "user", content: "hi" }]),
		).rejects.toThrow(/401/);
	});
});
