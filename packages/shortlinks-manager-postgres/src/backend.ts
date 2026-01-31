import { type IShortLinksManagerBackend } from "@potonz/shortlinks-manager";
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
                CREATE TABLE IF NOT EXISTS sl_links_map (
                    short_id VARCHAR(255) NOT NULL PRIMARY KEY,
                    target_url TEXT NOT NULL,
                    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `;

            await sql`
                CREATE INDEX IF NOT EXISTS idx_sl_links_map_last_accessed_at 
                ON sl_links_map(last_accessed_at)
            `;
        },

        async getTargetUrl(shortId: string): Promise<string | null> {
            const result = await sql<{ target_url: string }[]>`
                SELECT target_url 
                FROM sl_links_map 
                WHERE short_id = ${shortId} 
                LIMIT 1
            `;

            return result[0]?.target_url ?? null;
        },

        async createShortLink(shortId: string, targetUrl: string): Promise<void> {
            await sql`
                INSERT INTO sl_links_map (short_id, target_url) 
                VALUES (${shortId}, ${targetUrl})
            `;
        },

        async checkShortIdsExist(shortIds: string[]): Promise<string[]> {
            if (shortIds.length === 0) {
                return [];
            }

            const result = await sql<{ short_id: string }[]>`
                SELECT short_id 
                FROM sl_links_map 
                WHERE short_id IN ${sql(shortIds)}
            `;

            return result.map((r: { short_id: string }) => r.short_id);
        },

        async updateShortLinkLastAccessTime(shortId: string, time: number | Date = new Date()): Promise<void> {
            let _time = time;
            if (typeof _time === "number") {
                _time = new Date(_time);
            }

            await sql`
                UPDATE sl_links_map 
                SET last_accessed_at = ${_time} 
                WHERE short_id = ${shortId}
            `;
        },

        async cleanUnusedLinks(maxAge: number): Promise<string[]> {
            const result = await sql<{ short_id: string }[]>`
                DELETE FROM sl_links_map 
                WHERE last_accessed_at < NOW() - make_interval(days => ${maxAge})
                RETURNING short_id
            `;

            return result.map((r: { short_id: string }) => r.short_id);
        },

        async removeShortLink(shortId: string): Promise<void> {
            await sql`
                DELETE FROM sl_links_map 
                WHERE short_id = ${shortId}
            `;
        },
    };
}
