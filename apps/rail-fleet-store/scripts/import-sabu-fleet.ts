#!/usr/bin/env tsx
/**
 * Catalog import from SA Bus Tracker rail fleet listing (Playwright).
 * Respect rate limits — set SABU_PAGE_DELAY_MS (default 2500).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { isoUtcNow } from "@metro-mate/rail-fleet-core";
import { loadEnv } from "../src/env.js";
import { openFleetDb } from "../src/db.js";
import {
	ensureCatalogColumns,
	scrapeRowsFromPageHtml,
	upsertSabuCatalogRow,
	type SabuFleetRow,
} from "../src/sabu-catalog.js";
import { pushFleetSyncSnapshot } from "../src/sync-push.js";

const COMPANY = "Rail Commissioner";
const PAGE_DELAY_MS = Number.parseInt(process.env.SABU_PAGE_DELAY_MS ?? "2500", 10);
const MAX_PAGES = Number.parseInt(process.env.SABU_MAX_PAGES ?? "20", 10);

function listingUrl(page: number): string {
	const q = new URLSearchParams({
		company_id: COMPANY,
		vehicle_filter: "",
		route_filter: "",
		page: String(page),
	});
	return `https://www.sabustracker.com/vehicle_history.php?${q.toString()}`;
}

async function launchImportBrowser() {
	const headless = process.env.SABU_HEADED !== "1";
	const channel = process.env.SABU_BROWSER_CHANNEL;
	const base = { headless };
	if (channel) {
		return chromium.launch({
			...base,
			channel: channel as "msedge" | "chrome" | "chrome-beta",
		});
	}
	try {
		return await chromium.launch(base);
	} catch (err) {
		console.warn("Bundled Chromium failed; retrying with msedge.", err);
		return chromium.launch({ ...base, channel: "msedge" });
	}
}

async function scrapeWithPlaywright(): Promise<SabuFleetRow[]> {
	const browser = await launchImportBrowser();
	const ctx = await browser.newContext({
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		locale: "en-AU",
	});
	const page = await ctx.newPage();
	const all: SabuFleetRow[] = [];

	let pageNum = 1;
	let pagesVisited = 0;

	while (pageNum <= MAX_PAGES && pagesVisited < MAX_PAGES) {
		pagesVisited++;
		const url = listingUrl(pageNum);
		console.log(`Loading page ${pageNum}: ${url}`);
		const response = await page.goto(url, {
			waitUntil: "domcontentloaded",
			timeout: 90_000,
		});
		const status = response?.status() ?? 0;
		const title = await page.title();
		if (status === 403 || title.includes("Just a moment")) {
			console.error(
				"Blocked by site protection. Try SABU_HEADED=1 once to clear the challenge.",
			);
			break;
		}
		await page.waitForTimeout(1500);

		const scraped = await page.evaluate(() => {
			const out: {
				setId: string;
				chassis: string;
				bodyClass: string;
				lastSeenRaw: string;
				statusText: string;
			}[] = [];
			for (const tr of document.querySelectorAll("table tbody tr")) {
				const cells = [...tr.querySelectorAll("td")];
				if (cells.length < 3) continue;
				const setText = (cells[0].textContent ?? "").trim();
				const setId = setText.match(/\b(3\d{3}|4\d{3})\b/)?.[1];
				if (!setId) continue;
				const details = (cells[1].innerText ?? cells[1].textContent ?? "").trim();
				const detailLines = details
					.split("\n")
					.map((s) => s.trim())
					.filter(Boolean);
				const chassis =
					detailLines.find((l) => /comeng|bombardier|clyde/i.test(l)) ??
					detailLines[0] ??
					"";
				const bodyClass =
					detailLines.find((l) => /class/i.test(l)) ?? detailLines[1] ?? "";
				const lastSeen =
					details.match(
						/Last Seen\s*(\d{2}-\d{2}-\d{4}\s+\d{1,2}:\d{2}:\d{2})/i,
					)?.[1] ?? "";
				const statusText = (cells[2].textContent ?? "").trim();
				out.push({ setId, chassis, bodyClass, lastSeenRaw: lastSeen, statusText });
			}
			return out;
		});

		if (scraped.length === 0) {
			const html = await page.content();
			all.push(...scrapeRowsFromPageHtml(html));
			console.warn(`DOM scrape empty on page ${pageNum}; tried HTML fallback.`);
		} else {
			all.push(...scraped);
		}
		console.log(`  → ${scraped.length} rows`);

		const nextHref = await page
			.locator('a:has-text("Next Page"), a:has-text("Next")')
			.first()
			.getAttribute("href")
			.catch(() => null);
		if (!nextHref) break;
		const nextPage = Number.parseInt(
			new URL(nextHref, url).searchParams.get("page") ?? "0",
			10,
		);
		if (!Number.isFinite(nextPage) || nextPage <= pageNum) break;
		pageNum = nextPage;
		await page.waitForTimeout(PAGE_DELAY_MS);
	}

	await browser.close();
	return all;
}

async function main(): Promise<void> {
	const root = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
	);
	process.chdir(root);
	const env = loadEnv();
	const db = openFleetDb(env.dbPath);
	ensureCatalogColumns(db);

	const importedAt = isoUtcNow();
	const rows = await scrapeWithPlaywright();
	const unique = new Map<string, SabuFleetRow>();
	for (const row of rows) unique.set(row.setId, row);

	let upserted = 0;
	for (const row of unique.values()) {
		if (upsertSabuCatalogRow(db, row, importedAt)) upserted++;
	}

	db.prepare(
		`INSERT INTO collector_meta (key, value) VALUES ('sabu_catalog_import_at', @v)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	).run({ v: importedAt });

	console.log(`Imported ${upserted} sets from SA Bus Tracker catalog.`);

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