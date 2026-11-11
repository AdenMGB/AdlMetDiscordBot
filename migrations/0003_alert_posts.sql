CREATE TABLE IF NOT EXISTS posted_alerts (
	alert_id TEXT PRIMARY KEY,
	posted_at INTEGER NOT NULL,
	summary TEXT NOT NULL
);
