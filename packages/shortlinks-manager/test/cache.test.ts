import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import { createManager, type IBaseUrlRecord, type IShortLinksManager, type IShortLinksManagerBackend, normalizeCacheKey } from "src";
import type { ICache } from "src/cache";

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

class InMemoryCache implements ICache {
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

let map: DummyStorage;
let dummyBackend: IShortLinksManagerBackend & { map: DummyStorage };
let dummyCache: ICache;
let manager: IShortLinksManager;
let shortIdLength = 3;

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

    dummyCache = new InMemoryCache();

    manager = await createManager({
        backend: dummyBackend,
        caches: [dummyCache],
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });
});

test("should use cache when getting target URL and cache hit occurs", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url, BASE_URL_ID);

    // Manually check that the cache has the value
    const cacheKey = normalizeCacheKey(BASE_URL_ID, shortId);
    const cachedValue = dummyCache.get(cacheKey);
    expect(cachedValue).toBe(url);

    const result2 = await manager.getTargetUrl(shortId, BASE_URL_ID);
    expect(result2).toBe(url);
});

test("should fall back to backend when cache miss occurs", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url, BASE_URL_ID);

    const cacheKey = normalizeCacheKey(BASE_URL_ID, shortId);
    dummyCache.delete(cacheKey);

    const result = await manager.getTargetUrl(shortId, BASE_URL_ID);
    expect(result).toBe(url);

    const cachedValue = dummyCache.get(cacheKey);
    expect(cachedValue).toBe(url);
});

test("should handle multiple caches in order", async () => {
    const firstCache = new InMemoryCache();
    const secondCache = new InMemoryCache();

    const managerWithCaches = await createManager({
        backend: dummyBackend,
        caches: [firstCache, secondCache],
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });

    const url = "https://example.com/test";
    const shortId = await managerWithCaches.createShortLink(url, BASE_URL_ID);

    const cacheKey = normalizeCacheKey(BASE_URL_ID, shortId);
    firstCache.delete(cacheKey);
    secondCache.delete(cacheKey);

    const result1 = await managerWithCaches.getTargetUrl(shortId, BASE_URL_ID);
    expect(result1).toBe(url);

    const firstCacheValue = firstCache.get(cacheKey);
    const secondCacheValue = secondCache.get(cacheKey);
    expect(firstCacheValue).toBe(url);
    expect(secondCacheValue).toBe(url);
});

test("should check caches in order and return on first hit", async () => {
    const firstCache = new InMemoryCache();
    const secondCache = new InMemoryCache();

    const managerWithCaches = await createManager({
        backend: dummyBackend,
        caches: [firstCache, secondCache],
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });

    const url = "https://poto.nz";
    const shortId = await managerWithCaches.createShortLink(url, BASE_URL_ID);

    const cacheKey = normalizeCacheKey(BASE_URL_ID, shortId);
    const cacheResult = firstCache.get(cacheKey);
    expect(cacheResult).toBe(url);

    const spyBackend = spyOn(dummyBackend, "getTargetUrl");

    const result = await managerWithCaches.getTargetUrl(shortId, BASE_URL_ID);
    expect(result).toBe(url);
    expect(spyBackend).not.toHaveBeenCalled();
});

test("should not cache null results", async () => {
    const url = "https://example.com/test";
    const shortId = "aUniqueShortId";

    const result1 = await manager.getTargetUrl(shortId, BASE_URL_ID);
    expect(result1).toBeNull();

    const cacheKey = normalizeCacheKey(BASE_URL_ID, shortId);
    const cachedValue = dummyCache.get(cacheKey);
    expect(cachedValue).toBeNull();

    await dummyBackend.createShortLink(shortId, url, BASE_URL_ID);

    const result2 = await manager.getTargetUrl(shortId, BASE_URL_ID);
    expect(result2).toBe(url);

    const cachedValue2 = dummyCache.get(cacheKey);
    expect(cachedValue2).toBe(url);
});

test("should properly update last access time when using cache", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url, BASE_URL_ID);

    const cacheKey = normalizeCacheKey(BASE_URL_ID, shortId);
    dummyCache.delete(cacheKey);

    const spy = spyOn(dummyBackend, "updateShortLinkLastAccessTime");

    const result1 = await manager.getTargetUrl(shortId, BASE_URL_ID);
    expect(result1).toBe(url);
    expect(spy).toHaveBeenCalledTimes(1);

    const result2 = await manager.getTargetUrl(shortId, BASE_URL_ID);
    expect(result2).toBe(url);
    expect(spy).toHaveBeenCalledTimes(2);
});

test("should write to all caches when creating a short link with single cache", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url, BASE_URL_ID);

    const cacheKey = normalizeCacheKey(BASE_URL_ID, shortId);
    const cachedValue = dummyCache.get(cacheKey);
    expect(cachedValue).toBe(url);
});

test("should write to all caches when creating a short link with multiple caches", async () => {
    const firstCache = new InMemoryCache();
    const secondCache = new InMemoryCache();

    const managerWithCaches = await createManager({
        backend: dummyBackend,
        caches: [firstCache, secondCache],
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });

    const url = "https://example.com/test";
    const shortId = await managerWithCaches.createShortLink(url, BASE_URL_ID);

    const cacheKey = normalizeCacheKey(BASE_URL_ID, shortId);
    const firstCacheValue = firstCache.get(cacheKey);
    const secondCacheValue = secondCache.get(cacheKey);
    expect(firstCacheValue).toBe(url);
    expect(secondCacheValue).toBe(url);
});

test("should clear cache when updating a short link", async () => {
    const originalUrl = "https://example.com/original";
    const updatedUrl = "https://example.com/updated";
    const shortId = await manager.createShortLink(originalUrl, BASE_URL_ID);

    const cacheKey = normalizeCacheKey(BASE_URL_ID, shortId);
    expect(dummyCache.get(cacheKey)).toBe(originalUrl);

    await manager.updateShortLink(shortId, updatedUrl, BASE_URL_ID);

    expect(dummyCache.get(cacheKey)).toBeNull();

    const result = await manager.getTargetUrl(shortId, BASE_URL_ID);
    expect(result).toBe(updatedUrl);
    expect(dummyCache.get(cacheKey)).toBe(updatedUrl);
});
