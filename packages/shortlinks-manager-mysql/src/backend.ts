import { type IShortLinksManagerBackend } from "@potonz/shortlinks-manager";
import mysql from "mysql2/promise";

export interface IShortLinksManagerMysqlBackend extends IShortLinksManagerBackend {
    setupTables: () => Promise<void>;
}

interface IConnectionConfig {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    [key: string]: unknown;
}

interface ITargetUrlRow extends mysql.RowDataPacket {
    target_url: string;
}

interface IShortIdRow extends mysql.RowDataPacket {
    short_id: string;
}

function parseConnectionUri(uri: string): IConnectionConfig {
    const url = new URL(uri);
    return {
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : undefined,
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1),
    };
}

/**
 * Create a MySQL backend for short links manager using mysql2
 * @param connection Connection URI string (e.g., "mysql://user:pass@localhost/dbname") or connection config object
 * @returns IShortLinksManagerMysqlBackend implementation
 */
export function createMysqlBackend(connection: string | IConnectionConfig): IShortLinksManagerMysqlBackend {
    const config: IConnectionConfig = typeof connection === "string"
        ? parseConnectionUri(connection)
        : connection;

    return {
        async setupTables() {
            const connection = await mysql.createConnection(config);
            try {
                await connection.execute(`
                    CREATE TABLE IF NOT EXISTS sl_links_map (
                        short_id VARCHAR(255) NOT NULL PRIMARY KEY,
                        target_url TEXT NOT NULL,
                        last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                await connection.execute(`
                    CREATE INDEX IF NOT EXISTS idx_sl_links_map_last_accessed_at 
                    ON sl_links_map(last_accessed_at)
                `);
            }
            finally {
                await connection.end();
            }
        },

        async getTargetUrl(shortId: string): Promise<string | null> {
            const connection = await mysql.createConnection(config);
            try {
                const [rows] = await connection.execute<ITargetUrlRow[]>(
                    "SELECT target_url FROM sl_links_map WHERE short_id = ? LIMIT 1",
                    [shortId],
                );

                return rows[0]?.target_url ?? null;
            }
            finally {
                await connection.end();
            }
        },

        async createShortLink(shortId: string, targetUrl: string): Promise<void> {
            const connection = await mysql.createConnection(config);
            try {
                await connection.execute(
                    "INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)",
                    [shortId, targetUrl],
                );
            }
            finally {
                await connection.end();
            }
        },

        async checkShortIdsExist(shortIds: string[]): Promise<string[]> {
            if (shortIds.length === 0) {
                return [];
            }

            const connection = await mysql.createConnection(config);
            try {
                const placeholders = shortIds.map(() => "?").join(", ");
                const [rows] = await connection.execute<IShortIdRow[]>(
                    `SELECT short_id FROM sl_links_map WHERE short_id IN (${placeholders})`,
                    shortIds,
                );

                return rows.map(r => r.short_id);
            }
            finally {
                await connection.end();
            }
        },

        async updateShortLinkLastAccessTime(shortId: string, time: number | Date = new Date()): Promise<void> {
            let _time = time;
            if (typeof _time === "number") {
                _time = new Date(_time);
            }

            const connection = await mysql.createConnection(config);
            try {
                await connection.execute(
                    "UPDATE sl_links_map SET last_accessed_at = ? WHERE short_id = ?",
                    [_time, shortId],
                );
            }
            finally {
                await connection.end();
            }
        },

        async cleanUnusedLinks(maxAge: number): Promise<string[]> {
            const connection = await mysql.createConnection(config);
            try {
                await connection.execute(
                    "DELETE FROM sl_links_map WHERE last_accessed_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
                    [maxAge],
                );

                return [];
            }
            finally {
                await connection.end();
            }
        },

        async removeShortLink(shortId: string): Promise<void> {
            const connection = await mysql.createConnection(config);
            try {
                await connection.execute(
                    "DELETE FROM sl_links_map WHERE short_id = ?",
                    [shortId],
                );
            }
            finally {
                await connection.end();
            }
        },
    };
}
