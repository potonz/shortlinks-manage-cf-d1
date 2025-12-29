-- Migration number: 0001 	 2025-12-27T05:57:04.357Z

CREATE TABLE IF NOT EXISTS sl_links_map (
    short_id VARCHAR(255) NOT NULL PRIMARY KEY,
    target_url VARCHAR(65535) NOT NULL,
    last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sl_links_map_last_accessed_at ON sl_links_map(last_accessed_at);

PRAGMA optimize;