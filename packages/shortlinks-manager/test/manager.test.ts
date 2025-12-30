import { beforeEach, expect, mock, test } from "bun:test";
import { createManager, type IShortLinksManager, type IShortLinksManagerBackend } from "src";

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

let map: Map<string, { targetUrl: string; lastAccessedAt: Date }>;
let dummyBackend: IShortLinksManagerBackend & { map: Map<string, { targetUrl: string; lastAccessedAt: Date }> };

let shortIdLength = 3;
let manager: IShortLinksManager;

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

    const shortId1 = await manager.createShortLink(url1);
    const shortId2 = await manager.createShortLink(url2);

    expect(shortId1).not.toBe(shortId2);
    expect(shortId1).toHaveLength(3);
    expect(shortId2).toHaveLength(3);

    // Verify that the URLs can be retrieved
    expect(await manager.getTargetUrl(shortId1)).toBe(url1);
    expect(await manager.getTargetUrl(shortId2)).toBe(url2);
});

test("createShortLink should handle ID collisions by increasing length", async () => {
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
        init: dummyBackend.init,
    };

    // Reset shortIdLength for this test
    const testManager = await createManager({
        backend: collisionBackend,
        shortIdLength: testShortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            testShortIdLength = newLength;
        },
    });

    const url = "https://example.com/collision-test";
    const shortId = await testManager.createShortLink(url);

    // Should have increased length due to collisions
    expect(testShortIdLength).toBeGreaterThan(3);
    expect(shortId).toHaveLength(testShortIdLength);
    expect(await testManager.getTargetUrl(shortId)).toBe(url);
});

test("getTargetUrl should return null for non-existent short IDs", async () => {
    const result = await manager.getTargetUrl("nonexistent");
    expect(result).toBeNull();
});

test("getTargetUrl should return target URL for existing short IDs", async () => {
    const url = "https://example.com/test";
    const shortId = await manager.createShortLink(url);

    const result = await manager.getTargetUrl(shortId);
    expect(result).toBe(url);
});

test("cleanUnusedLinks should remove entries older than maxAge", async () => {
    // Create some test entries
    const url1 = "https://example.com/old";
    const url2 = "https://example.com/new";

    const shortId1 = await manager.createShortLink(url1);
    const shortId2 = await manager.createShortLink(url2);

    // Verify both entries exist
    expect(await manager.getTargetUrl(shortId1)).toBe(url1);
    expect(await manager.getTargetUrl(shortId2)).toBe(url2);

    // Manually set the last accessed time for shortId1 to be old (35 days ago)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 35); // 35 days ago

    // Update the lastAccessedAt timestamp for the first entry
    dummyBackend.map.get(shortId1)!.lastAccessedAt = oldDate;

    // Call cleanUnusedLinks with maxAge of 30 days
    await manager.cleanUnusedLinks(30);

    // shortId1 should be removed (older than 30 days)
    expect(await manager.getTargetUrl(shortId1)).toBeNull();

    // shortId2 should still exist (newer than 30 days)
    expect(await manager.getTargetUrl(shortId2)).toBe(url2);
});
