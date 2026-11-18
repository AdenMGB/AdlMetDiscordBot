import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const SCHEMA = fs.readFileSync(
	path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql"),
	"utf8",
);

export type FleetDb = Database.Database;

export function openFleetDb(dbPath: string): FleetDb {
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.exec(SCHEMA);
	return db;
}

export type VehicleRow = {
	set_id: string;
	body_class: string;
	chassis: string;
	first_seen_at: string;
	last_seen_at: string;
	last_lat: number | null;
	last_lon: number | null;
	last_bearing: number | null;
	last_speed_mps: number | null;
	last_route_id: string | null;
	last_trip_id: string | null;
	last_headsign: string | null;
	last_stop_id: string | null;
	last_status: string;
};

export type TripRecordRow = {
	id: number;
	set_id: string;
	trip_id: string | null;
	route_id: string | null;
	headsign: string | null;
	started_at: string;
	ended_at: string | null;
};