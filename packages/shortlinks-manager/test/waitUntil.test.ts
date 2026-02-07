import { beforeEach, expect, type Mock, mock, test } from "bun:test";
import { createManager, type IBaseUrlRecord, type IShortLinksManager, type IShortLinksManagerBackend } from "src";
import type { ICache } from "src/cache";

// Mock the generateUniqueShortIds function
mock.module("../../src/utils", () => ({
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

class InMemoryCache implements ICache {
    private cache: Map<string, string> = new Map();

    get(key: string): string | null {
        return this.cache.get(key) || null;
    }

    async set(key: string, targetUrl: string): Promise<void> {
        this.cache.set(key, targetUrl);
    }

    delete(key: string) {
        this.cache.delete(key);
    }
}

let map: Map<number | null, Map<string, { targetUrl: string; lastAccessedAt: Date }>>;
let dummyBackend: IShortLinksManagerBackend & { map: Map<number | null, Map<string, { targetUrl: string; lastAccessedAt: Date }>> };
let dummyCache: ICache;
let dummyWaitUntil: Mock<(promise: Promise<unknown>) => void>;
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
            if (baseMap.has(shortId)) {
                throw new Error("short id not found");
            }

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
        async updateShortLinkLastAccessTime(shortId: string, baseUrlId: number | null): Promise<void> {
            if (!map.has(baseUrlId)) {
                map.set(baseUrlId, new Map());
            }

            const baseMap = map.get(baseUrlId)!;
            const value = baseMap.get(shortId);
            if (value) {
                value.lastAccessedAt = new Date();
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
    dummyWaitUntil = mock<(promise: Promise<unknown>) => void>();

    manager = await createManager({
        backend: dummyBackend,
        caches: [dummyCache],
        waitUntil: dummyWaitUntil,
        shortIdLength,
        // Must return a promise to test waitUntil
        onShortIdLengthUpdated: async (newLength) => {
            shortIdLength = newLength;
        },
    });
});

test("should be called when updating short id length", async () => {
    const collidingLength = 3;
    let testShortIdLength = collidingLength;

    // Mock backend to simulate all generated IDs already exist
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
        baseUrl: dummyBackend.baseUrl,
        init: dummyBackend.init,
    };

    // Reset shortIdLength for this test
    const testManager = await createManager({
        backend: collisionBackend,
        waitUntil: dummyWaitUntil,
        shortIdLength: testShortIdLength,
        onShortIdLengthUpdated: async (newLength) => {
            testShortIdLength = newLength;
        },
    });

    await testManager.createShortLink("https://poto.nz", BASE_URL_ID);
    expect(dummyWaitUntil).toHaveBeenCalled();
});

test("should be called in getTargetUrl with cache hit and update last accessed time", async () => {
    // Create a short link first
    const shortId = await manager.createShortLink("https://poto.nz", BASE_URL_ID);
    expect(dummyWaitUntil).toHaveBeenCalledTimes(1);

    await manager.getTargetUrl(shortId, BASE_URL_ID);

    // Verify that waitUntil was called
    expect(dummyWaitUntil).toHaveBeenCalledTimes(2);
});

test("should be called in getTargetUrl with cache miss and update last accessed time", async () => {
    const managerWithoutCache = await createManager({
        backend: dummyBackend,
        shortIdLength: shortIdLength,
        onShortIdLengthUpdated: (newLength: number) => {
            shortIdLength = newLength;
        },
    });
    const shortId = await managerWithoutCache.createShortLink("https://poto.nz", BASE_URL_ID);
    expect(dummyWaitUntil).toHaveBeenCalledTimes(0);

    await manager.getTargetUrl(shortId, BASE_URL_ID);

    // Verify that waitUntil was called
    expect(dummyWaitUntil).toHaveBeenCalledTimes(2);
});

test("should not be called in getTargetUrl with synchronous update last accessed time", async () => {
    // Create a manager with synchronous backend update function
    const syncBackend = {
        ...dummyBackend,
        updateShortLinkLastAccessTime: function (shortId: string, baseUrlId: number | null): void {
            const baseMap = dummyBackend.map.get(baseUrlId)!;
            const value = baseMap.get(shortId);
            if (value) {
                value.lastAccessedAt = new Date();
            }
        },
    };

    const syncManager = await createManager({
        backend: syncBackend,
        caches: [dummyCache],
        waitUntil: dummyWaitUntil,
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
    });

    // Create a short link first
    const shortId = await syncManager.createShortLink("https://poto.nz", BASE_URL_ID);
    expect(dummyWaitUntil).toHaveBeenCalledTimes(1);

    await syncManager.getTargetUrl(shortId, BASE_URL_ID);

    expect(dummyWaitUntil).toHaveBeenCalledTimes(1);
});

test("should not be called with synchronous onShortIdLengthUpdated", async () => {
    const collidingLength = 3;
    let testShortIdLength = collidingLength;

    // Mock backend to simulate all generated IDs already exist
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
        baseUrl: dummyBackend.baseUrl,
        init: dummyBackend.init,
    };

    // Reset shortIdLength for this test
    const testManager = await createManager({
        backend: collisionBackend,
        waitUntil: dummyWaitUntil,
        shortIdLength: testShortIdLength,
        // Using synchronous function (not async) to test that waitUntil is not called
        onShortIdLengthUpdated: (newLength) => {
            testShortIdLength = newLength;
        },
    });

    await testManager.createShortLink("https://poto.nz", BASE_URL_ID);
    expect(dummyWaitUntil).not.toHaveBeenCalled();
});
