import type { RunnerConfig } from "./env";

export async function fetchMentionToolContext(
	config: RunnerConfig,
	question: string,
): Promise<string | undefined> {
	const base = config.apiBase.replace(/\/$/, "");
	const secret = config.runnerSecret;
	if (!secret) {
		console.warn("RUNNER_SECRET/SETUP_SECRET not set — skipping Worker command tools");
		return undefined;
	}

	const response = await fetch(`${base}/internal/mention-tools`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secret}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ question }),
		signal: AbortSignal.timeout(25_000),
	});

	if (!response.ok) {
		const body = await response.text();
		console.error(`mention-tools ${response.status}: ${body.slice(0, 200)}`);
		return undefined;
	}

	const data = (await response.json()) as { context?: string };
	return data.context?.trim() || undefined;
}