import { createHmac, randomUUID } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { openDatabase } from "./db.js";
// ── Constants ─────────────────────────────────────────────────────────────
const PUBLIC_DIR = resolve("public");
const MAX_BODY_BYTES = 1_000_000;
const MIME_TYPES = new Map([
    [".html", "text/html; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".svg", "image/svg+xml"],
]);
// ── App factory ───────────────────────────────────────────────────────────
export function createApp(options = {}) {
    const db = options.db ?? openDatabase(options.dbPath);
    const publicDir = options.publicDir ? resolve(options.publicDir) : PUBLIC_DIR;
    const metadataFetcher = options.metadataFetcher ?? fetchPageMetadata;
    const codeSecret = options.codeSecret ?? process.env["CODE_HASH_SECRET"] ?? "local-development-secret";
    const handler = async (req, res) => {
        try {
            const url = new URL(req.url ?? "/", `http://${req.headers["host"] ?? "localhost"}`);
            if (url.pathname.startsWith("/api/")) {
                await routeApi(req, res, url, { db, metadataFetcher, codeSecret });
                return;
            }
            await serveStatic(req, res, url, publicDir);
        }
        catch (error) {
            console.error(error);
            sendJson(res, 500, { error: "Something went wrong. Please try again." });
        }
    };
    handler.db = db;
    return handler;
}
export function createServer(options = {}) {
    return createHttpServer(createApp(options));
}
async function routeApi(req, res, url, ctx) {
    // POST /api/session — open the shared shelf without creating a member.
    if (req.method === "POST" && url.pathname === "/api/session") {
        const body = await readJsonBody(req);
        const code = normalizeCode(body?.["code"]);
        if (code.length < 4 || code.length > 80) {
            sendJson(res, 400, { error: "Shared code must be between 4 and 80 characters." });
            return;
        }
        const couple = await getOrCreateCouple(ctx.db, hashCode(code, ctx.codeSecret));
        if (!couple) {
            sendJson(res, 500, { error: "Couldn’t open that shelf." });
            return;
        }
        sendJson(res, 200, { people: await listPeople(ctx.db, couple.id), ownerName: await getOwnerName(ctx.db, couple.id) });
        return;
    }
    if (req.method === "GET" && url.pathname === "/api/people") {
        const auth = await authenticateCodeRequest(req, ctx.db, ctx.codeSecret);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        sendJson(res, 200, { people: await listPeople(ctx.db, auth.couple.id), ownerName: await getOwnerName(ctx.db, auth.couple.id) });
        return;
    }
    if (req.method === "POST" && url.pathname === "/api/people") {
        const auth = await authenticateCodeRequest(req, ctx.db, ctx.codeSecret);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        const body = await readJsonBody(req);
        const name = normalizeName(body?.["name"]);
        if (!name || name.length > 60) {
            sendJson(res, 400, { error: "Enter a name up to 60 characters long." });
            return;
        }
        const people = await listPeople(ctx.db, auth.couple.id);
        const nameKey = normalizedNameKey(name);
        const exact = people.find((person) => normalizedNameKey(person.name) === nameKey);
        if (exact) {
            sendJson(res, 200, { person: exact, existing: true, ownerName: await getOwnerName(ctx.db, auth.couple.id) });
            return;
        }
        const similar = people.filter((person) => namesOneSlipApart(nameKey, normalizedNameKey(person.name)));
        if (similar.length && body?.["confirmSimilar"] !== true) {
            sendJson(res, 409, {
                error: "A similar name is already here.",
                similarPeople: similar.map(({ name: personName, linkCount }) => ({ name: personName, linkCount })),
            });
            return;
        }
        const person = await ctx.db.get(`
      INSERT INTO members (couple_id, name)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `, [auth.couple.id, name]) ?? await ctx.db.get("SELECT id, name FROM members WHERE couple_id = $1 AND name = $2 AND active", [auth.couple.id, name]);
        if (person)
            await ctx.db.query("UPDATE couples SET owner_name = $2 WHERE id = $1 AND owner_name IS NULL", [auth.couple.id, person.name]);
        sendJson(res, 201, { person, existing: false, ownerName: await getOwnerName(ctx.db, auth.couple.id) });
        return;
    }
    if (req.method === "POST" && url.pathname === "/api/people/merge") {
        const auth = await authenticateOwnerRequest(req, ctx.db, ctx.codeSecret);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        const body = await readJsonBody(req);
        const keepName = normalizeName(body?.["keepName"]);
        const sourceNames = [...new Set(Array.isArray(body?.["sourceNames"]) ? body["sourceNames"].map(normalizeName).filter(Boolean) : [])];
        if (!keepName || sourceNames.length === 0 || sourceNames.includes(keepName) || sourceNames.some((name) => name.length > 60)) {
            sendJson(res, 400, { error: "Choose a name to keep and at least one different name to merge." });
            return;
        }
        const result = await ctx.db.get(`
      WITH requested AS (
        SELECT DISTINCT unnest($2::text[]) AS name
      ), selected AS (
        SELECT m.name FROM members m
        WHERE m.couple_id = $1 AND m.active AND (m.name = $3 OR m.name IN (SELECT name FROM requested))
      ), valid AS (
        SELECT COUNT(*) = (SELECT COUNT(*) FROM requested) + 1 AS ok FROM selected
      ), moved AS (
        UPDATE links SET saver_name = $3
        WHERE couple_id = $1 AND saver_name IN (SELECT name FROM requested)
          AND (SELECT ok FROM valid)
        RETURNING id
      ), deleted AS (
        UPDATE members SET active = FALSE
        WHERE couple_id = $1 AND name IN (SELECT name FROM requested)
          AND (SELECT ok FROM valid)
        RETURNING name
      ), owner_changed AS (
        UPDATE couples SET owner_name = $3
        WHERE id = $1 AND owner_name IN (SELECT name FROM requested) AND (SELECT ok FROM valid)
        RETURNING id
      )
      SELECT (SELECT ok FROM valid) AS valid, (SELECT COUNT(*)::int FROM deleted) AS merged
    `, [auth.couple.id, sourceNames, keepName]);
        if (!result?.valid || result.merged !== sourceNames.length) {
            sendJson(res, 400, { error: "Those names changed. Refresh the people list and try again." });
            return;
        }
        sendJson(res, 200, { keepName, merged: result.merged, people: await listPeople(ctx.db, auth.couple.id), ownerName: await getOwnerName(ctx.db, auth.couple.id) });
        return;
    }
    if (req.method === "POST" && url.pathname === "/api/people/rename") {
        const auth = await authenticateOwnerRequest(req, ctx.db, ctx.codeSecret);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        const body = await readJsonBody(req);
        const oldName = normalizeName(body?.["oldName"]);
        const newName = normalizeName(body?.["newName"]);
        if (!oldName || !newName || newName.length > 60) {
            sendJson(res, 400, { error: "Enter a name up to 60 characters long." });
            return;
        }
        const source = await ctx.db.get("SELECT id, name FROM members WHERE couple_id = $1 AND name = $2 AND active", [auth.couple.id, oldName]);
        if (!source) {
            sendJson(res, 404, { error: "That person is no longer on the shelf." });
            return;
        }
        const existing = (await listPeople(ctx.db, auth.couple.id)).find((person) => person.name !== oldName && normalizedNameKey(person.name) === normalizedNameKey(newName));
        if (existing) {
            sendJson(res, 409, { error: `${existing.name} is already on the shelf. Merge these names instead.` });
            return;
        }
        if (oldName !== newName) {
            await ctx.db.query(`
        WITH moved_links AS (
          UPDATE links SET saver_name = $3 WHERE couple_id = $1 AND saver_name = $2 RETURNING id
        ), copied_favorites AS (
          INSERT INTO link_favorites (link_id, user_name)
          SELECT f.link_id, $3 FROM link_favorites f
          JOIN links l ON l.id = f.link_id AND l.couple_id = $1
          WHERE f.user_name = $2
          ON CONFLICT (link_id, user_name) DO NOTHING RETURNING link_id
        ), removed_old_favorites AS (
          DELETE FROM link_favorites WHERE user_name = $2
            AND link_id IN (SELECT id FROM links WHERE couple_id = $1) RETURNING link_id
        ), renamed_member AS (
          UPDATE members SET name = $3 WHERE id = $4 RETURNING id
        )
        UPDATE couples SET owner_name = $3 WHERE id = $1 AND owner_name = $2
      `, [auth.couple.id, oldName, newName, source.id]);
        }
        sendJson(res, 200, { oldName, newName, people: await listPeople(ctx.db, auth.couple.id), ownerName: await getOwnerName(ctx.db, auth.couple.id) });
        return;
    }
    if (req.method === "POST" && url.pathname === "/api/people/remove") {
        const auth = await authenticateOwnerRequest(req, ctx.db, ctx.codeSecret);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        const body = await readJsonBody(req);
        const name = normalizeName(body?.["name"]);
        const keepLinks = body?.["keepLinks"] !== false;
        if (!name || name === auth.name) {
            sendJson(res, 400, { error: "The shelf owner can’t remove themselves." });
            return;
        }
        const person = await ctx.db.get(`
      SELECT m.id, m.name, COUNT(l.id)::int AS "linkCount"
      FROM members m LEFT JOIN links l ON l.couple_id = m.couple_id AND l.saver_name = m.name
      WHERE m.couple_id = $1 AND m.name = $2 AND m.active
      GROUP BY m.id, m.name
    `, [auth.couple.id, name]);
        if (!person) {
            sendJson(res, 404, { error: "That person is no longer on the shelf." });
            return;
        }
        if (keepLinks) {
            const token = randomUUID();
            const result = await ctx.db.get(`
        WITH source_member AS (
          SELECT id FROM members WHERE couple_id = $1 AND name = $2 AND active
        ), affected_links AS (
          SELECT id FROM links WHERE couple_id = $1 AND saver_name = $2
        ), moved_links AS (
          UPDATE links SET saver_name = 'Former member'
          WHERE id IN (SELECT id FROM affected_links) AND EXISTS (SELECT 1 FROM source_member)
          RETURNING id
        ), removed_favorites AS (
          DELETE FROM link_favorites WHERE user_name = $2
            AND link_id IN (SELECT id FROM links WHERE couple_id = $1) RETURNING link_id
        ), removal_record AS (
          INSERT INTO member_removals (token, couple_id, member_id, member_name, link_ids, favorite_link_ids)
          SELECT $3, $1, (SELECT id FROM source_member), $2,
            COALESCE((SELECT array_agg(id) FROM moved_links), '{}'::int[]),
            COALESCE((SELECT array_agg(link_id) FROM removed_favorites), '{}'::int[])
          WHERE EXISTS (SELECT 1 FROM source_member)
          RETURNING token, link_ids
        ), inactive_member AS (
          UPDATE members SET active = FALSE WHERE id = (SELECT id FROM source_member) RETURNING id
        )
        SELECT token, cardinality(link_ids)::int AS "linkCount" FROM removal_record
      `, [auth.couple.id, name, token]);
            if (!result) {
                sendJson(res, 409, { error: "Couldn’t remove that person. Refresh and try again." });
                return;
            }
            sendJson(res, 200, { name, keptLinks: result.linkCount, undoToken: result.token, people: await listPeople(ctx.db, auth.couple.id) });
            return;
        }
        const result = await ctx.db.get(`
      WITH deleted_links AS (
        DELETE FROM links WHERE couple_id = $1 AND saver_name = $2 RETURNING id
      ), deleted_favorites AS (
        DELETE FROM link_favorites WHERE user_name = $2
          AND link_id IN (SELECT id FROM links WHERE couple_id = $1) RETURNING link_id
      ), inactive_member AS (
        UPDATE members SET active = FALSE WHERE couple_id = $1 AND name = $2 AND active RETURNING id
      )
      SELECT COUNT(*)::int AS "deletedCount" FROM deleted_links
    `, [auth.couple.id, name]);
        sendJson(res, 200, { name, deletedLinks: result?.deletedCount ?? 0, people: await listPeople(ctx.db, auth.couple.id) });
        return;
    }
    if (req.method === "POST" && url.pathname === "/api/people/undo-remove") {
        const auth = await authenticateOwnerRequest(req, ctx.db, ctx.codeSecret);
        if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
        }
        const body = await readJsonBody(req);
        const token = typeof body?.["token"] === "string" ? body["token"] : "";
        const result = await ctx.db.get(`
      WITH removal AS (
        SELECT * FROM member_removals WHERE token = $2 AND couple_id = $1
          AND created_at > NOW() - INTERVAL '10 minutes'
      ), restored_member AS (
        UPDATE members SET active = TRUE
        WHERE id = (SELECT member_id FROM removal)
          AND NOT EXISTS (SELECT 1 FROM members other WHERE other.couple_id = $1 AND other.active AND other.name = (SELECT member_name FROM removal))
        RETURNING id
      ), restored_links AS (
        UPDATE links SET saver_name = (SELECT member_name FROM removal)
        WHERE couple_id = $1 AND id = ANY((SELECT link_ids FROM removal))
          AND saver_name = 'Former member' AND EXISTS (SELECT 1 FROM restored_member)
        RETURNING id
      ), restored_favorites AS (
        INSERT INTO link_favorites (link_id, user_name)
        SELECT unnest(favorite_link_ids), member_name FROM removal
        WHERE EXISTS (SELECT 1 FROM restored_member)
        ON CONFLICT (link_id, user_name) DO NOTHING RETURNING link_id
      ), consumed AS (
        DELETE FROM member_removals WHERE token = $2 AND EXISTS (SELECT 1 FROM restored_member)
        RETURNING member_name
      )
      SELECT member_name AS "memberName", cardinality(link_ids)::int AS "linkCount" FROM removal
      WHERE EXISTS (SELECT 1 FROM consumed)
    `, [auth.couple.id, token]);
        if (!result) {
            sendJson(res, 409, { error: "Undo isn’t available anymore. The name may have been reused, or the 10-minute window ended." });
            return;
        }
        sendJson(res, 200, { name: result.memberName, restoredLinks: result.linkCount, people: await listPeople(ctx.db, auth.couple.id) });
        return;
    }
    // All other routes require authentication
    const auth = await authenticateRequest(req, ctx.db, ctx.codeSecret);
    if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error });
        return;
    }
    if (req.method === "POST" && url.pathname === "/api/preview-metadata") {
        const body = await readJsonBody(req);
        const targetUrl = normalizeUrl(body?.["url"]);
        if (!targetUrl) {
            sendJson(res, 400, { error: "Enter a valid http or https URL." });
            return;
        }
        let metadata = emptyPageMetadata();
        try {
            metadata = await ctx.metadataFetcher(targetUrl);
        }
        catch { /* Preview still shows its domain if a site blocks metadata. */ }
        sendJson(res, 200, { metadata });
        return;
    }
    // GET /api/links
    if (req.method === "GET" && url.pathname === "/api/links") {
        const rows = await ctx.db.all(`
      SELECT links.id, url, title, og_title AS "ogTitle", note, tags,
             EXISTS (
               SELECT 1 FROM link_favorites
               WHERE link_id = links.id AND user_name = $2
             ) AS "isFavorite",
             preview_image AS "previewImage", favicon_url AS "faviconUrl",
             description, site_name AS "siteName", metadata_fetched_at AS "metadataFetchedAt",
             saver_name AS "saverName",
             created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM links
      WHERE couple_id = $1
      ORDER BY created_at DESC, id DESC
    `, [auth.couple.id, auth.name]);
        sendJson(res, 200, { links: rows });
        return;
    }
    // POST /api/links
    if (req.method === "POST" && url.pathname === "/api/links") {
        const body = await readJsonBody(req);
        const parsed = validateLinkBody(body, { requireUrl: true });
        if (!parsed.ok) {
            sendJson(res, 400, { error: parsed.error });
            return;
        }
        const existingLinks = await ctx.db.all('SELECT id, url, title, saver_name AS "saverName", created_at AS "createdAt" FROM links WHERE couple_id = $1', [auth.couple.id]);
        const duplicate = existingLinks.find((link) => canonicalizeUrl(link.url) === canonicalizeUrl(parsed.url));
        if (duplicate) {
            sendJson(res, 200, { duplicate: true, link: duplicate });
            return;
        }
        let metadata = emptyPageMetadata();
        try {
            metadata = await ctx.metadataFetcher(parsed.url);
        }
        catch { /* Saving the URL still succeeds without metadata. */ }
        const title = parsed.title || metadata.title || parsed.url;
        const row = await ctx.db.get(`
      INSERT INTO links (
        couple_id, url, title, og_title, note, saver_name, tags, preview_image, description,
        site_name, favicon_url, metadata_fetched_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `, [
            auth.couple.id,
            parsed.url,
            title,
            normalizeText(metadata.title, 140) ?? "",
            parsed.note ?? "",
            auth.name,
            parsed.tags ?? [],
            normalizeUrl(metadata.image) ?? null,
            normalizeText(metadata.description, 400) ?? "",
            normalizeText(metadata.siteName, 100) ?? "",
            normalizeUrl(metadata.favicon) ?? null,
            Object.values(metadata).some(Boolean) ? new Date() : null,
        ]);
        const link = await getLink(ctx.db, auth.couple.id, row.id, auth.name);
        sendJson(res, 201, { link });
        return;
    }
    // GET /api/links/:id  or  PATCH /api/links/:id  or  DELETE /api/links/:id
    const favoriteMatch = url.pathname.match(/^\/api\/links\/(\d+)\/favorite$/);
    if (favoriteMatch && req.method === "POST") {
        const id = Number(favoriteMatch[1]);
        const existing = await getLink(ctx.db, auth.couple.id, id, auth.name);
        if (!existing) {
            sendJson(res, 404, { error: "Link not found." });
            return;
        }
        // Vercel's Node adapter can omit the streamed body. Accept the same
        // explicit headers used by the link PATCH fallback, while keeping JSON
        // bodies supported for the local server and existing clients.
        const vercelQuery = req.query;
        const headerFavorite = req.headers["x-sharelink-favorite"];
        const headerAction = req.headers["x-sharelink-action"];
        const favoriteParam = headerAction === "favorite" &&
            (headerFavorite === "true" || headerFavorite === "false")
            ? headerFavorite
            : url.searchParams.get("favorite") ??
                (typeof vercelQuery?.["favorite"] === "string" ? vercelQuery["favorite"] : null);
        if (favoriteParam === "true" || favoriteParam === "false") {
            await setFavorite(ctx.db, id, auth.name, favoriteParam === "true");
            sendJson(res, 200, { link: await getLink(ctx.db, auth.couple.id, id, auth.name) });
            return;
        }
        const body = await readJsonBody(req);
        if (typeof body?.["isFavorite"] !== "boolean") {
            sendJson(res, 400, { error: "Choose whether this link is a favorite." });
            return;
        }
        await setFavorite(ctx.db, id, auth.name, body["isFavorite"]);
        sendJson(res, 200, { link: await getLink(ctx.db, auth.couple.id, id, auth.name) });
        return;
    }
    const metadataMatch = url.pathname.match(/^\/api\/links\/(\d+)\/metadata$/);
    if (metadataMatch && req.method === "POST") {
        const id = Number(metadataMatch[1]);
        const existing = await getLink(ctx.db, auth.couple.id, id, auth.name);
        if (!existing) {
            sendJson(res, 404, { error: "Link not found." });
            return;
        }
        // Cache both complete metadata and image-less attempts so hovering does
        // not fetch the same page repeatedly. Retry stale metadata once per day.
        const fetchedAt = Date.parse(existing.metadataFetchedAt ?? "");
        if (Number.isFinite(fetchedAt) && Date.now() - fetchedAt < 24 * 60 * 60 * 1000) {
            sendJson(res, 200, { link: existing });
            return;
        }
        let metadata = emptyPageMetadata();
        try {
            metadata = await ctx.metadataFetcher(existing.url);
        }
        catch { /* Keep the saved link usable without metadata. */ }
        await ctx.db.query(`
      UPDATE links
      SET og_title = COALESCE(NULLIF($1, ''), og_title),
          preview_image = COALESCE($2, preview_image),
          description = COALESCE(NULLIF($3, ''), description),
          site_name = COALESCE(NULLIF($4, ''), site_name),
          favicon_url = COALESCE($5, favicon_url), metadata_fetched_at = NOW()
      WHERE id = $6 AND couple_id = $7
    `, [
            normalizeText(metadata.title, 140) ?? "",
            normalizeUrl(metadata.image) ?? null,
            normalizeText(metadata.description, 400) ?? "",
            normalizeText(metadata.siteName, 100) ?? "",
            normalizeUrl(metadata.favicon) ?? null,
            id,
            auth.couple.id,
        ]);
        sendJson(res, 200, { link: await getLink(ctx.db, auth.couple.id, id, auth.name) });
        return;
    }
    const match = url.pathname.match(/^\/api\/links\/(\d+)$/);
    if (match) {
        const id = Number(match[1]);
        if (req.method === "GET") {
            const existing = await getLink(ctx.db, auth.couple.id, id, auth.name);
            if (!existing) {
                sendJson(res, 404, { error: "Link not found." });
                return;
            }
            sendJson(res, 200, { link: existing });
            return;
        }
        if (req.method === "PATCH") {
            const existing = await getLink(ctx.db, auth.couple.id, id, auth.name);
            if (!existing) {
                sendJson(res, 404, { error: "Link not found." });
                return;
            }
            // The Vercel adapter may not expose a streamed JSON body to this Node
            // handler. Accept the favorite value in the query string as well.
            const vercelQuery = req.query;
            const headerFavorite = req.headers["x-sharelink-favorite"];
            const favoriteParam = req.headers["x-sharelink-action"] === "favorite" &&
                (headerFavorite === "true" || headerFavorite === "false")
                ? headerFavorite
                : url.searchParams.get("favorite") ??
                    (typeof vercelQuery?.["favorite"] === "string" ? vercelQuery["favorite"] : null);
            if (favoriteParam === "true" || favoriteParam === "false") {
                const isFavorite = favoriteParam === "true";
                await setFavorite(ctx.db, id, auth.name, isFavorite);
                sendJson(res, 200, { link: await getLink(ctx.db, auth.couple.id, id, auth.name) });
                return;
            }
            const body = await readJsonBody(req);
            if (typeof body?.["isFavorite"] === "boolean") {
                await setFavorite(ctx.db, id, auth.name, body["isFavorite"]);
                sendJson(res, 200, { link: await getLink(ctx.db, auth.couple.id, id, auth.name) });
                return;
            }
            if (existing.saverName !== auth.name) {
                sendJson(res, 403, { error: "Only the partner who saved this link can edit it." });
                return;
            }
            const parsed = validateLinkBody(body, { requireUrl: false });
            if (!parsed.ok) {
                sendJson(res, 400, { error: parsed.error });
                return;
            }
            const nextUrl = parsed.url ?? existing.url;
            const nextTitle = parsed.title ?? existing.title;
            const nextNote = parsed.note ?? existing.note;
            const nextTags = parsed.tags ?? existing.tags ?? [];
            await ctx.db.query(`
        UPDATE links
        SET url = $1, title = $2, note = $3, tags = $4,
            og_title = CASE WHEN url <> $1 THEN '' ELSE og_title END,
            preview_image = CASE WHEN url <> $1 THEN NULL ELSE preview_image END,
            description = CASE WHEN url <> $1 THEN '' ELSE description END,
            site_name = CASE WHEN url <> $1 THEN '' ELSE site_name END,
            favicon_url = CASE WHEN url <> $1 THEN NULL ELSE favicon_url END,
            metadata_fetched_at = CASE WHEN url <> $1 THEN NULL ELSE metadata_fetched_at END,
            updated_at = NOW()
        WHERE id = $5 AND couple_id = $6
      `, [nextUrl, nextTitle || nextUrl, nextNote, nextTags, id, auth.couple.id]);
            sendJson(res, 200, { link: await getLink(ctx.db, auth.couple.id, id, auth.name) });
            return;
        }
        if (req.method === "DELETE") {
            const existing = await getLink(ctx.db, auth.couple.id, id, auth.name);
            if (!existing) {
                sendJson(res, 404, { error: "Link not found." });
                return;
            }
            if (existing.saverName !== auth.name) {
                sendJson(res, 403, { error: "Only the partner who saved this link can delete it." });
                return;
            }
            await ctx.db.query("DELETE FROM links WHERE id = $1 AND couple_id = $2", [id, auth.couple.id]);
            sendJson(res, 200, { deleted: true });
            return;
        }
    }
    sendJson(res, 404, { error: "Not found." });
}
function validateAuthBody(body) {
    const raw = body;
    const name = normalizeName(raw?.["name"]);
    const code = normalizeCode(raw?.["code"]);
    if (!name)
        return { ok: false, error: "Enter your name." };
    if (name.length > 60)
        return { ok: false, error: "Name must be 60 characters or fewer." };
    if (!code)
        return { ok: false, error: "Enter the shared code." };
    if (code.length < 4 || code.length > 80)
        return { ok: false, error: "Shared code must be between 4 and 80 characters." };
    return { ok: true, name, code };
}
function validateLinkBody(body, { requireUrl }) {
    const raw = body;
    const url = raw?.["url"] === undefined ? undefined : normalizeUrl(raw["url"]);
    const title = raw?.["title"] === undefined ? undefined : normalizeText(raw["title"], 140);
    const note = raw?.["note"] === undefined ? undefined : normalizeText(raw["note"], 600);
    const tags = raw?.["tags"] === undefined ? undefined : normalizeTags(raw["tags"]);
    if (requireUrl && !url)
        return { ok: false, error: "Enter a valid http or https URL." };
    if (url === null)
        return { ok: false, error: "Enter a valid http or https URL." };
    if (title === null)
        return { ok: false, error: "Title must be 140 characters or fewer." };
    if (note === null)
        return { ok: false, error: "Note must be 600 characters or fewer." };
    if (tags === null)
        return { ok: false, error: "Use up to 10 tags, each 24 characters or fewer." };
    return {
        ok: true,
        url: url ?? undefined,
        title: title ?? undefined,
        note: note ?? undefined,
        tags: tags ?? undefined,
    };
}
function normalizeTags(value) {
    if (!Array.isArray(value) || value.length > 10)
        return null;
    const tags = [];
    const seen = new Set();
    for (const entry of value) {
        if (typeof entry !== "string")
            return null;
        const tag = entry.trim().replace(/\s+/g, " ");
        if (!tag || tag.length > 24)
            return null;
        const key = tag.toLocaleLowerCase();
        if (!seen.has(key)) {
            tags.push(tag);
            seen.add(key);
        }
    }
    return tags;
}
async function authenticateRequest(req, db, codeSecret) {
    const raw = {
        name: req.headers["x-partner-name"],
        code: req.headers["x-couple-code"],
    };
    const auth = validateAuthBody(raw);
    if (!auth.ok) {
        return { ok: false, status: 401, error: "Enter your name and shared code again." };
    }
    const codeHash = hashCode(auth.code, codeSecret);
    const couple = await db.get("SELECT id FROM couples WHERE code_hash = $1", [codeHash]);
    if (!couple) {
        return { ok: false, status: 401, error: "That shared code does not have a space yet." };
    }
    const person = await db.get("SELECT id, name FROM members WHERE couple_id = $1 AND name = $2 AND active", [couple.id, auth.name]);
    if (!person) {
        return { ok: false, status: 401, error: "Choose an existing name or create a new one first." };
    }
    return { ok: true, name: person.name, couple };
}
async function authenticateOwnerRequest(req, db, codeSecret) {
    const auth = await authenticateRequest(req, db, codeSecret);
    if (!auth.ok)
        return auth;
    const ownerName = await getOwnerName(db, auth.couple.id);
    if (ownerName !== auth.name) {
        return { ok: false, status: 403, error: "Only the shelf owner can manage people." };
    }
    return auth;
}
async function authenticateCodeRequest(req, db, codeSecret) {
    const code = normalizeCode(req.headers["x-couple-code"]);
    if (code.length < 4 || code.length > 80) {
        return { ok: false, status: 401, error: "Enter the shared code again." };
    }
    const couple = await db.get("SELECT id FROM couples WHERE code_hash = $1", [hashCode(code, codeSecret)]);
    if (!couple) {
        return { ok: false, status: 401, error: "That shared code does not have a space yet." };
    }
    return { ok: true, couple };
}
async function listPeople(db, coupleId) {
    return db.all(`
    SELECT m.name, COUNT(l.id)::int AS "linkCount"
    FROM members m
    LEFT JOIN links l ON l.couple_id = m.couple_id AND l.saver_name = m.name
    WHERE m.couple_id = $1 AND m.active
    GROUP BY m.id, m.name
    ORDER BY m.name
  `, [coupleId]);
}
async function getOwnerName(db, coupleId) {
    const result = await db.get('SELECT owner_name AS "ownerName" FROM couples WHERE id = $1', [coupleId]);
    return result?.ownerName ?? null;
}
async function getOrCreateCouple(db, codeHash) {
    await db.query("INSERT INTO couples (code_hash) VALUES ($1) ON CONFLICT (code_hash) DO NOTHING", [codeHash]);
    return db.get("SELECT id FROM couples WHERE code_hash = $1", [codeHash]);
}
async function getLink(db, coupleId, linkId, userName) {
    return db.get(`
    SELECT id, url, title, og_title AS "ogTitle", note, tags,
           EXISTS (
             SELECT 1 FROM link_favorites
             WHERE link_id = links.id AND user_name = $3
           ) AS "isFavorite",
           preview_image AS "previewImage", favicon_url AS "faviconUrl",
           description, site_name AS "siteName", metadata_fetched_at AS "metadataFetchedAt",
           saver_name AS "saverName",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
    FROM links
    WHERE id = $1 AND couple_id = $2
  `, [linkId, coupleId, userName]);
}
async function setFavorite(db, linkId, userName, isFavorite) {
    if (isFavorite) {
        await db.query("INSERT INTO link_favorites (link_id, user_name) VALUES ($1, $2) ON CONFLICT (link_id, user_name) DO NOTHING", [linkId, userName]);
    }
    else {
        await db.query("DELETE FROM link_favorites WHERE link_id = $1 AND user_name = $2", [linkId, userName]);
    }
}
function canonicalizeUrl(value) {
    try {
        const parsed = new URL(value);
        parsed.hash = "";
        parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
        for (const key of [...parsed.searchParams.keys()]) {
            if (/^utm_/i.test(key) || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())) {
                parsed.searchParams.delete(key);
            }
        }
        parsed.searchParams.sort();
        parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
        return parsed.toString().replace(/\/$/, "");
    }
    catch {
        return value.trim().toLowerCase();
    }
}
// ── Helpers ───────────────────────────────────────────────────────────────
function hashCode(code, secret) {
    return createHmac("sha256", secret).update(normalizeCode(code)).digest("hex");
}
function normalizeName(value) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
function normalizeCode(value) {
    return typeof value === "string" ? value.trim() : "";
}
function normalizedNameKey(value) {
    return normalizeName(value).normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");
}
function namesOneSlipApart(a, b) {
    const left = [...a];
    const right = [...b];
    if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1 || a === b)
        return false;
    if (left.length === right.length) {
        const differences = [];
        for (let i = 0; i < left.length; i++)
            if (left[i] !== right[i])
                differences.push(i);
        if (differences.length === 1)
            return true;
        if (differences.length !== 2)
            return false;
        const first = differences[0];
        const second = differences[1];
        return second === first + 1 && left[first] === right[second] && left[second] === right[first];
    }
    const shorter = left.length < right.length ? left : right;
    const longer = left.length < right.length ? right : left;
    let i = 0;
    let j = 0;
    let skipped = false;
    while (i < shorter.length && j < longer.length) {
        if (shorter[i] === longer[j]) {
            i++;
            j++;
        }
        else if (!skipped) {
            skipped = true;
            j++;
        }
        else
            return false;
    }
    return true;
}
function normalizeText(value, maxLength) {
    if (typeof value !== "string")
        return "";
    const text = value.trim();
    return text.length <= maxLength ? text : null;
}
function normalizeUrl(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    try {
        const parsed = new URL(trimmed);
        if (!["http:", "https:"].includes(parsed.protocol))
            return null;
        return parsed.toString();
    }
    catch {
        return null;
    }
}
function emptyPageMetadata() {
    return { title: "", description: "", image: "", siteName: "", favicon: "" };
}
async function fetchPageMetadata(url) {
    const empty = emptyPageMetadata();
    const controller = new AbortController();
    // Production hosts often have slower outbound connections than local dev.
    // Keep comfortably within the Vercel function's configured 15 second limit.
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "accept-language": "en-US,en;q=0.9",
                // A number of sites serve a challenge page or omit OG tags for unknown
                // server-side user agents. Use a conventional browser UA for metadata.
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            },
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("text/html"))
            return empty;
        const html = await response.text();
        const metaValues = new Map();
        for (const tagMatch of html.matchAll(/<meta\b[^>]*>/gi)) {
            const tag = tagMatch[0];
            const key = readHtmlAttribute(tag, "property") || readHtmlAttribute(tag, "name");
            const value = readHtmlAttribute(tag, "content");
            if (key && value)
                metaValues.set(key.toLowerCase(), decodeHtml(value).trim());
        }
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const pageUrl = response.url || url;
        const imageValue = metaValues.get("og:image") || metaValues.get("og:image:secure_url") ||
            metaValues.get("twitter:image") || metaValues.get("twitter:image:src") || "";
        const title = metaValues.get("og:title") || metaValues.get("twitter:title") ||
            (titleMatch ? decodeHtml(titleMatch[1]).trim() : "");
        const description = metaValues.get("og:description") || metaValues.get("twitter:description") ||
            metaValues.get("description") || "";
        const iconTag = [...html.matchAll(/<link\b[^>]*>/gi)].find((match) => {
            const rel = readHtmlAttribute(match[0], "rel").toLowerCase().split(/\s+/);
            return rel.some((value) => value === "icon" || value === "shortcut");
        })?.[0];
        const faviconValue = iconTag ? readHtmlAttribute(iconTag, "href") : "";
        const siteName = metaValues.get("og:site_name") || (() => {
            try {
                return new URL(pageUrl).hostname.replace(/^www\./, "");
            }
            catch {
                return "";
            }
        })();
        return {
            title: decodeHtml(title).replace(/\s+/g, " ").slice(0, 140),
            description: decodeHtml(description).replace(/\s+/g, " ").slice(0, 400),
            image: resolveMetadataUrl(pageUrl, imageValue),
            siteName: decodeHtml(siteName).replace(/\s+/g, " ").slice(0, 100),
            favicon: resolveMetadataUrl(pageUrl, faviconValue || "/favicon.ico"),
        };
    }
    catch {
        return empty;
    }
    finally {
        clearTimeout(timer);
    }
}
function resolveMetadataUrl(base, value) {
    try {
        const resolved = new URL(value, base);
        return ["http:", "https:"].includes(resolved.protocol) ? resolved.toString() : "";
    }
    catch {
        return "";
    }
}
function readHtmlAttribute(tag, name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}
function decodeHtml(value) {
    return value
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'");
}
async function readJsonBody(req) {
    // Vercel may expose an already parsed body on its IncomingMessage adapter.
    // Prefer it when present; otherwise read the raw stream for the local server.
    const parsedBody = req.body;
    if (parsedBody !== undefined) {
        if (typeof parsedBody === "string") {
            try {
                return JSON.parse(parsedBody);
            }
            catch {
                return {};
            }
        }
        return parsedBody;
    }
    let body = "";
    for await (const chunk of req) {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
            const error = Object.assign(new Error("Request body is too large."), { status: 413 });
            throw error;
        }
    }
    if (!body)
        return {};
    try {
        return JSON.parse(body);
    }
    catch {
        return {};
    }
}
async function serveStatic(req, res, url, publicDir) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, { error: "Method not allowed." });
        return;
    }
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = normalize(join(publicDir, decodeURIComponent(requested)));
    if (!filePath.startsWith(publicDir)) {
        sendJson(res, 403, { error: "Forbidden." });
        return;
    }
    try {
        const content = await readFile(filePath);
        res.writeHead(200, {
            "content-type": MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream",
            "cache-control": "no-store",
        });
        if (req.method !== "HEAD")
            res.end(content);
        else
            res.end();
    }
    catch {
        const fallback = await readFile(join(publicDir, "index.html"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(fallback);
    }
}
function sendJson(res, status, payload) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}
// ── Vercel default export ─────────────────────────────────────────────────
let vercelApp;
export default async function handler(req, res) {
    if (!vercelApp)
        vercelApp = createApp();
    return vercelApp(req, res);
}
//# sourceMappingURL=app.js.map