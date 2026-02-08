import { type IBaseUrlRecord, type IShortLinksManagerBackend } from "@potonz/shortlinks-manager";
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

interface IBaseUrlRow extends mysql.RowDataPacket {
    id: number;
    base_url: string;
    is_active: number;
}

interface ICleanedLinkRow extends mysql.RowDataPacket {
    id: number;
    short_id: string;
    base_url_id: number | null;
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
                    CREATE TABLE IF NOT EXISTS sl_base_urls (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        base_url VARCHAR(255) NOT NULL UNIQUE,
                        is_active TINYINT(1) DEFAULT 1,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                await connection.execute(`
                    CREATE TABLE IF NOT EXISTS sl_links_map (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        short_id VARCHAR(255) NOT NULL,
                        target_url TEXT NOT NULL,
                        base_url_id INT NULL,
                        last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY uk_short_id_base_url (short_id, base_url_id),
                        FOREIGN KEY (base_url_id) REFERENCES sl_base_urls(id) ON DELETE SET NULL
                    )
                `);

                await connection.execute(`
                    CREATE INDEX idx_sl_links_map_last_accessed_at
                    ON sl_links_map(last_accessed_at)
                `);

                await connection.execute(`
                    CREATE INDEX idx_sl_links_map_base_url_id
                    ON sl_links_map(base_url_id)
                `);

                await connection.execute(`
                    CREATE INDEX idx_sl_links_map_short_id_base_url
                    ON sl_links_map(short_id, base_url_id)
                `);
            }
            finally {
                await connection.end();
            }
        },

        async getTargetUrl(shortId: string, baseUrlId: number | null): Promise<string | null> {
            const connection = await mysql.createConnection(config);
            try {
                const whereClause = baseUrlId === null
                    ? "short_id = ? AND base_url_id IS NULL"
                    : "short_id = ? AND base_url_id = ?";
                const params = baseUrlId === null ? [shortId] : [shortId, baseUrlId];

                const [rows] = await connection.execute<ITargetUrlRow[]>(
                    `SELECT target_url FROM sl_links_map WHERE ${whereClause} LIMIT 1`,
                    params,
                );

                return rows[0]?.target_url ?? null;
            }
            finally {
                await connection.end();
            }
        },

        async createShortLink(shortId: string, targetUrl: string, baseUrlId: number | null): Promise<void> {
            const connection = await mysql.createConnection(config);
            try {
                const columns = "(short_id, target_url, base_url_id)";
                const values = "VALUES (?, ?, ?)";
                const params = baseUrlId === null ? [shortId, targetUrl, null] : [shortId, targetUrl, baseUrlId];

                await connection.execute(
                    `INSERT INTO sl_links_map ${columns} ${values}`,
                    params,
                );
            }
            finally {
                await connection.end();
            }
        },

        async checkShortIdsExist(shortIds: string[], baseUrlId: number | null): Promise<string[]> {
            if (shortIds.length === 0) {
                return [];
            }

            const connection = await mysql.createConnection(config);
            try {
                const placeholders = shortIds.map(() => "?").join(", ");
                const whereClause = baseUrlId === null
                    ? `short_id IN (${placeholders}) AND base_url_id IS NULL`
                    : `short_id IN (${placeholders}) AND base_url_id = ?`;
                const params = baseUrlId === null ? shortIds : [...shortIds, baseUrlId];

                const [rows] = await connection.execute<IShortIdRow[]>(
                    `SELECT short_id FROM sl_links_map WHERE ${whereClause}`,
                    params,
                );

                return rows.map(r => r.short_id);
            }
            finally {
                await connection.end();
            }
        },

        async updateShortLinkLastAccessTime(shortId: string, baseUrlId: number | null, time: number | Date = new Date()): Promise<void> {
            let _time = time;
            if (typeof _time === "number") {
                _time = new Date(_time);
            }

            const connection = await mysql.createConnection(config);
            try {
                const whereClause = baseUrlId === null
                    ? "UPDATE sl_links_map SET last_accessed_at = ? WHERE short_id = ? AND base_url_id IS NULL"
                    : "UPDATE sl_links_map SET last_accessed_at = ? WHERE short_id = ? AND base_url_id = ?";
                const params = baseUrlId === null ? [_time, shortId] : [_time, shortId, baseUrlId];

                await connection.execute(whereClause, params);
            }
            finally {
                await connection.end();
            }
        },

        async cleanUnusedLinks(maxAge: number): Promise<Array<{ shortId: string; baseUrlId: number | null }>> {
            const connection = await mysql.createConnection(config);
            try {
                await connection.beginTransaction();

                try {
                    const [rows] = await connection.execute<ICleanedLinkRow[]>(
                        "SELECT id, short_id, base_url_id FROM sl_links_map WHERE last_accessed_at < DATE_SUB(NOW(), INTERVAL ? DAY) FOR UPDATE",
                        [maxAge],
                    );

                    if (rows.length > 0) {
                        const ids = rows.map(r => r.id);
                        const placeholders = ids.map(() => "?").join(",");
                        await connection.execute(
                            `DELETE FROM sl_links_map WHERE id IN (${placeholders})`,
                            ids,
                        );
                    }

                    await connection.commit();

                    return rows.map(r => ({
                        shortId: r.short_id,
                        baseUrlId: r.base_url_id,
                    }));
                }
                catch (error) {
                    await connection.rollback();
                    throw error;
                }
            }
            finally {
                await connection.end();
            }
        },

        async removeShortLink(shortId: string, baseUrlId: number | null): Promise<void> {
            const connection = await mysql.createConnection(config);
            try {
                const whereClause = baseUrlId === null
                    ? "DELETE FROM sl_links_map WHERE short_id = ? AND base_url_id IS NULL"
                    : "DELETE FROM sl_links_map WHERE short_id = ? AND base_url_id = ?";
                const params = baseUrlId === null ? [shortId] : [shortId, baseUrlId];

                await connection.execute(whereClause, params);
            }
            finally {
                await connection.end();
            }
        },

        async updateShortLink(shortId: string, targetUrl: string, baseUrlId: number | null): Promise<boolean> {
            const connection = await mysql.createConnection(config);
            try {
                const query = baseUrlId === null
                    ? "UPDATE sl_links_map SET target_url = ? WHERE short_id = ? AND base_url_id IS NULL"
                    : "UPDATE sl_links_map SET target_url = ? WHERE short_id = ? AND base_url_id = ?";
                const params = baseUrlId === null ? [targetUrl, shortId] : [targetUrl, shortId, baseUrlId];

                const [result] = await connection.execute<mysql.ResultSetHeader>(query, params);

                return result.affectedRows > 0;
            }
            finally {
                await connection.end();
            }
        },

        baseUrl: {
            async add(baseUrl: string): Promise<void> {
                const connection = await mysql.createConnection(config);
                try {
                    await connection.execute(
                        "INSERT IGNORE INTO sl_base_urls (base_url) VALUES (?)",
                        [baseUrl],
                    );
                }
                finally {
                    await connection.end();
                }
            },

            async remove(id: number): Promise<void> {
                const connection = await mysql.createConnection(config);
                try {
                    await connection.execute(
                        "UPDATE sl_base_urls SET is_active = 0 WHERE id = ?",
                        [id],
                    );
                }
                finally {
                    await connection.end();
                }
            },

            async list(includeInactive?: boolean): Promise<IBaseUrlRecord[]> {
                const connection = await mysql.createConnection(config);
                try {
                    const whereClause = includeInactive ? "1=1" : "is_active = 1";
                    const [rows] = await connection.execute<IBaseUrlRow[]>(
                        `SELECT id, base_url, is_active FROM sl_base_urls WHERE ${whereClause}`,
                    );
                    return rows.map(r => ({
                        id: r.id,
                        baseUrl: r.base_url,
                        isActive: r.is_active === 1,
                    }));
                }
                finally {
                    await connection.end();
                }
            },

            async getId(baseUrl: string): Promise<number> {
                const connection = await mysql.createConnection(config);
                try {
                    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
                        "SELECT id FROM sl_base_urls WHERE base_url = ? LIMIT 1",
                        [baseUrl],
                    );
                    if (rows.length === 0) {
                        throw new Error(`Base URL not found: ${baseUrl}`);
                    }
                    return rows[0].id;
                }
                finally {
                    await connection.end();
                }
            },
        },
    };
}
