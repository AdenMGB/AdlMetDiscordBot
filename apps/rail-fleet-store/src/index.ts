import http from "node:http";
import { openFleetDb } from "./db";
import { RailCollector } from "./collector";
import { createApiHandler } from "./api";
import { loadEnv } from "./env";
import { startFleetSyncPush } from "./sync-push";

const config = loadEnv();
const db = openFleetDb(config.dbPath);

const collector = new RailCollector(db, {
	vpUrl: config.vpUrl,
	tuUrl: config.tuUrl,
	pollMs: config.pollMs,
});
collector.start();

startFleetSyncPush(db, {
	syncUrl: config.fleetSyncUrl,
	secret: config.secret,
	intervalMs: config.fleetSyncIntervalMs,
});

const server = http.createServer(createApiHandler(db, config.secret));
server.listen(config.port, () => {
	console.log(
		`Rail fleet store listening on :${config.port} (poll ${config.pollMs}ms)`,
	);
});

process.on("SIGINT", () => {
	collector.stop();
	server.close();
	db.close();
	process.exit(0);
});