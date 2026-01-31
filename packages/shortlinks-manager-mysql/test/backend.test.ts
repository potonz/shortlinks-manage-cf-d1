import { afterAll, beforeAll, expect, test } from "bun:test";
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

beforeAll(async () => {
    connection = await mysql.createConnection(connectionUri);
    backend = createMysqlBackend(connectionUri);
    await backend.init?.();
    await backend.setupTables();
});

afterAll(async () => {
    if (connection) {
        await connection.end();
    }
});

test("create a short link", async () => {
    const expected = ["aB0", "https://poto.nz"] as const;

    expect(backend.createShortLink(expected[0], expected[1])).resolves.toBeUndefined();
});

test("get url by short id", async () => {
    const shortId = "abCD90";
    const expected = "https://poto.nz";

    await connection.execute(
        "INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)",
        [shortId, expected],
    );

    const url = backend.getTargetUrl(shortId);

    expect(url).resolves.toStrictEqual(expected);
});

test("get unused short links", async () => {
    const expectedRemoved = "abc";
    const expectedExist = "def";

    await connection.execute(
        "INSERT INTO sl_links_map (short_id, target_url, last_accessed_at) VALUES (?, ?, ?), (?, ?, ?)",
        [
            expectedExist, "https://poto.nz", lightFormat(new Date(), "yyyy-MM-dd HH:mm:ss"),
            expectedRemoved, "https://poto.nz", "1970-01-01 00:00:00",
        ],
    );

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

    await connection.execute(
        "INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?), (?, ?)",
        [existingIds[0], "https://poto.nz", existingIds[1], "https://poto.nz"],
    );

    const result = await backend.checkShortIdsExist([...existingIds, ...nonExistingIds]);

    expect(result).toEqual(existingIds);
});

test("update short link last access time", async () => {
    const shortId = "accessTest";
    const targetUrl = "https://poto.nz";

    await connection.execute(
        "INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)",
        [shortId, targetUrl],
    );

    const [initialRows] = await connection.execute<ILastAccessedRow[]>(
        "SELECT last_accessed_at FROM sl_links_map WHERE short_id = ?",
        [shortId],
    );

    await backend.updateShortLinkLastAccessTime(shortId, Date.now() + 1000);

    const [updatedRows] = await connection.execute<ILastAccessedRow[]>(
        "SELECT last_accessed_at FROM sl_links_map WHERE short_id = ?",
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
        "INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)",
        [shortId, targetUrl],
    );

    const beforeResult = await backend.getTargetUrl(shortId);
    expect(beforeResult).toEqual(targetUrl);

    expect(backend.removeShortLink(shortId)).resolves.toBeUndefined();

    const afterResult = await backend.getTargetUrl(shortId);
    expect(afterResult).toBeNull();
});

test("remove non-existent short link should not throw error", async () => {
    expect(backend.removeShortLink("non-existent-id")).resolves.toBeUndefined();
});
