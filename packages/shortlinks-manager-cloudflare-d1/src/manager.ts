import { type IShortLinksManagerBackend } from "@potonz/shortlinks-manager";

export class ShortLinksManagerCfD1 implements IShortLinksManagerBackend {
    private db: D1Database;

    private stmt_getLink: D1PreparedStatement | null = null;
    private stmt_getShortIdsExist: D1PreparedStatement | null = null;
    private stmt_createShortLinkMap: D1PreparedStatement | null = null;
    private stmt_updateShortLinkLastAccessed: D1PreparedStatement | null = null;
    private stmt_cleanUnusedLinks: D1PreparedStatement | null = null;

    public constructor(db: D1Database) {
        this.db = db;
    }

    init() { }

    /**
     * Get a target URL from the given short ID
     * @param shortId
     * @returns the target URL as string or null if not found
     * @throws Error if failed
     */
    public async getTargetUrl(shortId: string): Promise<string | null> {
        if (!this.stmt_getLink) {
            this.stmt_getLink = this.db.prepare("SELECT target_url FROM sl_links_map WHERE short_id = ? LIMIT 1");
        }

        const result = await this.stmt_getLink.bind(shortId).first<{ target_url: string }>();
        return result?.target_url ?? null;
    }

    public async createShortLink(shortId: string, targetUrl: string): Promise<void> {
        if (!this.stmt_createShortLinkMap) {
            this.stmt_createShortLinkMap = this.db.prepare("INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)");
        }

        await this.stmt_createShortLinkMap.bind(shortId, targetUrl).run();
    }

    public async checkShortIdsExist(shortIds: string[]): Promise<string[]> {
        if (!this.stmt_getShortIdsExist) {
            const placeholders = Array.from("?".repeat(shortIds.length)).join(",");
            this.stmt_getShortIdsExist = this.db.prepare(`SELECT short_id FROM sl_links_map WHERE short_id IN (${placeholders})`);
        }

        const result = await this.stmt_getShortIdsExist.bind(...shortIds).all<{ short_id: string }>();
        if (!result.success) {
            return [];
        }

        return result.results.map(r => r.short_id);
    }

    /**
     * Update last accessed time to current timestamp
     * @param shortId
     */
    public async updateShortLinkLastAccessTime(shortId: string): Promise<void> {
        if (!this.stmt_updateShortLinkLastAccessed) {
            this.stmt_updateShortLinkLastAccessed = this.db.prepare("UPDATE sl_links_map SET last_accessed_at = CURRENT_TIMESTAMP WHERE short_id = ?");
        }

        await this.stmt_updateShortLinkLastAccessed.bind(shortId).run();
    }

    /**
     * Remove unused links that are older than the given maxAge
     * @param maxAge number of days the record should be kept
     */
    public async cleanUnusedLinks(maxAge: number): Promise<void> {
        if (!this.stmt_cleanUnusedLinks) {
            this.stmt_cleanUnusedLinks = this.db.prepare("DELETE FROM sl_links_map WHERE last_accessed_at < datetime(CURRENT_TIMESTAMP, ?)");
        }

        await this.stmt_cleanUnusedLinks.bind(`-${maxAge} days`).run();
    }
}
