import { type IShortLinksManagerBackend } from "@potonz/shortlinks-manager";

import { formatDbDateTime } from "./utils";

export interface IShortLinksManagerD1Backend extends IShortLinksManagerBackend {
    setupTables: () => Promise<void>;
}

export function createD1Backend(db: D1Database): IShortLinksManagerD1Backend {
    let stmt_getLink: D1PreparedStatement | null = null;
    let stmt_getShortIdsExist: D1PreparedStatement | null = null;
    let stmt_createShortLinkMap: D1PreparedStatement | null = null;
    let stmt_updateShortLinkLastAccessed: D1PreparedStatement | null = null;
    let stmt_cleanUnusedLinks: D1PreparedStatement | null = null;

    return {
        async setupTables() {
            await db.prepare(`
CREATE TABLE IF NOT EXISTS sl_links_map (
    short_id VARCHAR(255) NOT NULL PRIMARY KEY,
    target_url VARCHAR(65535) NOT NULL,
    last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sl_links_map_last_accessed_at ON sl_links_map(last_accessed_at);

PRAGMA optimize;
`).run();
        },

        async getTargetUrl(shortId: string): Promise<string | null> {
            if (!stmt_getLink) {
                stmt_getLink = db.prepare("SELECT target_url FROM sl_links_map WHERE short_id = ? LIMIT 1");
            }

            const result = await stmt_getLink.bind(shortId).first<{ target_url: string }>();
            return result?.target_url ?? null;
        },

        async createShortLink(shortId: string, targetUrl: string): Promise<void> {
            if (!stmt_createShortLinkMap) {
                stmt_createShortLinkMap = db.prepare("INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)");
            }

            await stmt_createShortLinkMap.bind(shortId, targetUrl).run();
        },

        async checkShortIdsExist(shortIds: string[]): Promise<string[]> {
            if (!stmt_getShortIdsExist) {
                const placeholders = Array.from("?".repeat(shortIds.length)).join(",");
                stmt_getShortIdsExist = db.prepare(`SELECT short_id FROM sl_links_map WHERE short_id IN (${placeholders})`);
            }

            const result = await stmt_getShortIdsExist.bind(...shortIds).all<{ short_id: string }>();
            if (!result.success) {
                return [];
            }

            return result.results.map(r => r.short_id);
        },

        async updateShortLinkLastAccessTime(shortId: string, time: number | Date = new Date()): Promise<void> {
            if (!stmt_updateShortLinkLastAccessed) {
                stmt_updateShortLinkLastAccessed = db.prepare("UPDATE sl_links_map SET last_accessed_at = ? WHERE short_id = ?");
            }

            let _time = time;
            if (typeof _time === "number") {
                _time = new Date(_time);
            }

            await stmt_updateShortLinkLastAccessed.bind(formatDbDateTime(_time), shortId).run();
        },

        async cleanUnusedLinks(maxAge: number): Promise<string[]> {
            if (!stmt_cleanUnusedLinks) {
                stmt_cleanUnusedLinks = db.prepare("DELETE FROM sl_links_map WHERE last_accessed_at < datetime(CURRENT_TIMESTAMP, ?) RETURNING short_id");
            }

            const result = await stmt_cleanUnusedLinks.bind(`-${maxAge} days`).all<{ short_id: string }>();

            return result.results.map(r => r.short_id);
        },
    };
}
