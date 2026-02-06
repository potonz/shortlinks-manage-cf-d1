import { beforeEach, expect, mock, setSystemTime, test } from "bun:test";
import { createManager, type IBaseUrlRecord, type IShortLinksManagerBackend } from "src";

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
        updateShortLinkLastAccessTime(shortId: string, baseUrlId: number | null): void {
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
    const shortId = await managerWithoutUpdate.createShortLink(url, BASE_URL_ID);

    // Get the initial last accessed time
    const initialLastAccessed = dummyBackend.map.get(BASE_URL_ID)!.get(shortId)!.lastAccessedAt;

    // Access the URL
    const result = await managerWithoutUpdate.getTargetUrl(shortId, BASE_URL_ID);

    // Verify the URL is returned correctly
    expect(result).toBe(url);

    // Verify that last accessed time was NOT updated
    const finalLastAccessed = dummyBackend.map.get(BASE_URL_ID)!.get(shortId)!.lastAccessedAt;
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
    const shortId = await managerWithUpdate.createShortLink(url, BASE_URL_ID);

    // Get the initial last accessed time
    const initialLastAccessed = dummyBackend.map.get(BASE_URL_ID)!.get(shortId)!.lastAccessedAt;

    // Mock the current time to be in the future
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    setSystemTime(futureDate);

    // Access the URL
    const result = await managerWithUpdate.getTargetUrl(shortId, BASE_URL_ID);

    // Verify the URL is returned correctly
    expect(result).toBe(url);

    // Verify that last accessed time WAS updated
    const finalLastAccessed = dummyBackend.map.get(BASE_URL_ID)!.get(shortId)!.lastAccessedAt;
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
    const shortId = await managerWithDefault.createShortLink(url, BASE_URL_ID);

    // Get the initial last accessed time
    const initialLastAccessed = dummyBackend.map.get(BASE_URL_ID)!.get(shortId)!.lastAccessedAt;

    // Mock the current time to be in the future
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    setSystemTime(futureDate);

    // Access the URL
    const result = await managerWithDefault.getTargetUrl(shortId, BASE_URL_ID);

    // Verify the URL is returned correctly
    expect(result).toBe(url);

    // Verify that last accessed time WAS updated (default behavior)
    const finalLastAccessed = dummyBackend.map.get(BASE_URL_ID)!.get(shortId)!.lastAccessedAt;
    expect(finalLastAccessed).not.toEqual(initialLastAccessed);

    // Reset the mock date
    setSystemTime();
});
