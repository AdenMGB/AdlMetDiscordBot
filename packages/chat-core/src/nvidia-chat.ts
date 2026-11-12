const NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/** Fast on integrate.api.nvidia.com; deepseek-v4.1-flash often stalls 60s+ from some hosts. */
export const NVIDIA_DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

/** Prefer streaming (more reliable than buffered for several hosted models). */
const STREAMING_MODELS = new Set([
	NVIDIA_DEFAULT_MODEL,
	"deepseek-ai/deepseek-v4.1-flash",
]);

export type ChatMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

type ChatCompletionResponse = {
	choices?: Array<{
		message?: {
			content?: string | null;
			reasoning_content?: string | null;
		};
	}>;
	error?: { message?: string };
};

export function parseSseChatChunks(buffer: string): { text: string; rest: string } {
	let text = "";
	const lines = buffer.split("\n");
	const rest = lines.pop() ?? "";

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) continue;
		const payload = trimmed.slice(5).trim();
		if (!payload || payload === "[DONE]") continue;
		try {
			const chunk = JSON.parse(payload) as {
				choices?: Array<{
					delta?: { content?: string | null; reasoning_content?: string | null };
				}>;
			};
			const delta = chunk.choices?.[0]?.delta;
			const piece = delta?.content ?? delta?.reasoning_content;
			if (typeof piece === "string") {
				text += piece;
			}
		} catch {
			// partial JSON line — wait for more bytes
		}
	}

	return { text, rest };
}

export type NvidiaStreamCallbacks = {
	onChunk?: (fullTextSoFar: string) => void | Promise<void>;
};

async function nvidiaChatCompletionStream(
	apiKey: string,
	messages: ChatMessage[],
	options?: {
		model?: string;
		maxTokens?: number;
		temperature?: number;
		topP?: number;
		signal?: AbortSignal;
	} & NvidiaStreamCallbacks,
): Promise<string> {
	const response = await fetch(NVIDIA_CHAT_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		signal: options?.signal,
		body: JSON.stringify({
			model: options?.model ?? NVIDIA_DEFAULT_MODEL,
			messages,
			stream: true,
			temperature: options?.temperature ?? 1,
			top_p: options?.topP ?? 0.95,
			max_tokens: options?.maxTokens ?? 512,
			chat_template_kwargs: { enable_thinking: false },
		}),
	});

	if (!response.ok) {
		const detail = await response.text();
		throw new Error(`NVIDIA API (${response.status}): ${detail.slice(0, 300)}`);
	}

	const body = response.body;
	if (!body) {
		throw new Error("NVIDIA API returned no response body.");
	}

	const reader = body.getReader();
	const decoder = new TextDecoder();
	let sseBuffer = "";
	let text = "";

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		sseBuffer += decoder.decode(value, { stream: true });
		const parsed = parseSseChatChunks(sseBuffer);
		if (parsed.text) {
			text += parsed.text;
			if (options?.onChunk) {
				await options.onChunk(text);
			}
		}
		sseBuffer = parsed.rest;
	}

	const tail = parseSseChatChunks(`${sseBuffer}\n`);
	if (tail.text) {
		text += tail.text;
		if (options?.onChunk) {
			await options.onChunk(text);
		}
	}

	const result = text.trim();
	if (!result) {
		throw new Error("NVIDIA API returned an empty completion.");
	}

	return result;
}

async function nvidiaChatCompletionBuffered(
	apiKey: string,
	messages: ChatMessage[],
	options?: {
		model?: string;
		maxTokens?: number;
		temperature?: number;
		topP?: number;
		signal?: AbortSignal;
	} & NvidiaStreamCallbacks,
): Promise<string> {
	const response = await fetch(NVIDIA_CHAT_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		signal: options?.signal,
		body: JSON.stringify({
			model: options?.model ?? NVIDIA_DEFAULT_MODEL,
			messages,
			temperature: options?.temperature ?? 1,
			top_p: options?.topP ?? 0.95,
			max_tokens: options?.maxTokens ?? 512,
			stream: false,
			chat_template_kwargs: { enable_thinking: false },
		}),
	});

	const body = (await response.json()) as ChatCompletionResponse;

	if (!response.ok) {
		const detail = body.error?.message ?? JSON.stringify(body).slice(0, 200);
		throw new Error(`NVIDIA API (${response.status}): ${detail}`);
	}

	const choice = body.choices?.[0]?.message;
	const text =
		choice?.content?.trim() ||
		choice?.reasoning_content?.trim() ||
		"";
	if (!text) {
		throw new Error("NVIDIA API returned an empty completion.");
	}

	if (options?.onChunk) {
		await options.onChunk(text);
	}

	return text;
}

export async function nvidiaChatCompletion(
	apiKey: string,
	messages: ChatMessage[],
	options?: {
		model?: string;
		maxTokens?: number;
		temperature?: number;
		topP?: number;
		timeoutMs?: number;
	} & NvidiaStreamCallbacks,
): Promise<string> {
	const model = options?.model ?? NVIDIA_DEFAULT_MODEL;
	const timeoutMs = options?.timeoutMs ?? 55_000;
	const signal = AbortSignal.timeout(timeoutMs);

	const callOpts = {
		model,
		maxTokens: options?.maxTokens,
		temperature: options?.temperature,
		topP: options?.topP,
		signal,
		onChunk: options?.onChunk,
	};

	try {
		if (STREAMING_MODELS.has(model)) {
			return await nvidiaChatCompletionStream(apiKey, messages, callOpts);
		}
		return await nvidiaChatCompletionBuffered(apiKey, messages, callOpts);
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			throw new Error(
				`NVIDIA API timed out after ${Math.round(timeoutMs / 1000)}s — try again in a moment.`,
			);
		}
		throw error;
	}
}
