import { afterEach, beforeEach, expect, test } from "bun:test";
import postgres from "postgres";
import { createPostgresBackend, type IShortLinksManagerPostgresBackend } from "src";

const connectionUri = process.env.POSTGRES_URI;

if (!connectionUri) {
    throw new Error("POSTGRES_URI environment variable is required to run tests");
}

let sql: postgres.Sql;
let backend: IShortLinksManagerPostgresBackend;

beforeEach(async () => {
    sql = postgres(connectionUri);
    backend = createPostgresBackend(connectionUri);
    await backend.init?.();
    await backend.setupTables();
});

afterEach(async () => {
    if (sql) {
        await sql`DROP TABLE IF EXISTS sl_links_map`;
        await sql`DROP TABLE IF EXISTS sl_base_urls`;
        await sql.end();
    }
});

test("baseUrl: add a base URL", async () => {
    const baseUrl = "https://example.com";

    expect(backend.baseUrl.add(baseUrl)).resolves.toBeUndefined();
});

test("baseUrl: list base URLs", async () => {
    const baseUrl = "https://example.com";

    await backend.baseUrl.add(baseUrl);

    const urls = await backend.baseUrl.list();

    expect(urls.length).toBeGreaterThanOrEqual(1);
    expect(urls.some(u => u.baseUrl === baseUrl)).toBe(true);
});

test("baseUrl: get base URL ID", async () => {
    const baseUrl = "https://example.com";

    await backend.baseUrl.add(baseUrl);

    const id = await backend.baseUrl.getId(baseUrl);

    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);
});

test("baseUrl: remove base URL", async () => {
    const baseUrl = "https://example.com";

    await backend.baseUrl.add(baseUrl);
    const id = await backend.baseUrl.getId(baseUrl);

    expect(backend.baseUrl.remove(id)).resolves.toBeUndefined();

    const urls = await backend.baseUrl.list();
    expect(urls.some(u => u.baseUrl === baseUrl)).toBe(false);
});

test("create and retrieve short link with base URL", async () => {
    const baseUrl = "https://example.com";
    const shortId = "test123";
    const targetUrl = "https://poto.nz";

    await backend.baseUrl.add(baseUrl);
    const baseUrlId = await backend.baseUrl.getId(baseUrl);

    await backend.createShortLink(shortId, targetUrl, baseUrlId);

    const url = await backend.getTargetUrl(shortId, baseUrlId);
    expect(url).toStrictEqual(targetUrl);
});

test("same short ID with different base URLs returns different targets", async () => {
    const baseUrl1 = "https://example1.com";
    const baseUrl2 = "https://example2.com";
    const shortId = "sameId";
    const targetUrl1 = "https://target1.com";
    const targetUrl2 = "https://target2.com";

    await backend.baseUrl.add(baseUrl1);
    await backend.baseUrl.add(baseUrl2);
    const baseUrlId1 = await backend.baseUrl.getId(baseUrl1);
    const baseUrlId2 = await backend.baseUrl.getId(baseUrl2);

    await backend.createShortLink(shortId, targetUrl1, baseUrlId1);
    await backend.createShortLink(shortId, targetUrl2, baseUrlId2);

    const url1 = await backend.getTargetUrl(shortId, baseUrlId1);
    const url2 = await backend.getTargetUrl(shortId, baseUrlId2);

    expect(url1).toStrictEqual(targetUrl1);
    expect(url2).toStrictEqual(targetUrl2);
    expect(url1).not.toEqual(url2);
});

test("short link with base URL is not accessible with null baseUrlId", async () => {
    const baseUrl = "https://example.com";
    const shortId = "isolatedTest";
    const targetUrl = "https://poto.nz";

    await backend.baseUrl.add(baseUrl);
    const baseUrlId = await backend.baseUrl.getId(baseUrl);

    await backend.createShortLink(shortId, targetUrl, baseUrlId);

    const urlWithNull = await backend.getTargetUrl(shortId, null);
    expect(urlWithNull).toBeNull();
});

test("short link created with null baseUrlId is not accessible with base URL", async () => {
    const baseUrl = "https://example.com";
    const shortId = "nullBase";
    const targetUrl = "https://poto.nz";

    await backend.baseUrl.add(baseUrl);
    const baseUrlId = await backend.baseUrl.getId(baseUrl);

    await backend.createShortLink(shortId, targetUrl, null);

    const urlWithBase = await backend.getTargetUrl(shortId, baseUrlId);
    expect(urlWithBase).toBeNull();

    const urlWithNull = await backend.getTargetUrl(shortId, null);
    expect(urlWithNull).toStrictEqual(targetUrl);
});

test("checkShortIdsExist with base URL", async () => {
    const baseUrl = "https://example.com";
    const shortId1 = "checkTest1";
    const shortId2 = "checkTest2";
    const targetUrl = "https://poto.nz";

    await backend.baseUrl.add(baseUrl);
    const baseUrlId = await backend.baseUrl.getId(baseUrl);

    await backend.createShortLink(shortId1, targetUrl, baseUrlId);

    const existing = await backend.checkShortIdsExist([shortId1, shortId2], baseUrlId);
    expect(existing).toContain(shortId1);
    expect(existing).not.toContain(shortId2);
});

test("checkShortIdsExist isolates between base URLs", async () => {
    const baseUrl1 = "https://example1.com";
    const baseUrl2 = "https://example2.com";
    const shortId = "sharedId";
    const targetUrl = "https://poto.nz";

    await backend.baseUrl.add(baseUrl1);
    await backend.baseUrl.add(baseUrl2);
    const baseUrlId1 = await backend.baseUrl.getId(baseUrl1);
    const baseUrlId2 = await backend.baseUrl.getId(baseUrl2);

    await backend.createShortLink(shortId, targetUrl, baseUrlId1);

    const result1 = await backend.checkShortIdsExist([shortId], baseUrlId1);
    const result2 = await backend.checkShortIdsExist([shortId], baseUrlId2);
    const resultNull = await backend.checkShortIdsExist([shortId], null);

    expect(result1).toContain(shortId);
    expect(result2).not.toContain(shortId);
    expect(resultNull).not.toContain(shortId);
});

test("updateShortLinkLastAccessTime with base URL", async () => {
    const baseUrl = "https://example.com";
    const shortId = "accessUpdate";
    const targetUrl = "https://poto.nz";

    await backend.baseUrl.add(baseUrl);
    const baseUrlId = await backend.baseUrl.getId(baseUrl);

    await backend.createShortLink(shortId, targetUrl, baseUrlId);

    const initialResult = await sql<{ last_accessed_at: Date }[]>`
        SELECT last_accessed_at 
        FROM sl_links_map 
        WHERE short_id = ${shortId} AND base_url_id = ${baseUrlId}
    `;

    await backend.updateShortLinkLastAccessTime(shortId, baseUrlId, Date.now() + 100000);

    const updatedResult = await sql<{ last_accessed_at: Date }[]>`
        SELECT last_accessed_at 
        FROM sl_links_map 
        WHERE short_id = ${shortId} AND base_url_id = ${baseUrlId}
    `;

    expect(initialResult[0]).not.toBeNull();
    expect(updatedResult[0]).not.toBeNull();
    expect(updatedResult[0].last_accessed_at).not.toEqual(initialResult[0].last_accessed_at);
});

test("update short link target url with base URL", async () => {
    const baseUrl = "https://example.com";
    const shortId = "updateTest";
    const originalUrl = "https://original.poto.nz";
    const updatedUrl = "https://updated.poto.nz";

    await backend.baseUrl.add(baseUrl);
    const baseUrlId = await backend.baseUrl.getId(baseUrl);

    await backend.createShortLink(shortId, originalUrl, baseUrlId);

    const beforeResult = await backend.getTargetUrl(shortId, baseUrlId);
    expect(beforeResult).toEqual(originalUrl);

    const updateResult = await backend.updateShortLink(shortId, updatedUrl, baseUrlId);
    expect(updateResult).toBe(true);

    const afterResult = await backend.getTargetUrl(shortId, baseUrlId);
    expect(afterResult).toEqual(updatedUrl);
});

test("update non-existent short link should return false with base URL", async () => {
    const baseUrl = "https://example.com";
    await backend.baseUrl.add(baseUrl);
    const baseUrlId = await backend.baseUrl.getId(baseUrl);

    const result = await backend.updateShortLink("non-existent", "https://new.url", baseUrlId);
    expect(result).toBe(false);
});

test("update isolates between base URLs", async () => {
    const baseUrl1 = "https://example1.com";
    const baseUrl2 = "https://example2.com";
    const shortId = "sharedUpdate";
    const targetUrl1 = "https://target1.poto.nz";
    const targetUrl2 = "https://target2.poto.nz";

    await backend.baseUrl.add(baseUrl1);
    await backend.baseUrl.add(baseUrl2);
    const baseUrlId1 = await backend.baseUrl.getId(baseUrl1);
    const baseUrlId2 = await backend.baseUrl.getId(baseUrl2);

    await backend.createShortLink(shortId, targetUrl1, baseUrlId1);
    await backend.createShortLink(shortId, targetUrl2, baseUrlId2);

    await backend.updateShortLink(shortId, "https://updated1.poto.nz", baseUrlId1);

    const result1 = await backend.getTargetUrl(shortId, baseUrlId1);
    const result2 = await backend.getTargetUrl(shortId, baseUrlId2);

    expect(result1).toEqual("https://updated1.poto.nz");
    expect(result2).toEqual(targetUrl2);
});

test("removeShortLink with base URL", async () => {
    const baseUrl = "https://example.com";
    const shortId = "removeTest";
    const targetUrl = "https://poto.nz";

    await backend.baseUrl.add(baseUrl);
    const baseUrlId = await backend.baseUrl.getId(baseUrl);

    await backend.createShortLink(shortId, targetUrl, baseUrlId);

    const beforeResult = await backend.getTargetUrl(shortId, baseUrlId);
    expect(beforeResult).toEqual(targetUrl);

    await backend.removeShortLink(shortId, baseUrlId);

    const afterResult = await backend.getTargetUrl(shortId, baseUrlId);
    expect(afterResult).toBeNull();
});

test("removeShortLink isolates between base URLs", async () => {
    const baseUrl1 = "https://example1.com";
    const baseUrl2 = "https://example2.com";
    const shortId = "sharedRemove";
    const targetUrl = "https://poto.nz";

    await backend.baseUrl.add(baseUrl1);
    await backend.baseUrl.add(baseUrl2);
    const baseUrlId1 = await backend.baseUrl.getId(baseUrl1);
    const baseUrlId2 = await backend.baseUrl.getId(baseUrl2);

    await backend.createShortLink(shortId, targetUrl, baseUrlId1);
    await backend.createShortLink(shortId, targetUrl, baseUrlId2);

    await backend.removeShortLink(shortId, baseUrlId1);

    const result1 = await backend.getTargetUrl(shortId, baseUrlId1);
    const result2 = await backend.getTargetUrl(shortId, baseUrlId2);

    expect(result1).toBeNull();
    expect(result2).toStrictEqual(targetUrl);
});

test("cleanUnusedLinks returns baseUrlId", async () => {
    const baseUrl = "https://example.com";
    const shortId = "cleanTest";
    const targetUrl = "https://poto.nz";

    await backend.baseUrl.add(baseUrl);
    const baseUrlId = await backend.baseUrl.getId(baseUrl);

    await sql`
        INSERT INTO sl_links_map (short_id, target_url, base_url_id, last_accessed_at) 
        VALUES (${shortId}, ${targetUrl}, ${baseUrlId}, ${"1970-01-01 00:00:00"})
    `;

    const cleaned = await backend.cleanUnusedLinks(1);

    expect(cleaned.length).toBeGreaterThan(0);
    expect(cleaned.some(r => r.shortId === shortId && r.baseUrlId === baseUrlId)).toBe(true);
});

test("list base URLs with includeInactive", async () => {
    const baseUrl = "https://example.com";

    await backend.baseUrl.add(baseUrl);
    const id = await backend.baseUrl.getId(baseUrl);

    await backend.baseUrl.remove(id);

    const inactiveUrls = await backend.baseUrl.list(true);
    const activeUrls = await backend.baseUrl.list(false);

    expect(inactiveUrls.some(u => u.baseUrl === baseUrl && u.isActive === false)).toBe(true);
    expect(activeUrls.some(u => u.baseUrl === baseUrl)).toBe(false);
});
