import { type IBaseUrlRecord, type IShortLinksManagerBackend } from "@potonz/shortlinks-manager";
import postgres from "postgres";

export interface IShortLinksManagerPostgresBackend extends IShortLinksManagerBackend {
    setupTables: () => Promise<void>;
}

/**
 * Create a PostgreSQL backend for short links manager using postgres.js
 * @param connectionUri PostgreSQL connection URI (e.g., "postgres://user:pass@localhost/dbname")
 * @returns IShortLinksManagerPostgresBackend implementation
 */
export function createPostgresBackend(connectionUri: string): IShortLinksManagerPostgresBackend {
    const sql = postgres(connectionUri);

    return {
        async setupTables() {
            await sql`
                CREATE TABLE IF NOT EXISTS sl_base_urls (
                    id SERIAL PRIMARY KEY,
                    base_url VARCHAR(255) NOT NULL UNIQUE,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `;

            await sql`
                CREATE TABLE IF NOT EXISTS sl_links_map (
                    id SERIAL PRIMARY KEY,
                    short_id VARCHAR(255) NOT NULL,
                    target_url TEXT NOT NULL,
                    base_url_id INT NULL,
                    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uk_short_id_base_url UNIQUE (short_id, base_url_id),
                    FOREIGN KEY (base_url_id) REFERENCES sl_base_urls(id) ON DELETE SET NULL
                )
            `;

            await sql`
                CREATE INDEX IF NOT EXISTS idx_sl_links_map_last_accessed_at 
                ON sl_links_map(last_accessed_at)
            `;

            await sql`
                CREATE INDEX IF NOT EXISTS idx_sl_links_map_base_url_id
                ON sl_links_map(base_url_id)
            `;

            await sql`
                CREATE INDEX IF NOT EXISTS idx_sl_links_map_short_id_base_url
                ON sl_links_map(short_id, base_url_id)
            `;
        },

        async getTargetUrl(shortId: string, baseUrlId: number | null): Promise<string | null> {
            const result = baseUrlId === null
                ? await sql<{ target_url: string }[]>`
                    SELECT target_url 
                    FROM sl_links_map 
                    WHERE short_id = ${shortId} AND base_url_id IS NULL
                    LIMIT 1
                `
                : await sql<{ target_url: string }[]>`
                    SELECT target_url 
                    FROM sl_links_map 
                    WHERE short_id = ${shortId} AND base_url_id = ${baseUrlId}
                    LIMIT 1
                `;

            return result[0]?.target_url ?? null;
        },

        async createShortLink(shortId: string, targetUrl: string, baseUrlId: number | null): Promise<void> {
            await sql`
                INSERT INTO sl_links_map (short_id, target_url, base_url_id) 
                VALUES (${shortId}, ${targetUrl}, ${baseUrlId})
            `;
        },

        async checkShortIdsExist(shortIds: string[], baseUrlId: number | null): Promise<string[]> {
            if (shortIds.length === 0) {
                return [];
            }

            const whereClause = baseUrlId === null
                ? sql`short_id IN ${sql(shortIds)} AND base_url_id IS NULL`
                : sql`short_id IN ${sql(shortIds)} AND base_url_id = ${baseUrlId}`;

            const result = await sql<{ short_id: string }[]>`
                SELECT short_id 
                FROM sl_links_map 
                WHERE ${whereClause}
            `;

            return result.map((r: { short_id: string }) => r.short_id);
        },

        async updateShortLinkLastAccessTime(shortId: string, baseUrlId: number | null, time: number | Date = new Date()): Promise<void> {
            let _time = time;
            if (typeof _time === "number") {
                _time = new Date(_time);
            }

            const whereClause = baseUrlId === null
                ? sql`WHERE short_id = ${shortId} AND base_url_id IS NULL`
                : sql`WHERE short_id = ${shortId} AND base_url_id = ${baseUrlId}`;

            await sql`
                UPDATE sl_links_map 
                SET last_accessed_at = ${_time} 
                ${whereClause}
            `;
        },

        async cleanUnusedLinks(maxAge: number): Promise<Array<{ shortId: string; baseUrlId: number | null }>> {
            const result = await sql<{ short_id: string; base_url_id: number | null }[]>`
                DELETE FROM sl_links_map 
                WHERE last_accessed_at < NOW() - make_interval(days => ${maxAge})
                RETURNING short_id, base_url_id
            `;

            return result.map(r => ({
                shortId: r.short_id,
                baseUrlId: r.base_url_id,
            }));
        },

        async removeShortLink(shortId: string, baseUrlId: number | null): Promise<void> {
            const whereClause = baseUrlId === null
                ? sql`WHERE short_id = ${shortId} AND base_url_id IS NULL`
                : sql`WHERE short_id = ${shortId} AND base_url_id = ${baseUrlId}`;

            await sql`
                DELETE FROM sl_links_map 
                ${whereClause}
            `;
        },

        async updateShortLink(shortId: string, targetUrl: string, baseUrlId: number | null): Promise<boolean> {
            const whereClause = baseUrlId === null
                ? sql`WHERE short_id = ${shortId} AND base_url_id IS NULL`
                : sql`WHERE short_id = ${shortId} AND base_url_id = ${baseUrlId}`;

            const result = await sql`
                UPDATE sl_links_map 
                SET target_url = ${targetUrl}
                ${whereClause}
            `;

            return result.count > 0;
        },

        baseUrl: {
            async add(baseUrl: string): Promise<void> {
                await sql`
                    INSERT INTO sl_base_urls (base_url) 
                    VALUES (${baseUrl})
                    ON CONFLICT (base_url) DO NOTHING
                `;
            },

            async remove(id: number): Promise<void> {
                await sql`
                    UPDATE sl_base_urls SET is_active = FALSE
                    WHERE id = ${id}
                `;
            },

            async list(includeInactive?: boolean): Promise<IBaseUrlRecord[]> {
                const result = includeInactive
                    ? await sql<{ id: number; base_url: string; is_active: boolean }[]>`
                        SELECT id, base_url, is_active FROM sl_base_urls
                    `
                    : await sql<{ id: number; base_url: string; is_active: boolean }[]>`
                        SELECT id, base_url, is_active FROM sl_base_urls WHERE is_active = TRUE
                    `;

                return result.map(r => ({
                    id: r.id,
                    baseUrl: r.base_url,
                    isActive: r.is_active,
                }));
            },

            async getId(baseUrl: string): Promise<number> {
                const result = await sql<{ id: number }[]>`
                    SELECT id FROM sl_base_urls WHERE base_url = ${baseUrl} LIMIT 1
                `;
                if (result.length === 0) {
                    throw new Error(`Base URL not found: ${baseUrl}`);
                }
                return result[0].id;
            },
        },
    };
}
