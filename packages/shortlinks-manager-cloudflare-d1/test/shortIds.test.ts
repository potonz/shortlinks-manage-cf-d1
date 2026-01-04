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

    expect(backend.createShortLink(expected[0], expected[1])).resolves.toBeUndefined();
});

test("get url by short id", async () => {
    const shortId = "abCD90";
    const expected = "https://poto.nz";

    await db.prepare("INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)")
        .bind(shortId, expected)
        .run();

    const url = backend.getTargetUrl(shortId);

    expect(url).resolves.toStrictEqual(expected);
});

test("get unused short links", async () => {
    const expectedRemoved = "abc";
    const expectedExist = "def";

    await db.prepare("INSERT INTO sl_links_map (short_id, target_url, last_accessed_at) VALUES (?, ?, ?), (?, ?, ?)")
        .bind(
            expectedExist, "https://poto.nz", lightFormat(new Date(), "yyyy-MM-dd HH:mm:ss"),
            expectedRemoved, "https://poto.nz", "1970-01-01 00:00:00",
        )
        .run();

    await backend.cleanUnusedLinks(1);

    const removedUrl = backend.getTargetUrl(expectedRemoved);
    expect(removedUrl).resolves.toBeNull();
    const existUrl = backend.getTargetUrl(expectedExist);
    expect(existUrl).resolves.not.toBeNull();
});

test("get non-existing short id", async () => {
    expect(backend.getTargetUrl("does-not-exist")).resolves.toBeNull();
});

test("check if short ids exist", async () => {
    const existingIds = ["existing1", "existing2"];
    const nonExistingIds = ["nonexisting1", "nonexisting2"];

    // Insert some existing records
    await db.prepare("INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?), (?, ?)")
        .bind(existingIds[0], "https://poto.nz", existingIds[1], "https://poto.nz")
        .run();

    // Test checking for mix of existing and non-existing IDs
    const result = await backend.checkShortIdsExist([...existingIds, ...nonExistingIds]);

    // Should only return the existing IDs
    expect(result).toEqual(existingIds);
});

test("update short link last access time", async () => {
    const shortId = "accessTest";
    const targetUrl = "https://poto.nz";

    // Insert a record
    await db.prepare("INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)")
        .bind(shortId, targetUrl)
        .run();

    // Get initial last_accessed_at value
    const initialResult = await db.prepare("SELECT last_accessed_at FROM sl_links_map WHERE short_id = ?")
        .bind(shortId)
        .first<{ last_accessed_at: string }>();

    // Update the last accessed time
    await backend.updateShortLinkLastAccessTime(shortId, Date.now() + 1000);

    // Get the updated last_accessed_at value
    const updatedResult = await db.prepare("SELECT last_accessed_at FROM sl_links_map WHERE short_id = ?")
        .bind(shortId)
        .first<{ last_accessed_at: string }>();

    expect(initialResult).not.toBeNull();
    expect(updatedResult).not.toBeNull();

    // Verify the timestamp was updated
    expect(updatedResult!.last_accessed_at).not.toEqual(initialResult!.last_accessed_at);
});
