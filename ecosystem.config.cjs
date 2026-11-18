const path = require("node:path");

const root = __dirname;

module.exports = {
	apps: [
		{
			name: "metro-mate-discord-ai",
			cwd: root,
			script: path.join(root, "scripts/pm2-discord-ai.sh"),
			interpreter: "bash",
			env: { NODE_ENV: "production" },
			env_file: path.join(root, "apps/discord-ai-runner/.env"),
			autorestart: true,
			max_restarts: 20,
			restart_delay: 5000,
			time: true,
			out_file: path.join(root, "apps/discord-ai-runner/data/runner.log"),
			error_file: path.join(root, "apps/discord-ai-runner/data/runner.log"),
		},
		{
			name: "metro-mate-rail-fleet-store",
			cwd: root,
			script: path.join(root, "scripts/pm2-rail-fleet.sh"),
			interpreter: "bash",
			env: { NODE_ENV: "production" },
			env_file: path.join(root, "apps/rail-fleet-store/.env"),
			autorestart: true,
			max_restarts: 20,
			restart_delay: 5000,
			time: true,
			out_file: path.join(root, "apps/rail-fleet-store/data/fleet-store.log"),
			error_file: path.join(root, "apps/rail-fleet-store/data/fleet-store.log"),
		},
		{
			name: "metro-mate-alerts-push",
			script: path.join(root, "scripts/push-alerts-cron.sh"),
			interpreter: "bash",
			cwd: root,
			env: {
				ALERTS_CRON_ENV: path.join(root, ".alerts-cron.env"),
			},
			autorestart: false,
			cron_restart: "*/5 * * * *",
			time: true,
			out_file: path.join(root, "data/alerts-push.log"),
			error_file: path.join(root, "data/alerts-push.log"),
		},
	],
};