#!/usr/bin/env tsx
/**
 * Import fleet catalog rows from a JSON file (e.g. Playwright MCP scrape).
 * Shape: { rows: SabuFleetRow[] } or SabuFleetRow[]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isoUtcNow } from "@metro-mate/rail-fleet-core";
import { loadEnv } from "../src/env.js";
import { openFleetDb } from "../src/db.js";
import {
	ensureCatalogColumns,
	type SabuFleetRow,
	upsertSabuCatalogRow,
} from "../src/sabu-catalog.js";
import { pushFleetSyncSnapshot } from "../src/sync-push.js";

async function main(): Promise<void> {
	const root = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
	);
	process.chdir(root);

	const jsonPath =
		process.argv[2] ??
		process.env.SABU_JSON_PATH ??
		path.join(root, "data", "sabu-scrape.json");
	if (!fs.existsSync(jsonPath)) {
		console.error(`Missing JSON: ${jsonPath}`);
		process.exit(1);
	}

	const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as
		| { rows?: SabuFleetRow[] }
		| SabuFleetRow[];
	const rows = Array.isArray(raw) ? raw : (raw.rows ?? []);

	const env = loadEnv();
	const db = openFleetDb(env.dbPath);
	ensureCatalogColumns(db);
	const importedAt = isoUtcNow();

	let upserted = 0;
	for (const row of rows) {
		if (upsertSabuCatalogRow(db, row, importedAt)) upserted++;
	}

	db.prepare(
		`INSERT INTO collector_meta (key, value) VALUES ('sabu_catalog_import_at', @v)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	).run({ v: importedAt });

	console.log(`Imported ${upserted} sets from ${jsonPath}`);

	if (process.env.SABU_PUSH_SYNC === "1") {
		await pushFleetSyncSnapshot(db, env.fleetSyncUrl, env.secret);
		console.log("Pushed fleet sync to Worker.");
	}

	db.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});