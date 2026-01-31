import { afterAll, beforeAll, expect, test } from "bun:test";
import { lightFormat } from "date-fns";
import postgres from "postgres";
import { createPostgresBackend, type IShortLinksManagerPostgresBackend } from "src";

const connectionUri = process.env.POSTGRES_URI;

if (!connectionUri) {
    throw new Error("POSTGRES_URI environment variable is required to run tests");
}

let sql: postgres.Sql;
let backend: IShortLinksManagerPostgresBackend;

beforeAll(async () => {
    sql = postgres(connectionUri);
    backend = createPostgresBackend(connectionUri);
    await backend.init?.();
    await backend.setupTables();
});

afterAll(async () => {
    if (sql) {
        await sql.end();
    }
});

test("create a short link", async () => {
    const expected = ["aB0", "https://poto.nz"] as const;

    expect(backend.createShortLink(expected[0], expected[1])).resolves.toBeUndefined();
});

test("get url by short id", async () => {
    const shortId = "abCD90";
    const expected = "https://poto.nz";

    await sql`
        INSERT INTO sl_links_map (short_id, target_url) 
        VALUES (${shortId}, ${expected})
    `;

    const url = backend.getTargetUrl(shortId);

    expect(url).resolves.toStrictEqual(expected);
});

test("get unused short links", async () => {
    const expectedRemoved = "abc";
    const expectedExist = "def";

    await sql`
        INSERT INTO sl_links_map (short_id, target_url, last_accessed_at) 
        VALUES 
            (${expectedExist}, ${"https://poto.nz"}, ${lightFormat(new Date(), "yyyy-MM-dd HH:mm:ss")}),
            (${expectedRemoved}, ${"https://poto.nz"}, ${"1970-01-01 00:00:00"})
    `;

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
    await sql`
        INSERT INTO sl_links_map (short_id, target_url) 
        VALUES (${existingIds[0]}, ${"https://poto.nz"}), (${existingIds[1]}, ${"https://poto.nz"})
    `;

    // Test checking for mix of existing and non-existing IDs
    const result = await backend.checkShortIdsExist([...existingIds, ...nonExistingIds]);

    // Should only return the existing IDs
    expect(result).toEqual(existingIds);
});

test("update short link last access time", async () => {
    const shortId = "accessTest";
    const targetUrl = "https://poto.nz";

    // Insert a record
    await sql`
        INSERT INTO sl_links_map (short_id, target_url) 
        VALUES (${shortId}, ${targetUrl})
    `;

    // Get initial last_accessed_at value
    const initialResult = await sql<{ last_accessed_at: Date }[]>`
        SELECT last_accessed_at 
        FROM sl_links_map 
        WHERE short_id = ${shortId}
    `;

    // Update the last accessed time
    await backend.updateShortLinkLastAccessTime(shortId, Date.now() + 1000);

    // Get the updated last_accessed_at value
    const updatedResult = await sql<{ last_accessed_at: Date }[]>`
        SELECT last_accessed_at 
        FROM sl_links_map 
        WHERE short_id = ${shortId}
    `;

    expect(initialResult[0]).not.toBeNull();
    expect(updatedResult[0]).not.toBeNull();

    // Verify the timestamp was updated
    expect(updatedResult[0].last_accessed_at).not.toEqual(initialResult[0].last_accessed_at);
});

test("remove existing short link", async () => {
    const shortId = "removeTest";
    const targetUrl = "https://poto.nz";

    // Insert a record
    await sql`
        INSERT INTO sl_links_map (short_id, target_url) 
        VALUES (${shortId}, ${targetUrl})
    `;

    // Verify the record exists
    const beforeResult = await backend.getTargetUrl(shortId);
    expect(beforeResult).toEqual(targetUrl);

    // Remove the short link
    expect(backend.removeShortLink(shortId)).resolves.toBeUndefined();

    // Verify the record no longer exists
    const afterResult = await backend.getTargetUrl(shortId);
    expect(afterResult).toBeNull();
});

test("remove non-existent short link should not throw error", async () => {
    // Attempt to remove a short link that doesn't exist
    expect(backend.removeShortLink("non-existent-id")).resolves.toBeUndefined();
});
