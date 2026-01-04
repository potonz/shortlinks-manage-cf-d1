import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import { createManager, type IShortLinksManager, type IShortLinksManagerBackend } from "src";
import type { ICache } from "src/cache";

// Mock the generateUniqueShortIds function
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

// Create a simple in-memory cache for testing
class InMemoryCache implements ICache {
    private cache: Map<string, string> = new Map();

    get(shortId: string): string | null {
        return this.cache.get(shortId) || null;
    }

    set(shortId: string, targetUrl: string): void {
        this.cache.set(shortId, targetUrl);
    }

    delete(shortId: string) {
        this.cache.delete(shortId);
    }
}

let map: Map<string, { targetUrl: string; lastAccessedAt: Date }>;
let dummyBackend: IShortLinksManagerBackend & { map: Map<string, { targetUrl: string; lastAccessedAt: Date }> };
let dummyCache: ICache;
let manager: IShortLinksManager;
let shortIdLength = 3;

beforeEach(async () => {
    map = new Map<string, { targetUrl: string; lastAccessedAt: Date }>();

    dummyBackend = {
        map,
        getTargetUrl(shortId: string): string | null {
            const value = map.get(shortId);
            return value?.targetUrl ?? null;
        },
        createShortLink(shortId: string, targetUrl: string): void {
            if (map.has(shortId)) {
                throw new Error("short id not found");
            }

            map.set(shortId, {
                targetUrl,
                lastAccessedAt: new Date(),
            });
        },
        checkShortIdsExist(shortIds: string[]): string[] {
            return shortIds.filter(id => map.has(id));
        },
        updateShortLinkLastAccessTime(shortId: string): void {
            const value = map.get(shortId);
            if (value) {
                value.lastAccessedAt = new Date();
            }
        },
        cleanUnusedLinks(maxAge: number): string[] {
            // Delete entries older than maxAge days
            const now = new Date();
            const cutoffDate = new Date(now);
            cutoffDate.setDate(now.getDate() - maxAge);

            const deletedShortIds = [];

            for (const [shortId, data] of map.entries()) {
                if (data.lastAccessedAt < cutoffDate) {
                    map.delete(shortId);
                    deletedShortIds.push(shortId);
                }
            }

            return deletedShortIds;
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
    const shortId = await manager.createShortLink(url);

    // Manually check that the cache has the value
    const cachedValue = dummyCache.get(shortId);
    expect(cachedValue).toBe(url);

    // Should hit cache, not backend
    const result2 = await manager.getTargetUrl(shortId);
    expect(result2).toBe(url);
});

test("should fall back to backend when cache miss occurs", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url);

    // Remove from cache manually to force miss
    dummyCache.delete?.(shortId);

    const result = await manager.getTargetUrl(shortId);
    expect(result).toBe(url);

    // Verify the cache was populated
    const cachedValue = dummyCache.get(shortId);
    expect(cachedValue).toBe(url);
});

test("should handle multiple caches in order", async () => {
    const firstCache = new InMemoryCache();
    const secondCache = new InMemoryCache();

    // Create a new manager with multiple caches
    const managerWithCaches = await createManager({
        backend: dummyBackend,
        caches: [firstCache, secondCache],
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });

    const url = "https://example.com/test";
    const shortId = await managerWithCaches.createShortLink(url);
    firstCache.delete(shortId);
    secondCache.delete(shortId);

    // First access - should check first cache (miss), then second cache (miss), then backend
    const result1 = await managerWithCaches.getTargetUrl(shortId);
    expect(result1).toBe(url);

    // Both caches should now have the value
    const firstCacheValue = firstCache.get(shortId);
    const secondCacheValue = secondCache.get(shortId);
    expect(firstCacheValue).toBe(url);
    expect(secondCacheValue).toBe(url);
});

test("should check caches in order and return on first hit", async () => {
    const firstCache = new InMemoryCache();
    const secondCache = new InMemoryCache();

    // Create a new manager with multiple caches
    const managerWithCaches = await createManager({
        backend: dummyBackend,
        caches: [firstCache, secondCache],
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });

    const url = "https://poto.nz";
    const shortId = await managerWithCaches.createShortLink(url);
    const cacheResult = firstCache.get(shortId);
    expect(cacheResult).toBe(url);

    const spyBackend = spyOn(dummyBackend, "getTargetUrl");

    // Access should return from first cache (hit) without checking backend
    const result = await managerWithCaches.getTargetUrl(shortId);
    expect(result).toBe(url);
    expect(spyBackend).not.toHaveBeenCalled();
});

test("should not cache null results", async () => {
    const url = "https://example.com/test";
    const shortId = "aUniqueShortId";

    // Try to get a non-existent URL (should return null and not cache it)
    const result1 = await manager.getTargetUrl(shortId);
    expect(result1).toBeNull();

    // Verify that cache was not populated with null
    const cachedValue = dummyCache.get(shortId);
    expect(cachedValue).toBeNull();

    // Create a short link with the same ID
    await dummyBackend.createShortLink(shortId, url);

    // Get the target URL - should now return the actual URL, not null
    const result2 = await manager.getTargetUrl(shortId);
    expect(result2).toBe(url);

    // Verify the cache now has the actual URL, not null
    const cachedValue2 = dummyCache.get(shortId);
    expect(cachedValue2).toBe(url);
});

test("should properly update last access time when using cache", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url);
    dummyCache.delete?.(shortId);

    const spy = spyOn(dummyBackend, "updateShortLinkLastAccessTime");

    // First access - should hit backend
    const result1 = await manager.getTargetUrl(shortId);
    expect(result1).toBe(url);
    expect(spy).toHaveBeenCalledTimes(1);

    // Second access - should hit cache
    const result2 = await manager.getTargetUrl(shortId);
    expect(result2).toBe(url);
    expect(spy).toHaveBeenCalledTimes(2);
});

test("should write to all caches when creating a short link with single cache", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url);

    // Verify that the cache was populated with the correct value
    const cachedValue = dummyCache.get(shortId);
    expect(cachedValue).toBe(url);
});

test("should write to all caches when creating a short link with multiple caches", async () => {
    const firstCache = new InMemoryCache();
    const secondCache = new InMemoryCache();

    // Create a new manager with multiple caches
    const managerWithCaches = await createManager({
        backend: dummyBackend,
        caches: [firstCache, secondCache],
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });

    const url = "https://example.com/test";
    const shortId = await managerWithCaches.createShortLink(url);

    // Verify that both caches were populated with the correct value
    const firstCacheValue = firstCache.get(shortId);
    const secondCacheValue = secondCache.get(shortId);
    expect(firstCacheValue).toBe(url);
    expect(secondCacheValue).toBe(url);
});
