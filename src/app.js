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
    const auth = validateAuthBody(body);
    if (!auth.ok) {
      sendJson(res, 400, { error: auth.error });
      return;
    }

    getOrCreateCouple(context.db, hashCode(auth.code, context.codeSecret));
    sendJson(res, 200, { partnerName: auth.name });
    return;
  }

  const auth = authenticateRequest(req, context.db, context.codeSecret);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/links") {
    const rows = context.db
      .prepare(`
        SELECT id, url, title, note, saver_name AS saverName, created_at AS createdAt, updated_at AS updatedAt
        FROM links
        WHERE couple_id = ?
        ORDER BY created_at DESC, id DESC
      `)
      .all(auth.couple.id);
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
    const result = context.db
      .prepare(`
        INSERT INTO links (couple_id, url, title, note, saver_name)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(auth.couple.id, parsed.url, title, parsed.note, auth.name);

    const link = getLink(context.db, auth.couple.id, Number(result.lastInsertRowid));
    sendJson(res, 201, { link });
    return;
  }

  const match = url.pathname.match(/^\/api\/links\/(\d+)$/);
  if (match && req.method === "PATCH") {
    const id = Number(match[1]);
    const existing = getLink(context.db, auth.couple.id, id);
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
    context.db
      .prepare(`
        UPDATE links
        SET url = ?, title = ?, note = ?, updated_at = datetime('now')
        WHERE id = ? AND couple_id = ?
      `)
      .run(nextUrl, nextTitle || nextUrl, nextNote, id, auth.couple.id);

    sendJson(res, 200, { link: getLink(context.db, auth.couple.id, id) });
    return;
  }

  if (match && req.method === "DELETE") {
    const id = Number(match[1]);
    const existing = getLink(context.db, auth.couple.id, id);
    if (!existing) {
      sendJson(res, 404, { error: "Link not found." });
      return;
    }
    if (existing.saverName !== auth.name) {
      sendJson(res, 403, { error: "Only the partner who saved this link can delete it." });
      return;
    }

    context.db.prepare("DELETE FROM links WHERE id = ? AND couple_id = ?").run(id, auth.couple.id);
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

function authenticateRequest(req, db, codeSecret) {
  const body = {
    name: req.headers["x-partner-name"],
    code: req.headers["x-couple-code"]
  };
  const auth = validateAuthBody(body);
  if (!auth.ok) {
    return { ok: false, status: 401, error: "Enter your name and shared code again." };
  }

  const codeHash = hashCode(auth.code, codeSecret);
  const couple = db.prepare("SELECT id FROM couples WHERE code_hash = ?").get(codeHash);
  if (!couple) {
    return { ok: false, status: 401, error: "That shared code does not have a space yet." };
  }

  return { ok: true, name: auth.name, couple };
}

function getOrCreateCouple(db, codeHash) {
  db.prepare("INSERT OR IGNORE INTO couples (code_hash) VALUES (?)").run(codeHash);
  return db.prepare("SELECT id FROM couples WHERE code_hash = ?").get(codeHash);
}

function getLink(db, coupleId, linkId) {
  return db
    .prepare(`
      SELECT id, url, title, note, saver_name AS saverName, created_at AS createdAt, updated_at AS updatedAt
      FROM links
      WHERE id = ? AND couple_id = ?
    `)
    .get(linkId, coupleId);
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
    // Use /tmp on Vercel to avoid EROFS (Read-Only File System) errors.
    // Note: Data in /tmp is ephemeral and will be lost on cold starts!
    vercelApp = createApp({ dbPath: "/tmp/sharelink.sqlite" });
  }
  return vercelApp(req, res);
}
