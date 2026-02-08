import { afterEach, beforeEach, expect, test } from "bun:test";
import { lightFormat } from "date-fns";
import mysql from "mysql2/promise";
import { createMysqlBackend, type IShortLinksManagerMysqlBackend } from "src";

interface ILastAccessedRow extends mysql.RowDataPacket {
    last_accessed_at: Date;
}

const connectionUri = process.env.MYSQL_URI;

if (!connectionUri) {
    throw new Error("MYSQL_URI environment variable is required to run tests");
}

let connection: mysql.Connection;
let backend: IShortLinksManagerMysqlBackend;

beforeEach(async () => {
    connection = await mysql.createConnection(connectionUri);
    backend = createMysqlBackend(connectionUri);
    await backend.init?.();
    await backend.setupTables();
});

afterEach(async () => {
    if (connection) {
        await connection.execute("DROP TABLE IF EXISTS sl_links_map");
        await connection.execute("DROP TABLE IF EXISTS sl_base_urls");
        await connection.end();
    }
});

test("create a short link", async () => {
    const expected = ["aB0", "https://poto.nz"] as const;

    expect(backend.createShortLink(expected[0], expected[1], null)).resolves.toBeUndefined();
});

test("get url by short id", async () => {
    const shortId = "abCD90";
    const expected = "https://poto.nz";

    await connection.execute(
        "INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL)",
        [shortId, expected],
    );

    const url = backend.getTargetUrl(shortId, null);

    expect(url).resolves.toStrictEqual(expected);
});

test("get unused short links", async () => {
    const expectedRemoved = "abc";
    const expectedExist = "def";

    await connection.execute(
        "INSERT INTO sl_links_map (short_id, target_url, base_url_id, last_accessed_at) VALUES (?, ?, NULL, ?), (?, ?, NULL, ?)",
        [
            expectedExist, "https://poto.nz", lightFormat(new Date(), "yyyy-MM-dd HH:mm:ss"),
            expectedRemoved, "https://poto.nz", "1970-01-01 00:00:01",
        ],
    );

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

    await connection.execute(
        "INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL), (?, ?, NULL)",
        [existingIds[0], "https://poto.nz", existingIds[1], "https://poto.nz"],
    );

    const result = await backend.checkShortIdsExist([...existingIds, ...nonExistingIds], null);

    expect(result).toEqual(existingIds);
});

test("update short link last access time", async () => {
    const shortId = "accessTest";
    const targetUrl = "https://poto.nz";

    await connection.execute(
        "INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL)",
        [shortId, targetUrl],
    );

    const [initialRows] = await connection.execute<ILastAccessedRow[]>(
        "SELECT last_accessed_at FROM sl_links_map WHERE short_id = ? AND base_url_id IS NULL",
        [shortId],
    );

    await backend.updateShortLinkLastAccessTime(shortId, null, Date.now() + 1000);

    const [updatedRows] = await connection.execute<ILastAccessedRow[]>(
        "SELECT last_accessed_at FROM sl_links_map WHERE short_id = ? AND base_url_id IS NULL",
        [shortId],
    );

    expect(initialRows[0]).not.toBeNull();
    expect(updatedRows[0]).not.toBeNull();

    expect(updatedRows[0].last_accessed_at).not.toEqual(initialRows[0].last_accessed_at);
});

test("remove existing short link", async () => {
    const shortId = "removeTest";
    const targetUrl = "https://poto.nz";

    await connection.execute(
        "INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL)",
        [shortId, targetUrl],
    );

    const beforeResult = await backend.getTargetUrl(shortId, null);
    expect(beforeResult).toEqual(targetUrl);

    expect(backend.removeShortLink(shortId, null)).resolves.toBeUndefined();

    const afterResult = await backend.getTargetUrl(shortId, null);
    expect(afterResult).toBeNull();
});

test("remove non-existent short link should not throw error", async () => {
    expect(backend.removeShortLink("non-existent-id", null)).resolves.toBeUndefined();
});

test("update short link target url", async () => {
    const shortId = "updateTest";
    const originalUrl = "https://original.poto.nz";
    const updatedUrl = "https://updated.poto.nz";

    // Insert a record
    await connection.execute(
        "INSERT INTO sl_links_map (short_id, target_url, base_url_id) VALUES (?, ?, NULL)",
        [shortId, originalUrl],
    );

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
