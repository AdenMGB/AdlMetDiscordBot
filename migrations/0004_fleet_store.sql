CREATE TABLE IF NOT EXISTS fleet_vehicles (
	set_id TEXT PRIMARY KEY,
	body_class TEXT NOT NULL,
	chassis TEXT NOT NULL,
	first_seen_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	last_lat REAL,
	last_lon REAL,
	last_bearing REAL,
	last_speed_mps REAL,
	last_route_id TEXT,
	last_trip_id TEXT,
	last_headsign TEXT,
	last_stop_id TEXT,
	last_status TEXT NOT NULL DEFAULT 'IN SERVICE'
);

CREATE TABLE IF NOT EXISTS fleet_position_samples (
	id INTEGER PRIMARY KEY,
	set_id TEXT NOT NULL,
	trip_id TEXT,
	route_id TEXT,
	lat REAL NOT NULL,
	lon REAL NOT NULL,
	bearing REAL,
	speed_mps REAL,
	recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fleet_samples_set_time ON fleet_position_samples(set_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_fleet_samples_time ON fleet_position_samples(recorded_at);
CREATE INDEX IF NOT EXISTS idx_fleet_samples_route_time ON fleet_position_samples(route_id, recorded_at);

CREATE TABLE IF NOT EXISTS fleet_trip_records (
	id INTEGER PRIMARY KEY,
	set_id TEXT NOT NULL,
	trip_id TEXT,
	route_id TEXT,
	headsign TEXT,
	started_at TEXT NOT NULL,
	ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_fleet_trips_set ON fleet_trip_records(set_id, started_at DESC);

CREATE TABLE IF NOT EXISTS fleet_collector_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);