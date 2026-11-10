import { createHash, createHmac } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { openDatabase } from "./db.js";

const PUBLIC_DIR = resolve("public");
const MAX_BODY_BYTES = 1_000_000;
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

export function createApp(options = {}) {
  // Use Neon's openDatabase which will expect process.env.DATABASE_URL or the string passed here
  const db = options.db ?? openDatabase(options.dbPath);
  const publicDir = options.publicDir ? resolve(options.publicDir) : PUBLIC_DIR;
  const titleFetcher = options.titleFetcher ?? fetchPageTitle;
  const codeSecret = options.codeSecret ?? process.env.CODE_HASH_SECRET ?? "local-development-secret";

  const app = async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

      if (url.pathname.startsWith("/api/")) {
        await routeApi(req, res, url, { db, titleFetcher, codeSecret });
        return;
      }

      await serveStatic(req, res, url, publicDir);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Something went wrong. Please try again." });
    }
  };

  app.db = db;
  return app;
}

export function createServer(options = {}) {
  return createHttpServer(createApp(options));
}

async function routeApi(req, res, url, context) {
  if (req.method === "POST" && url.pathname === "/api/session") {
    const body = await readJsonBody(req);
    const code = normalizeCode(body?.code);
    if (code.length < 4 || code.length > 80) {
      sendJson(res, 400, { error: "Shared code must be between 4 and 80 characters." });
      return;
    }

    const couple = await getOrCreateCouple(context.db, hashCode(code, context.codeSecret));
    sendJson(res, 200, { people: await listPeople(context.db, couple.id) });
    return;
  }

  if (url.pathname === "/api/people" && req.method === "GET") {
    const auth = await authenticateCodeRequest(req, context.db, context.codeSecret);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error });
      return;
    }
    sendJson(res, 200, { people: await listPeople(context.db, auth.couple.id) });
    return;
  }

  if (url.pathname === "/api/people" && req.method === "POST") {
    const auth = await authenticateCodeRequest(req, context.db, context.codeSecret);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error });
      return;
    }
    const body = await readJsonBody(req);
    const name = normalizeName(body?.name);
    if (!name || name.length > 60) {
      sendJson(res, 400, { error: "Enter a name up to 60 characters long." });
      return;
    }

    const people = await listPeople(context.db, auth.couple.id);
    const nameKey = normalizedNameKey(name);
    const exact = people.find((person) => normalizedNameKey(person.name) === nameKey);
    if (exact) {
      sendJson(res, 200, { person: exact, existing: true });
      return;
    }

    const similar = people.filter((person) => namesOneSlipApart(nameKey, normalizedNameKey(person.name)));
    if (similar.length && body?.confirmSimilar !== true) {
      sendJson(res, 409, {
        error: "A similar name is already here.",
        similarPeople: similar.map(({ name: personName, linkCount }) => ({ name: personName, linkCount })),
      });
      return;
    }

    const member = await context.db.get(`
        INSERT INTO members (couple_id, name)
        VALUES ($1, $2)
        ON CONFLICT (couple_id, name) DO NOTHING
        RETURNING id, name
      `, [auth.couple.id, name]);
    const person = member ?? await context.db.get(
      "SELECT id, name FROM members WHERE couple_id = $1 AND name = $2",
      [auth.couple.id, name]
    );
    sendJson(res, 201, { person, existing: false });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/people/merge") {
    const auth = await authenticateRequest(req, context.db, context.codeSecret);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.error });
      return;
    }
    const body = await readJsonBody(req);
    const keepName = normalizeName(body?.keepName);
    const sourceNames = [...new Set(Array.isArray(body?.sourceNames) ? body.sourceNames.map(normalizeName).filter(Boolean) : [])];
    if (!keepName || sourceNames.length === 0 || sourceNames.includes(keepName) || sourceNames.some((name) => name.length > 60)) {
      sendJson(res, 400, { error: "Choose a name to keep and at least one different name to merge." });
      return;
    }

    const result = await context.db.get(`
        WITH requested AS (
          SELECT DISTINCT unnest($2::text[]) AS name
        ), selected AS (
          SELECT m.name
          FROM members m
          WHERE m.couple_id = $1
            AND (m.name = $3 OR m.name IN (SELECT name FROM requested))
        ), valid AS (
          SELECT COUNT(*) = (SELECT COUNT(*) FROM requested) + 1 AS ok
          FROM selected
        ), moved AS (
          UPDATE links
          SET saver_name = $3
          WHERE couple_id = $1
            AND saver_name IN (SELECT name FROM requested)
            AND (SELECT ok FROM valid)
          RETURNING id
        ), deleted AS (
          DELETE FROM members
          WHERE couple_id = $1
            AND name IN (SELECT name FROM requested)
            AND (SELECT ok FROM valid)
          RETURNING name
        )
        SELECT (SELECT ok FROM valid) AS valid, (SELECT COUNT(*)::int FROM deleted) AS merged
      `, [auth.couple.id, sourceNames, keepName]);
    if (!result?.valid || result.merged !== sourceNames.length) {
      sendJson(res, 400, { error: "Those names changed. Refresh the people list and try again." });
      return;
    }

    const people = await listPeople(context.db, auth.couple.id);
    sendJson(res, 200, { keepName, merged: result.merged, people });
    return;
  }

  const auth = await authenticateRequest(req, context.db, context.codeSecret);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/links") {
    const rows = await context.db.all(`
        SELECT id, url, title, note, saver_name AS "saverName", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM links
        WHERE couple_id = $1
        ORDER BY created_at DESC, id DESC
      `, [auth.couple.id]);
    sendJson(res, 200, { links: rows });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/links") {
    const body = await readJsonBody(req);
    const parsed = validateLinkBody(body, { requireUrl: true });
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }

    const title = parsed.title || (await context.titleFetcher(parsed.url)) || parsed.url;
    const result = await context.db.get(`
        INSERT INTO links (couple_id, url, title, note, saver_name)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [auth.couple.id, parsed.url, title, parsed.note, auth.name]);

    const link = await getLink(context.db, auth.couple.id, result.id);
    sendJson(res, 201, { link });
    return;
  }

  const match = url.pathname.match(/^\/api\/links\/(\d+)$/);
  if (match && req.method === "GET") {
    const id = Number(match[1]);
    const existing = await getLink(context.db, auth.couple.id, id);
    if (!existing) {
      sendJson(res, 404, { error: "Link not found." });
      return;
    }
    sendJson(res, 200, { link: existing });
    return;
  }

  if (match && req.method === "PATCH") {
    const id = Number(match[1]);
    const existing = await getLink(context.db, auth.couple.id, id);
    if (!existing) {
      sendJson(res, 404, { error: "Link not found." });
      return;
    }
    if (existing.saverName !== auth.name) {
      sendJson(res, 403, { error: "Only the partner who saved this link can edit it." });
      return;
    }

    const body = await readJsonBody(req);
    const parsed = validateLinkBody(body, { requireUrl: false });
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }

    const nextUrl = parsed.url ?? existing.url;
    const nextTitle = parsed.title ?? existing.title;
    const nextNote = parsed.note ?? existing.note;
    await context.db.query(`
        UPDATE links
        SET url = $1, title = $2, note = $3, updated_at = NOW()
        WHERE id = $4 AND couple_id = $5
      `, [nextUrl, nextTitle || nextUrl, nextNote, id, auth.couple.id]);

    sendJson(res, 200, { link: await getLink(context.db, auth.couple.id, id) });
    return;
  }

  if (match && req.method === "DELETE") {
    const id = Number(match[1]);
    const existing = await getLink(context.db, auth.couple.id, id);
    if (!existing) {
      sendJson(res, 404, { error: "Link not found." });
      return;
    }
    if (existing.saverName !== auth.name) {
      sendJson(res, 403, { error: "Only the partner who saved this link can delete it." });
      return;
    }

    await context.db.query("DELETE FROM links WHERE id = $1 AND couple_id = $2", [id, auth.couple.id]);
    sendJson(res, 200, { deleted: true });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

function validateAuthBody(body) {
  const name = normalizeName(body?.name);
  const code = normalizeCode(body?.code);

  if (!name) {
    return { ok: false, error: "Enter your name." };
  }
  if (name.length > 60) {
    return { ok: false, error: "Name must be 60 characters or fewer." };
  }
  if (!code) {
    return { ok: false, error: "Enter the shared code." };
  }
  if (code.length < 4 || code.length > 80) {
    return { ok: false, error: "Shared code must be between 4 and 80 characters." };
  }

  return { ok: true, name, code };
}

function validateLinkBody(body, { requireUrl }) {
  const url = body?.url === undefined ? undefined : normalizeUrl(body.url);
  const title = body?.title === undefined ? undefined : normalizeText(body.title, 140);
  const note = body?.note === undefined ? undefined : normalizeText(body.note, 600);

  if (requireUrl && !url) {
    return { ok: false, error: "Enter a valid http or https URL." };
  }
  if (url === null) {
    return { ok: false, error: "Enter a valid http or https URL." };
  }
  if (title === null) {
    return { ok: false, error: "Title must be 140 characters or fewer." };
  }
  if (note === null) {
    return { ok: false, error: "Note must be 600 characters or fewer." };
  }

  return { ok: true, url, title, note };
}

async function authenticateRequest(req, db, codeSecret) {
  const body = {
    name: req.headers["x-partner-name"],
    code: req.headers["x-couple-code"]
  };
  const auth = validateAuthBody(body);
  if (!auth.ok) {
    return { ok: false, status: 401, error: "Enter your name and shared code again." };
  }

  const codeHash = hashCode(auth.code, codeSecret);
  const couple = await db.get("SELECT id FROM couples WHERE code_hash = $1", [codeHash]);
  if (!couple) {
    return { ok: false, status: 401, error: "That shared code does not have a space yet." };
  }

  const member = await db.get(
    "SELECT id, name FROM members WHERE couple_id = $1 AND name = $2",
    [couple.id, auth.name]
  );
  if (!member) {
    return { ok: false, status: 401, error: "Choose an existing name or create a new one first." };
  }

  return { ok: true, name: member.name, couple };
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
      LEFT JOIN links l
        ON l.couple_id = m.couple_id AND l.saver_name = m.name
      WHERE m.couple_id = $1
      GROUP BY m.id, m.name
      ORDER BY m.name
    `, [coupleId]);
}

async function getOrCreateCouple(db, codeHash) {
  await db.query("INSERT INTO couples (code_hash) VALUES ($1) ON CONFLICT (code_hash) DO NOTHING", [codeHash]);
  return await db.get("SELECT id FROM couples WHERE code_hash = $1", [codeHash]);
}

async function getLink(db, coupleId, linkId) {
  return await db.get(`
      SELECT id, url, title, note, saver_name AS "saverName", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM links
      WHERE id = $1 AND couple_id = $2
    `, [linkId, coupleId]);
}

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
  if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1 || a === b) return false;

  if (left.length === right.length) {
    const differences = [];
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) differences.push(i);
    if (differences.length === 1) return true;
    return differences.length === 2 && differences[1] === differences[0] + 1
      && left[differences[0]] === right[differences[1]]
      && left[differences[1]] === right[differences[0]];
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
    } else if (!skipped) {
      skipped = true;
      j++;
    } else {
      return false;
    }
  }
  return true;
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.trim();
  return text.length <= maxLength ? text : null;
}

function normalizeUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchPageTitle(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "ShareLink/1.0 (+local app)" }
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/html")) {
      return "";
    }
    const html = await response.text();
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? decodeHtml(match[1]).trim().replace(/\s+/g, " ").slice(0, 140) : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
  }

  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
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
      "cache-control": "no-store"
    });
    if (req.method !== "HEAD") {
      res.end(content);
    } else {
      res.end();
    }
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(fallback);
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

// Default export required for Vercel Serverless Functions
let vercelApp;
export default async function (req, res) {
  if (!vercelApp) {
    vercelApp = createApp();
  }
  return vercelApp(req, res);
}
