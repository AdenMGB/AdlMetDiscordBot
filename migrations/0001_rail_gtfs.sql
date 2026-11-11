CREATE TABLE IF NOT EXISTS rail_stations (
	line_id TEXT NOT NULL,
	stop_id TEXT NOT NULL,
	name TEXT NOT NULL,
	PRIMARY KEY (line_id, stop_id)
);

CREATE INDEX IF NOT EXISTS idx_rail_stations_line ON rail_stations(line_id);

CREATE TABLE IF NOT EXISTS rail_departures (
	stop_id TEXT NOT NULL,
	depart_at INTEGER NOT NULL,
	headsign TEXT NOT NULL,
	direction_kind TEXT NOT NULL CHECK (direction_kind IN ('city', 'outbound')),
	route_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_departures_stop_time ON rail_departures(stop_id, depart_at);

CREATE TABLE IF NOT EXISTS gtfs_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
