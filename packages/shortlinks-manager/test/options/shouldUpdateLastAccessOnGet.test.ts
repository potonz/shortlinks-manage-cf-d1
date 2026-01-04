import { beforeEach, expect, mock, setSystemTime, test } from "bun:test";
import { createManager, type IShortLinksManagerBackend } from "src";

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
});

test("shouldUpdateLastAccessOnGet: false should not update last access time", async () => {
    // Create a manager with shouldUpdateLastAccessOnGet set to false
    const managerWithoutUpdate = await createManager({
        backend: dummyBackend,
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
        options: {
            shouldUpdateLastAccessOnGet: false,
        },
    });

    const url = "https://example.com/test";
    const shortId = await managerWithoutUpdate.createShortLink(url);

    // Get the initial last accessed time
    const initialLastAccessed = dummyBackend.map.get(shortId)!.lastAccessedAt;

    // Access the URL
    const result = await managerWithoutUpdate.getTargetUrl(shortId);

    // Verify the URL is returned correctly
    expect(result).toBe(url);

    // Verify that last accessed time was NOT updated
    const finalLastAccessed = dummyBackend.map.get(shortId)!.lastAccessedAt;
    expect(finalLastAccessed).toEqual(initialLastAccessed);
});

test("shouldUpdateLastAccessOnGet: true should update last access time", async () => {
    // Create a manager with shouldUpdateLastAccessOnGet set to true
    const managerWithUpdate = await createManager({
        backend: dummyBackend,
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
        options: {
            shouldUpdateLastAccessOnGet: true,
        },
    });

    const url = "https://example.com/test";
    const shortId = await managerWithUpdate.createShortLink(url);

    // Get the initial last accessed time
    const initialLastAccessed = dummyBackend.map.get(shortId)!.lastAccessedAt;

    // Mock the current time to be in the future
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    setSystemTime(futureDate);

    // Access the URL
    const result = await managerWithUpdate.getTargetUrl(shortId);

    // Verify the URL is returned correctly
    expect(result).toBe(url);

    // Verify that last accessed time WAS updated
    const finalLastAccessed = dummyBackend.map.get(shortId)!.lastAccessedAt;
    expect(finalLastAccessed).not.toEqual(initialLastAccessed);

    // Reset the mock date
    setSystemTime();
});

test("shouldUpdateLastAccessOnGet: undefined should default to true and update last access time", async () => {
    // Create a manager with no options (undefined should default to true)
    const managerWithDefault = await createManager({
        backend: dummyBackend,
        shortIdLength,
        onShortIdLengthUpdated: (newLength) => {
            shortIdLength = newLength;
        },
        options: {
            // shouldUpdateLastAccessOnGet is omitted, so it's undefined
        },
    });

    const url = "https://example.com/test";
    const shortId = await managerWithDefault.createShortLink(url);

    // Get the initial last accessed time
    const initialLastAccessed = dummyBackend.map.get(shortId)!.lastAccessedAt;

    // Mock the current time to be in the future
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    setSystemTime(futureDate);

    // Access the URL
    const result = await managerWithDefault.getTargetUrl(shortId);

    // Verify the URL is returned correctly
    expect(result).toBe(url);

    // Verify that last accessed time WAS updated (default behavior)
    const finalLastAccessed = dummyBackend.map.get(shortId)!.lastAccessedAt;
    expect(finalLastAccessed).not.toEqual(initialLastAccessed);

    // Reset the mock date
    setSystemTime();
});
