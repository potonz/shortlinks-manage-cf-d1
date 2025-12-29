import { test, expect, beforeAll, afterAll } from "bun:test";
import { Miniflare } from "miniflare";
import { lightFormat } from "date-fns";
import { LinksManager } from "../src";
import { globSync } from "fs";
import { ALLOWED_CHARS } from "../src/utils";

let mf: Miniflare;

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

    const migrationFiles = globSync("./migrations/*.sql");
    const db = await mf.getD1Database("DB");

    for (const file of migrationFiles) {
        const sql = await Bun.file(file).text();
        await db.prepare(sql).run();
    }
});

afterAll(async () => {
    await mf.dispose();
});

test("create a short link (empty db)", async () => {
    const db = await mf.getD1Database("DB");

    let idLength = 3;
    const manager = new LinksManager(db, idLength, (l) => {
        idLength = l;
    });

    const shortId = await manager.createShortLink("https://poto.nz");

    expect(shortId).toBeString();
    expect(shortId).toHaveLength(idLength);
    expect(shortId).toMatch(/^[0-9a-zA-Z]+$/);
});

test("create a short link (ID length bump)", async () => {
    const db = await mf.getD1Database("DB");

    const queries = [];
    const stmt = db.prepare("INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)");

    for (let i = 0; i < ALLOWED_CHARS.length; i++) {
        queries.push(
            stmt.bind(ALLOWED_CHARS[i], "https://poto.nz"),
        );
    }
    await db.batch(queries);

    let idLength = 1;
    const manager = new LinksManager(db, idLength, (l) => {
        idLength = l;
    });

    const shortId = await manager.createShortLink("https://poto.nz");

    expect(idLength).toBeGreaterThan(1);
    expect(shortId).toBeString();
    expect(shortId).toHaveLength(idLength);
    expect(shortId).toMatch(/^[0-9a-zA-Z]+$/);
});

test("get url by short id", async () => {
    const db = await mf.getD1Database("DB");

    const shortId = "abCD90";
    const expected = "https://poto.nz";

    await db.prepare("INSERT INTO sl_links_map (short_id, target_url) VALUES (?, ?)")
        .bind(shortId, expected)
        .run();

    const manager = new LinksManager(db, 3, () => undefined);
    const url = await manager.getTargetUrl(shortId);

    expect(url).toStrictEqual(expected);
});

test("get unused short links", async () => {
    const db = await mf.getD1Database("DB");

    const expectedRemoved = "abc";
    const expectedExist = "def";

    await db.prepare("INSERT INTO sl_links_map (short_id, target_url, last_accessed_at) VALUES (?, ?, ?), (?, ?, ?)")
        .bind(
            expectedExist, "https://poto.nz", lightFormat(new Date(), "yyyy-MM-dd HH:mm:ss"),
            expectedRemoved, "https://poto.nz", "1970-01-01 00:00:00",
        )
        .run();

    const manager = new LinksManager(db, 3, () => undefined);
    await manager.cleanUnusedLinks(1);

    const removedUrl = await manager.getTargetUrl(expectedRemoved);
    expect(removedUrl).toBeNull();
    const existUrl = await manager.getTargetUrl(expectedExist);
    expect(existUrl).not.toBeNull();
});
