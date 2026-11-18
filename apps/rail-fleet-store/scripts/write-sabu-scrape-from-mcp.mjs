#!/usr/bin/env node
/** Reads one line of JSON { rowsJson: string } from stdin → writes data/sabu-scrape.json */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const line = Buffer.concat(chunks).toString("utf8").trim();
const { rowsJson } = JSON.parse(line || "{}");
if (!rowsJson) {
	console.error("Expected JSON line with rowsJson field on stdin");
	process.exit(1);
}
const out = path.join(root, "data", "sabu-scrape.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, rowsJson);
console.log(`Wrote ${out}`);