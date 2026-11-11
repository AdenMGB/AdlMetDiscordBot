CREATE TABLE IF NOT EXISTS rail_stops (
	stop_id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	lat REAL NOT NULL,
	lon REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS rail_trips (
	trip_id TEXT PRIMARY KEY,
	route_id TEXT NOT NULL,
	headsign TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rail_trips_route ON rail_trips(route_id);

CREATE TABLE IF NOT EXISTS rail_trip_stops (
	trip_id TEXT NOT NULL,
	stop_sequence INTEGER NOT NULL,
	stop_id TEXT NOT NULL,
	PRIMARY KEY (trip_id, stop_sequence)
);

CREATE INDEX IF NOT EXISTS idx_rail_trip_stops_trip ON rail_trip_stops(trip_id);
