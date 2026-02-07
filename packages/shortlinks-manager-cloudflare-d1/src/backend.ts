import { type IBaseUrlRecord, type IShortLinksManagerBackend } from "@potonz/shortlinks-manager";

import { formatDbDateTime } from "./utils";

export interface IShortLinksManagerD1Backend extends IShortLinksManagerBackend {
    setupTables: () => Promise<void>;
}

export function createD1Backend(db: D1Database): IShortLinksManagerD1Backend {
    let stmt_getShortIdsExist: D1PreparedStatement | null = null;
    let stmt_createShortLinkMap: D1PreparedStatement | null = null;
    let stmt_updateShortLinkLastAccessed: D1PreparedStatement | null = null;
    let stmt_cleanUnusedLinks: D1PreparedStatement | null = null;
    let stmt_removeShortLink: D1PreparedStatement | null = null;

    let stmt_addBaseUrl: D1PreparedStatement | null = null;
    let stmt_removeBaseUrl: D1PreparedStatement | null = null;
    let stmt_listBaseUrls: D1PreparedStatement | null = null;
    let stmt_getBaseUrlId: D1PreparedStatement | null = null;
    let stmt_getLinkWithBaseUrl: D1PreparedStatement | null = null;

    return {
        async setupTables() {
            await db.prepare(`
CREATE TABLE IF NOT EXISTS sl_base_urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_url TEXT NOT NULL UNIQUE,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sl_links_map (
    short_id VARCHAR(255) NOT NULL,
    target_url VARCHAR(65535) NOT NULL,
    base_url_id INTEGER REFERENCES sl_base_urls(id),
    last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (short_id, base_url_id)
);

CREATE INDEX IF NOT EXISTS idx_sl_links_map_last_accessed_at ON sl_links_map(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_sl_links_map_base_url_id ON sl_links_map(base_url_id);
CREATE INDEX IF NOT EXISTS idx_sl_links_map_short_id_base_url ON sl_links_map(short_id, base_url_id);

PRAGMA optimize;
`).run();
        },

        async getTargetUrl(shortId: string, baseUrlId: number | null): Promise<string | null> {
            if (!stmt_getLinkWithBaseUrl) {
                if (baseUrlId === null) {
                    stmt_getLinkWithBaseUrl = db.prepare("SELECT target_url FROM sl_links_map WHERE short_id = ? AND base_url_id IS NULL LIMIT 1");
                }
                else {
                    stmt_getLinkWithBaseUrl = db.prepare("SELECT target_url FROM sl_links_map WHERE short_id = ? AND base_url_id = ? LIMIT 1");
                }
            }

            const result = baseUrlId === null
                ? await stmt_getLinkWithBaseUrl.bind(shortId).first<{ target_url: string }>()
                : await stmt_getLinkWithBaseUrl.bind(shortId, baseUrlId).first<{ target_url: string }>();
            return result?.target_url ?? null;
        },

        async createShortLink(shortId: string, targetUrl: string, baseUrlId: number | null): Promise<void> {
            if (!stmt_createShortLinkMap) {
                if (baseUrlId === null) {
                    stmt_createShortLinkMap = db.prepare("INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL)");
                }
                else {
                    stmt_createShortLinkMap = db.prepare("INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, ?)");
                }
            }

            if (baseUrlId === null) {
                await stmt_createShortLinkMap.bind(shortId, targetUrl).run();
            }
            else {
                await stmt_createShortLinkMap.bind(shortId, targetUrl, baseUrlId).run();
            }
        },

        async checkShortIdsExist(shortIds: string[], baseUrlId: number | null): Promise<string[]> {
            if (!stmt_getShortIdsExist) {
                const placeholders = Array.from("?".repeat(shortIds.length)).join(",");
                const whereClause = baseUrlId === null
                    ? `short_id IN (${placeholders}) AND base_url_id IS NULL`
                    : `short_id IN (${placeholders}) AND base_url_id = ?`;
                stmt_getShortIdsExist = db.prepare(`SELECT short_id FROM sl_links_map WHERE ${whereClause}`);
            }

            const result = await stmt_getShortIdsExist.bind(...(baseUrlId === null ? shortIds : [...shortIds, baseUrlId])).all<{ short_id: string }>();
            if (!result.success) {
                return [];
            }

            return result.results.map(r => r.short_id);
        },

        async updateShortLinkLastAccessTime(shortId: string, baseUrlId: number | null, time: number | Date = new Date()): Promise<void> {
            if (!stmt_updateShortLinkLastAccessed) {
                const whereClause = baseUrlId === null
                    ? "last_accessed_at = ? WHERE short_id = ? AND base_url_id IS NULL"
                    : "last_accessed_at = ? WHERE short_id = ? AND base_url_id = ?";
                stmt_updateShortLinkLastAccessed = db.prepare(`UPDATE sl_links_map SET ${whereClause}`);
            }

            let _time = time;
            if (typeof _time === "number") {
                _time = new Date(_time);
            }

            if (baseUrlId === null) {
                await stmt_updateShortLinkLastAccessed.bind(formatDbDateTime(_time), shortId).run();
            }
            else {
                await stmt_updateShortLinkLastAccessed.bind(formatDbDateTime(_time), shortId, baseUrlId).run();
            }
        },

        async cleanUnusedLinks(maxAge: number): Promise<Array<{ shortId: string; baseUrlId: number | null }>> {
            if (!stmt_cleanUnusedLinks) {
                stmt_cleanUnusedLinks = db.prepare("DELETE FROM sl_links_map WHERE last_accessed_at < datetime(CURRENT_TIMESTAMP, ?) RETURNING short_id, base_url_id");
            }

            const result = await stmt_cleanUnusedLinks.bind(`-${maxAge} days`).all<{ short_id: string; base_url_id: number | null }>();

            return result.results.map(r => ({
                shortId: r.short_id,
                baseUrlId: r.base_url_id,
            }));
        },

        async removeShortLink(shortId: string, baseUrlId: number | null): Promise<void> {
            if (!stmt_removeShortLink) {
                if (baseUrlId === null) {
                    stmt_removeShortLink = db.prepare("DELETE FROM sl_links_map WHERE short_id = ? AND base_url_id IS NULL");
                }
                else {
                    stmt_removeShortLink = db.prepare("DELETE FROM sl_links_map WHERE short_id = ? AND base_url_id = ?");
                }
            }

            if (baseUrlId === null) {
                await stmt_removeShortLink.bind(shortId).run();
            }
            else {
                await stmt_removeShortLink.bind(shortId, baseUrlId).run();
            }
        },

        baseUrl: {
            async add(baseUrl: string): Promise<void> {
                if (!stmt_addBaseUrl) {
                    stmt_addBaseUrl = db.prepare("INSERT OR IGNORE INTO sl_base_urls (base_url) VALUES (?)");
                }
                await stmt_addBaseUrl.bind(baseUrl).run();
            },

            async remove(id: number): Promise<void> {
                if (!stmt_removeBaseUrl) {
                    stmt_removeBaseUrl = db.prepare("DELETE FROM sl_base_urls WHERE id = ?");
                }
                await stmt_removeBaseUrl.bind(id).run();
            },

            async list(includeInactive?: boolean): Promise<IBaseUrlRecord[]> {
                if (!stmt_listBaseUrls) {
                    const whereClause = includeInactive ? "1=1" : "is_active = 1";
                    stmt_listBaseUrls = db.prepare(`SELECT id, base_url, is_active FROM sl_base_urls WHERE ${whereClause}`);
                }
                const result = await stmt_listBaseUrls.all<{ id: number; base_url: string; is_active: number }>();
                return result.results.map(r => ({
                    id: r.id,
                    baseUrl: r.base_url,
                    isActive: r.is_active === 1,
                }));
            },

            async getId(baseUrl: string): Promise<number> {
                if (!stmt_getBaseUrlId) {
                    stmt_getBaseUrlId = db.prepare("SELECT id FROM sl_base_urls WHERE base_url = ? LIMIT 1");
                }
                const result = await stmt_getBaseUrlId.bind(baseUrl).first<{ id: number }>();
                if (!result) {
                    throw new Error(`Base URL not found: ${baseUrl}`);
                }
                return result.id;
            },
        },
    };
}
