import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Metro Mate worker", () => {
	it("GET /health", async () => {
		const request = new IncomingRequest("https://api.adlmetbot.adenmgb.com/health");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { ok: boolean; service: string };
		expect(body.ok).toBe(true);
		expect(body.service).toBe("metro-mate");
	});

	it("GET / returns service info", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { service: string };
		expect(body.service).toBe("metro-mate");
	});
});
