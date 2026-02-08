import { beforeEach, expect, mock, test } from "bun:test";
import { createManager, type IBaseUrlRecord, type IShortLinksManager, type IShortLinksManagerBackend, normalizeCacheKey } from "src";

mock.module("src/utils", () => ({
    generateUniqueShortIds: (count: number, length: number) => {
        // Simple mock that generates predictable short IDs for testing
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
            ids.push(`${i}`.padStart(length, "a"));
        }
        return ids;
    },
}));

const BASE_URL_ID = 1;

type DummyStorage = Map<number | null, Map<string, { targetUrl: string; lastAccessedAt: Date }>>;

let map: DummyStorage;
let dummyBackend: IShortLinksManagerBackend & { map: DummyStorage };

let shortIdLength = 3;
let manager: IShortLinksManager;

beforeEach(async () => {
    map = new Map();

    dummyBackend = {
        map,
        getTargetUrl(shortId: string, baseUrlId: number | null): string | null {
            if (!map.has(baseUrlId)) {
                map.set(baseUrlId, new Map());
            }

            const baseMap = map.get(baseUrlId)!;
            const value = baseMap.get(shortId);
            return value?.targetUrl ?? null;
        },
        createShortLink(shortId: string, targetUrl: string, baseUrlId: number | null): void {
            if (!map.has(baseUrlId)) {
                map.set(baseUrlId, new Map());
            }

            const baseMap = map.get(baseUrlId)!;
            baseMap.set(shortId, {
                targetUrl,
                lastAccessedAt: new Date(),
            });
        },
        checkShortIdsExist(shortIds: string[], baseUrlId: number | null): string[] {
            if (!map.has(baseUrlId)) {
                map.set(baseUrlId, new Map());
            }

            const baseMap = map.get(baseUrlId)!;
            return shortIds.filter(id => baseMap.has(id));
        },
        updateShortLinkLastAccessTime(shortId: string, baseUrlId: number | null, time?: number | Date): void {
            if (!map.has(baseUrlId)) {
                map.set(baseUrlId, new Map());
            }

            const baseMap = map.get(baseUrlId)!;
            const value = baseMap.get(shortId);
            if (value) {
                value.lastAccessedAt = time instanceof Date ? time : new Date(time ?? Date.now());
            }
        },
        cleanUnusedLinks(maxAge: number): Array<{ shortId: string; baseUrlId: number | null }> {
            const deletedLinks: Array<{ shortId: string; baseUrlId: number | null }> = [];
            const now = new Date();
            const cutoffDate = new Date(now);
            cutoffDate.setDate(now.getDate() - maxAge);

            for (const [baseUrlId, baseMap] of map.entries()) {
                for (const [shortId, data] of baseMap.entries()) {
                    if (data.lastAccessedAt < cutoffDate) {
                        baseMap.delete(shortId);
                        deletedLinks.push({ shortId, baseUrlId });
                    }
                }
            }

            return deletedLinks;
        },
        removeShortLink(shortId: string, baseUrlId: number | null): void {
            if (!map.has(baseUrlId)) {
                map.set(baseUrlId, new Map());
            }

            const baseMap = map.get(baseUrlId)!;
            baseMap.delete(shortId);
        },
        updateShortLink(shortId: string, targetUrl: string, baseUrlId: number | null): boolean {
            if (!map.has(baseUrlId)) {
                return false;
            }

            const baseMap = map.get(baseUrlId)!;
            const value = baseMap.get(shortId);
            if (!value) {
                return false;
            }

            value.targetUrl = targetUrl;
            return true;
        },
        baseUrl: {
            async add() {
                throw new Error("Function not implemented.");
            },
            remove: function (): void | Promise<void> {
                throw new Error("Function not implemented.");
            },
            list: function (): IBaseUrlRecord[] | Promise<IBaseUrlRecord[]> {
                throw new Error("Function not implemented.");
            },
            getId: function (): number | Promise<number> {
                return BASE_URL_ID;
            },
        },
    };

    manager = await createManager({
        backend: dummyBackend,
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });
});

test("createShortLink should generate unique short IDs", async () => {
    const url1 = "https://example.com/1";
    const url2 = "https://example.com/2";

    const shortId1 = await manager.createShortLink(url1, BASE_URL_ID);
    const shortId2 = await manager.createShortLink(url2, BASE_URL_ID);

    expect(shortId1).not.toBe(shortId2);
    expect(shortId1).toHaveLength(3);
    expect(shortId2).toHaveLength(3);

    expect(manager.getTargetUrl(shortId1, BASE_URL_ID)).resolves.toBe(url1);
    expect(manager.getTargetUrl(shortId2, BASE_URL_ID)).resolves.toBe(url2);
});

test("createShortLink should handle ID collisions by increasing length", async () => {
    const collidingLength = 3;
    let testShortIdLength = collidingLength;

    const collisionBackend = {
        getTargetUrl: dummyBackend.getTargetUrl,
        createShortLink: dummyBackend.createShortLink,
        checkShortIdsExist: function (shortIds: string[]): string[] | Promise<string[]> {
            // If they have colliding length, return all IDs as existing to force collision
            if (shortIds[0]!.length == collidingLength) {
                return shortIds;
            }

            return [];
        },
        updateShortLinkLastAccessTime: dummyBackend.updateShortLinkLastAccessTime,
        cleanUnusedLinks: dummyBackend.cleanUnusedLinks,
        removeShortLink: dummyBackend.removeShortLink,
        updateShortLink: dummyBackend.updateShortLink,
        baseUrl: dummyBackend.baseUrl,
        init: dummyBackend.init,
    };

    const testManager = await createManager({
        backend: collisionBackend,
        shortIdLength: testShortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            testShortIdLength = newLength;
        },
    });

    const url = "https://example.com/collision-test";
    const shortId = await testManager.createShortLink(url, BASE_URL_ID);

    expect(testShortIdLength).toBeGreaterThan(3);
    expect(shortId).toHaveLength(testShortIdLength);
    expect(testManager.getTargetUrl(shortId, BASE_URL_ID)).resolves.toBe(url);
});

test("getTargetUrl should return null for non-existent short IDs", async () => {
    const result = await manager.getTargetUrl("nonexistent", BASE_URL_ID);
    expect(result).toBeNull();
});

test("getTargetUrl should return target URL for existing short IDs", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url, BASE_URL_ID);

    const result = await manager.getTargetUrl(shortId, BASE_URL_ID);
    expect(result).toBe(url);
});

test("cleanUnusedLinks should remove entries older than maxAge", async () => {
    const url1 = "https://example.com/old";
    const url2 = "https://example.com/new";

    const shortId1 = await manager.createShortLink(url1, BASE_URL_ID);
    const shortId2 = await manager.createShortLink(url2, BASE_URL_ID);

    expect(manager.getTargetUrl(shortId1, BASE_URL_ID)).resolves.toBe(url1);
    expect(manager.getTargetUrl(shortId2, BASE_URL_ID)).resolves.toBe(url2);

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 35);

    dummyBackend.map.get(BASE_URL_ID)!.get(shortId1)!.lastAccessedAt = oldDate;

    await manager.cleanUnusedLinks(30);

    expect(manager.getTargetUrl(shortId1, BASE_URL_ID)).resolves.toBeNull();
    expect(manager.getTargetUrl(shortId2, BASE_URL_ID)).resolves.toBe(url2);
});

test("cleanUnusedLinks should remove entries from caches as well", async () => {
    class InMemoryCache {
        private cache: Map<string, string> = new Map();

        get(key: string): string | null {
            return this.cache.get(key) || null;
        }

        set(key: string, targetUrl: string): void {
            this.cache.set(key, targetUrl);
        }

        delete(key: string) {
            this.cache.delete(key);
        }
    }

    const dummyCache = new InMemoryCache();
    const cacheManager = await createManager({
        backend: dummyBackend,
        caches: [dummyCache],
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });

    const url1 = "https://example.com/old";
    const url2 = "https://example.com/new";

    const shortId1 = await cacheManager.createShortLink(url1, BASE_URL_ID);
    const shortId2 = await cacheManager.createShortLink(url2, BASE_URL_ID);

    expect(cacheManager.getTargetUrl(shortId1, BASE_URL_ID)).resolves.toBe(url1);
    expect(cacheManager.getTargetUrl(shortId2, BASE_URL_ID)).resolves.toBe(url2);

    const cacheKey1 = normalizeCacheKey(BASE_URL_ID, shortId1);
    const cacheKey2 = normalizeCacheKey(BASE_URL_ID, shortId2);
    expect(dummyCache.get(cacheKey1)).toBe(url1);
    expect(dummyCache.get(cacheKey2)).toBe(url2);

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 35);

    dummyBackend.map.get(BASE_URL_ID)!.get(shortId1)!.lastAccessedAt = oldDate;

    await cacheManager.cleanUnusedLinks(30);

    expect(cacheManager.getTargetUrl(shortId1, BASE_URL_ID)).resolves.toBeNull();
    expect(dummyCache.get(cacheKey1)).toBeNull();

    expect(cacheManager.getTargetUrl(shortId2, BASE_URL_ID)).resolves.toBe(url2);
    expect(dummyCache.get(cacheKey2)).toBe(url2);
});

test("removeShortLink should remove an existing short link", async () => {
    const url = "https://example.com/remove-test";
    const shortId = await manager.createShortLink(url, BASE_URL_ID);

    expect(manager.getTargetUrl(shortId, BASE_URL_ID)).resolves.toBe(url);

    await manager.removeShortLink(shortId, BASE_URL_ID);

    expect(manager.getTargetUrl(shortId, BASE_URL_ID)).resolves.toBeNull();
});

test("removeShortLink should not throw error when removing non-existent link", async () => {
    expect(manager.removeShortLink("non-existent-id", BASE_URL_ID)).resolves.toBeUndefined();
});

test("removeShortLink should remove from caches as well", async () => {
    class InMemoryCache {
        private cache: Map<string, string> = new Map();

        get(cacheKey: string): string | null {
            return this.cache.get(cacheKey) || null;
        }

        set(cacheKey: string, targetUrl: string): void {
            this.cache.set(cacheKey, targetUrl);
        }

        delete(cacheKey: string) {
            this.cache.delete(cacheKey);
        }
    }

    const dummyCache = new InMemoryCache();
    const cacheManager = await createManager({
        backend: dummyBackend,
        caches: [dummyCache],
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });

    const url = "https://example.com/cached-remove-test";
    const shortId = await cacheManager.createShortLink(url, BASE_URL_ID);

    expect(cacheManager.getTargetUrl(shortId, BASE_URL_ID)).resolves.toBe(url);
    const cacheKey = normalizeCacheKey(BASE_URL_ID, shortId);
    expect(dummyCache.get(cacheKey)).toBe(url);

    await cacheManager.removeShortLink(shortId, BASE_URL_ID);

    expect(cacheManager.getTargetUrl(shortId, BASE_URL_ID)).resolves.toBeNull();
    expect(dummyCache.get(cacheKey)).toBeNull();
});

test("updateShortLink should update the target URL for an existing short link and return true", async () => {
    const originalUrl = "https://example.com/original";
    const newUrl = "https://example.com/updated";
    const shortId = await manager.createShortLink(originalUrl, BASE_URL_ID);

    expect(await manager.getTargetUrl(shortId, BASE_URL_ID)).toBe(originalUrl);

    const result = await manager.updateShortLink(shortId, newUrl, BASE_URL_ID);

    expect(result).toBe(true);
    expect(await manager.getTargetUrl(shortId, BASE_URL_ID)).toBe(newUrl);
});

test("updateShortLink should return false if short link does not exist", async () => {
    const newUrl = "https://example.com/updated";

    const result = await manager.updateShortLink("non-existent-id", newUrl, BASE_URL_ID);

    expect(result).toBe(false);
});
