import { generateUniqueShortIds } from "./utils";

type OnShortIdLengthChangedCallback = (length: number) => unknown;

export class LinksManager {
    private initialised = false;

    private db: D1Database;
    private shortIdLength = 3;
    private onShortIdLengthChange: OnShortIdLengthChangedCallback;

    private stmt_getLink: D1PreparedStatement | null = null;
    private stmt_getShortIdsExist: D1PreparedStatement | null = null;
    private stmt_createShortLinkMap: D1PreparedStatement | null = null;

    public constructor(db: D1Database, shortIdLength: number, onShortIdLengthChange: OnShortIdLengthChangedCallback) {
        this.db = db;
        this.shortIdLength = shortIdLength;
        this.onShortIdLengthChange = onShortIdLengthChange;
    }

    private async init(): Promise<void> {
        if (this.initialised) return;

        this.initialised = true;
    }

    private async setShortIdLength(length: number): Promise<void> {
        await this.onShortIdLengthChange(length);
        this.shortIdLength = length;
    }

    /**
     * Get a target URL from the given short ID
     * @param shortId
     * @returns the target URL as string or null if not found
     * @throws Error if failed
     */
    public async getTargetUrl(shortId: string): Promise<string | null> {
        if (!this.initialised) await this.init();

        if (!this.stmt_getLink) {
            this.stmt_getLink = this.db.prepare("SELECT target_url FROM sl_links_map WHERE short_id = ? LIMIT 1");
        }

        const result = await this.stmt_getLink.bind(shortId).first<{ target_url: string }>();
        return result?.target_url ?? null;
    }

    public async createShortLink(targetUrl: string): Promise<string | null> {
        if (!this.initialised) await this.init();

        let shortId = "";

        for (let i = 0; i < 10; i++) {
            // Generate multiple IDs to check if any of them are not already taken
            // Then use the first one that is not
            const listToTest = generateUniqueShortIds(50, this.shortIdLength);
            const existed = await this.getShortIdsExist(listToTest);
            const uniqueShortId = listToTest.find(id => !existed.includes(id));

            if (!uniqueShortId) {
                await this.setShortIdLength(this.shortIdLength + 1);
            }
            else {
                shortId = uniqueShortId;
                break;
            }
        }

        if (!this.stmt_createShortLinkMap) {
            this.stmt_createShortLinkMap = this.db.prepare("INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)");
        }

        const result = await this.stmt_createShortLinkMap.bind(shortId, targetUrl).run();
        if (result.success) {
            return shortId;
        }

        return null;
    }

    private async getShortIdsExist(shortIds: string[]): Promise<string[]> {
        if (!this.initialised) await this.init();

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
}
