import type { D1Database } from "@cloudflare/workers-types";

export interface WorkerEnv {
	DISCORD_APPLICATION_ID: string;
	DISCORD_PUBLIC_KEY: string;
	DISCORD_BOT_TOKEN: string;
	GUILD_ID: string;
	VERIFIED_ROLE_ID: string;
	VERIFY_CHANNEL_ID: string;
	ALERTS_CHANNEL_ID: string;
	DISRUPTIONS_ROLE_ID: string;
	SETUP_SECRET: string;
	/** Bearer token for POST /alerts/push (falls back to SETUP_SECRET). */
	ALERTS_CRON_SECRET?: string;
	/** NVIDIA integrate API for `/fact` (https://integrate.api.nvidia.com/v1). */
	NVIDIA_API_KEY?: string;
	/** Bearer token for POST /discord/mention from the gateway relay (falls back to SETUP_SECRET). */
	GATEWAY_RELAY_SECRET?: string;
	DB?: D1Database;
}
