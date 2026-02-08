import { afterAll, beforeAll, expect, test } from "bun:test";
import { lightFormat } from "date-fns";
import { Miniflare } from "miniflare";
import { createD1Backend, type IShortLinksManagerD1Backend } from "src";

let mf: Miniflare;
let db: D1Database;
let backend: IShortLinksManagerD1Backend;

beforeAll(async () => {
    mf = new Miniflare({
        modules: true,
        script: `
export default {
    async fetch(request, env, ctx) {
        return new Response("Hello Miniflare!");
    }
}
`,
        d1Databases: {
            DB: "018648ab-e976-4825-847e-91c9293f2137",
        },
    });

    await mf.ready;

    db = await mf.getD1Database("DB");
    backend = createD1Backend(db);
    await backend.init?.();
    await backend.setupTables();
});

afterAll(async () => {
    await mf.dispose();
});

test("create a short link", async () => {
    const expected = ["aB0", "https://poto.nz"] as const;

    expect(backend.createShortLink(expected[0], expected[1], null)).resolves.toBeUndefined();
});

test("get url by short id", async () => {
    const shortId = "abCD90";
    const expected = "https://poto.nz";

    await db.prepare("INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL)")
        .bind(shortId, expected)
        .run();

    const url = backend.getTargetUrl(shortId, null);

    expect(url).resolves.toStrictEqual(expected);
});

test("get unused short links", async () => {
    const expectedRemoved = "abc";
    const expectedExist = "def";

    await db.prepare("INSERT INTO sl_links_map (short_id, target_url, base_url_id, last_accessed_at) VALUES (?, ?, NULL, ?), (?, ?, NULL, ?)")
        .bind(
            expectedExist, "https://poto.nz", lightFormat(new Date(), "yyyy-MM-dd HH:mm:ss"),
            expectedRemoved, "https://poto.nz", "1970-01-01 00:00:00",
        )
        .run();

    await backend.cleanUnusedLinks(1);

    const removedUrl = backend.getTargetUrl(expectedRemoved, null);
    expect(removedUrl).resolves.toBeNull();
    const existUrl = backend.getTargetUrl(expectedExist, null);
    expect(existUrl).resolves.not.toBeNull();
});

test("get non-existing short id", async () => {
    expect(backend.getTargetUrl("does-not-exist", null)).resolves.toBeNull();
});

test("check if short ids exist", async () => {
    const existingIds = ["existing1", "existing2"];
    const nonExistingIds = ["nonexisting1", "nonexisting2"];

    // Insert some existing records
    await db.prepare("INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL), (?, ?, NULL)")
        .bind(existingIds[0], "https://poto.nz", existingIds[1], "https://poto.nz")
        .run();

    // Test checking for mix of existing and non-existing IDs
    const result = await backend.checkShortIdsExist([...existingIds, ...nonExistingIds], null);

    // Should only return the existing IDs
    expect(result).toEqual(existingIds);
});

test("update short link last access time", async () => {
    const shortId = "accessTest";
    const targetUrl = "https://poto.nz";

    // Insert a record
    await db.prepare("INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL)")
        .bind(shortId, targetUrl)
        .run();

    // Get initial last_accessed_at value
    const initialResult = await db.prepare("SELECT last_accessed_at FROM sl_links_map WHERE short_id = ? AND base_url_id IS NULL")
        .bind(shortId)
        .first<{ last_accessed_at: string }>();

    // Update the last accessed time
    await backend.updateShortLinkLastAccessTime(shortId, null, Date.now() + 1000);

    // Get the updated last_accessed_at value
    const updatedResult = await db.prepare("SELECT last_accessed_at FROM sl_links_map WHERE short_id = ? AND base_url_id IS NULL")
        .bind(shortId)
        .first<{ last_accessed_at: string }>();

    expect(initialResult).not.toBeNull();
    expect(updatedResult).not.toBeNull();

    // Verify the timestamp was updated
    expect(updatedResult!.last_accessed_at).not.toEqual(initialResult!.last_accessed_at);
});

test("remove existing short link", async () => {
    const shortId = "removeTest";
    const targetUrl = "https://poto.nz";

    // Insert a record
    await db.prepare("INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL)")
        .bind(shortId, targetUrl)
        .run();

    // Verify the record exists
    const beforeResult = await backend.getTargetUrl(shortId, null);
    expect(beforeResult).toEqual(targetUrl);

    // Remove the short link
    expect(backend.removeShortLink(shortId, null)).resolves.toBeUndefined();

    // Verify the record no longer exists
    const afterResult = await backend.getTargetUrl(shortId, null);
    expect(afterResult).toBeNull();
});

test("remove non-existent short link should not throw error", async () => {
    // Attempt to remove a short link that doesn't exist
    expect(backend.removeShortLink("non-existent-id", null)).resolves.toBeUndefined();
});

test("update short link target url", async () => {
    const shortId = "updateTest";
    const originalUrl = "https://original.poto.nz";
    const updatedUrl = "https://updated.poto.nz";

    // Insert a record
    await db.prepare("INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL)")
        .bind(shortId, originalUrl)
        .run();

    // Verify the record exists with original URL
    const beforeResult = await backend.getTargetUrl(shortId, null);
    expect(beforeResult).toEqual(originalUrl);

    // Update the short link
    const updateResult = await backend.updateShortLink(shortId, updatedUrl, null);
    expect(updateResult).toBe(true);

    // Verify the URL was updated
    const afterResult = await backend.getTargetUrl(shortId, null);
    expect(afterResult).toEqual(updatedUrl);
});

test("update non-existent short link should return false", async () => {
    const result = await backend.updateShortLink("non-existent-id", "https://updated.poto.nz", null);
    expect(result).toBe(false);
});
