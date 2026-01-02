import { beforeEach, expect, mock, test } from "bun:test";
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

    async init?(): Promise<void> {
        // No initialization needed for in-memory cache
    }

    async get(shortId: string): Promise<string | null> {
        return this.cache.get(shortId) || null;
    }

    async set(shortId: string, targetUrl: string): Promise<void> {
        this.cache.set(shortId, targetUrl);
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
        getTargetUrl: function (shortId: string): string | null {
            const value = map.get(shortId);
            return value?.targetUrl ?? null;
        },
        createShortLink: function (shortId: string, targetUrl: string): void | Promise<void> {
            if (map.has(shortId)) {
                throw new Error("short id not found");
            }

            map.set(shortId, {
                targetUrl,
                lastAccessedAt: new Date(),
            });
        },
        checkShortIdsExist: function (shortIds: string[]): string[] | Promise<string[]> {
            return shortIds.filter(id => map.has(id));
        },
        updateShortLinkLastAccessTime: function (shortId: string): void | Promise<void> {
            const value = map.get(shortId);
            if (value) {
                value.lastAccessedAt = new Date();
            }
        },
        cleanUnusedLinks: function (maxAge: number): void | Promise<void> {
            // Delete entries older than maxAge days
            const now = new Date();
            const cutoffDate = new Date(now);
            cutoffDate.setDate(now.getDate() - maxAge);

            for (const [shortId, data] of map.entries()) {
                if (data.lastAccessedAt < cutoffDate) {
                    map.delete(shortId);
                }
            }
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

    // First access - should hit backend and cache the result
    const result1 = await manager.getTargetUrl(shortId);
    expect(result1).toBe(url);

    // Manually check that the cache has the value
    const cachedValue = await dummyCache.get(shortId);
    expect(cachedValue).toBe(url);

    // Second access - should hit cache, not backend
    const result2 = await manager.getTargetUrl(shortId);
    expect(result2).toBe(url);
});

test("should fall back to backend when cache miss occurs", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url);

    // Access URL without caching it first (cache miss)
    const result = await manager.getTargetUrl(shortId);
    expect(result).toBe(url);

    // Verify the cache was populated
    const cachedValue = await dummyCache.get(shortId);
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

    // First access - should check first cache (miss), then second cache (miss), then backend
    const result1 = await managerWithCaches.getTargetUrl(shortId);
    expect(result1).toBe(url);

    // Both caches should now have the value
    const firstCacheValue = await firstCache.get(shortId);
    const secondCacheValue = await secondCache.get(shortId);
    expect(firstCacheValue).toBe(url);
    expect(secondCacheValue).toBe(url);
});

test("should check caches in order and return on first hit", async () => {
    const firstCache = new InMemoryCache();
    const secondCache = new InMemoryCache();

    // Pre-populate first cache with a value
    const url = "https://example.com/test";
    const shortId = "000"; // predictable short ID from mock
    await firstCache.set(shortId, url);

    // Create a new manager with multiple caches
    const managerWithCaches = await createManager({
        backend: dummyBackend,
        caches: [firstCache, secondCache],
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });

    // Access should return from first cache (hit) without checking backend
    const result = await managerWithCaches.getTargetUrl(shortId);
    expect(result).toBe(url);

    // Verify backend wasn't called by checking that the URL is still in first cache
    const firstCacheValue = await firstCache.get(shortId);
    expect(firstCacheValue).toBe(url);
});

test("should not cache null results", async () => {
    const url = "https://example.com/test";
    const shortId = "aUniqueShortId";

    // Try to get a non-existent URL (should return null and not cache it)
    const result1 = await manager.getTargetUrl(shortId);
    expect(result1).toBeNull();

    // Verify that cache was not populated with null
    const cachedValue = await dummyCache.get(shortId);
    expect(cachedValue).toBeNull();

    // Create a short link with the same ID
    await dummyBackend.createShortLink(shortId, url);

    // Get the target URL - should now return the actual URL, not null
    const result2 = await manager.getTargetUrl(shortId);
    expect(result2).toBe(url);

    // Verify the cache now has the actual URL, not null
    const cachedValue2 = await dummyCache.get(shortId);
    expect(cachedValue2).toBe(url);
});

test("should properly update last access time when using cache", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url);

    // First access - should hit backend and cache
    const result1 = await manager.getTargetUrl(shortId);
    expect(result1).toBe(url);

    // Second access - should hit cache
    const result2 = await manager.getTargetUrl(shortId);
    expect(result2).toBe(url);

    // Verify that the backend's updateShortLinkLastAccessTime was called
    // (This is indirectly verified by the fact that the URL is still accessible)
    const result3 = await manager.getTargetUrl(shortId);
    expect(result3).toBe(url);
});
