import { createHmac } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { openDatabase, type DbClient, type Couple, type Link } from "./db.js";

// ── Constants ─────────────────────────────────────────────────────────────

const PUBLIC_DIR = resolve("public");
const MAX_BODY_BYTES = 1_000_000;
const MIME_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

// ── Public types ──────────────────────────────────────────────────────────

export interface PageMetadata {
  title: string;
  description: string;
  image: string;
  siteName: string;
}

export type MetadataFetcher = (url: string) => Promise<PageMetadata>;

export interface AppOptions {
  db?: DbClient;
  /** Pass a connection string directly (used in tests). */
  dbPath?: string;
  publicDir?: string;
  metadataFetcher?: MetadataFetcher;
  codeSecret?: string;
}

export type AppHandler = {
  (req: IncomingMessage, res: ServerResponse): Promise<void>;
  db: DbClient;
};

// ── App factory ───────────────────────────────────────────────────────────

export function createApp(options: AppOptions = {}): AppHandler {
  const db = options.db ?? openDatabase(options.dbPath);
  const publicDir = options.publicDir ? resolve(options.publicDir) : PUBLIC_DIR;
  const metadataFetcher = options.metadataFetcher ?? fetchPageMetadata;
  const codeSecret =
    options.codeSecret ?? process.env["CODE_HASH_SECRET"] ?? "local-development-secret";

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers["host"] ?? "localhost"}`);

      if (url.pathname.startsWith("/api/")) {
        await routeApi(req, res, url, { db, metadataFetcher, codeSecret });
        return;
      }

      await serveStatic(req, res, url, publicDir);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Something went wrong. Please try again." });
    }
  };

  (handler as AppHandler).db = db;
  return handler as AppHandler;
}

export function createServer(options: AppOptions = {}) {
  return createHttpServer(createApp(options));
}

// ── API router ────────────────────────────────────────────────────────────

interface RouteContext {
  db: DbClient;
  metadataFetcher: MetadataFetcher;
  codeSecret: string;
}

async function routeApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: RouteContext
): Promise<void> {
  // POST /api/session — enter or create the shared space
  if (req.method === "POST" && url.pathname === "/api/session") {
    const body = await readJsonBody(req);
    const auth = validateAuthBody(body);
    if (!auth.ok) {
      sendJson(res, 400, { error: auth.error });
      return;
    }
    await getOrCreateCouple(ctx.db, hashCode(auth.code, ctx.codeSecret));
    sendJson(res, 200, { partnerName: auth.name });
    return;
  }

  // All other routes require authentication
  const auth = await authenticateRequest(req, ctx.db, ctx.codeSecret);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }

  // GET /api/links
  if (req.method === "GET" && url.pathname === "/api/links") {
    const rows = await ctx.db.all<Link>(`
      SELECT id, url, title, note, tags,
             is_favorite AS "isFavorite",
             preview_image AS "previewImage",
             description, site_name AS "siteName",
             saver_name  AS "saverName",
             created_at  AS "createdAt",
             updated_at  AS "updatedAt"
      FROM links
      WHERE couple_id = $1
      ORDER BY created_at DESC, id DESC
    `, [auth.couple.id]);
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
    const metadata = await ctx.metadataFetcher(parsed.url!);
    const title = parsed.title || metadata.title || parsed.url!;
    const row = await ctx.db.get<{ id: number }>(`
      INSERT INTO links (
        couple_id, url, title, note, saver_name, tags, preview_image, description, site_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [
      auth.couple.id,
      parsed.url,
      title,
      parsed.note ?? "",
      auth.name,
      parsed.tags ?? [],
      normalizeUrl(metadata.image) ?? null,
      normalizeText(metadata.description, 400) ?? "",
      normalizeText(metadata.siteName, 100) ?? "",
    ]);

    const link = await getLink(ctx.db, auth.couple.id, row!.id);
    sendJson(res, 201, { link });
    return;
  }

  // GET /api/links/:id  or  PATCH /api/links/:id  or  DELETE /api/links/:id
  const favoriteMatch = url.pathname.match(/^\/api\/links\/(\d+)\/favorite$/);
  if (favoriteMatch && req.method === "POST") {
    const id = Number(favoriteMatch[1]);
    const existing = await getLink(ctx.db, auth.couple.id, id);
    if (!existing) { sendJson(res, 404, { error: "Link not found." }); return; }
    const body = await readJsonBody(req) as Record<string, unknown> | null;
    if (typeof body?.["isFavorite"] !== "boolean") {
      sendJson(res, 400, { error: "Choose whether this link is a favorite." });
      return;
    }
    await ctx.db.query(
      "UPDATE links SET is_favorite = $1, updated_at = NOW() WHERE id = $2 AND couple_id = $3",
      [body["isFavorite"], id, auth.couple.id]
    );
    sendJson(res, 200, { link: await getLink(ctx.db, auth.couple.id, id) });
    return;
  }

  const match = url.pathname.match(/^\/api\/links\/(\d+)$/);
  if (match) {
    const id = Number(match[1]);

    if (req.method === "GET") {
      const existing = await getLink(ctx.db, auth.couple.id, id);
      if (!existing) { sendJson(res, 404, { error: "Link not found." }); return; }
      sendJson(res, 200, { link: existing });
      return;
    }

    if (req.method === "PATCH") {
      const existing = await getLink(ctx.db, auth.couple.id, id);
      if (!existing) { sendJson(res, 404, { error: "Link not found." }); return; }

      const body = await readJsonBody(req) as Record<string, unknown> | null;
      if (typeof body?.["isFavorite"] === "boolean") {
        await ctx.db.query(
          "UPDATE links SET is_favorite = $1, updated_at = NOW() WHERE id = $2 AND couple_id = $3",
          [body["isFavorite"], id, auth.couple.id]
        );
        sendJson(res, 200, { link: await getLink(ctx.db, auth.couple.id, id) });
        return;
      }

      if (existing.saverName !== auth.name) {
        sendJson(res, 403, { error: "Only the partner who saved this link can edit it." });
        return;
      }

      const parsed = validateLinkBody(body, { requireUrl: false });
      if (!parsed.ok) { sendJson(res, 400, { error: parsed.error }); return; }

      const nextUrl   = parsed.url   ?? existing.url;
      const nextTitle = parsed.title ?? existing.title;
      const nextNote  = parsed.note  ?? existing.note;
      const nextTags  = parsed.tags  ?? existing.tags ?? [];
      await ctx.db.query(`
        UPDATE links
        SET url = $1, title = $2, note = $3, tags = $4, updated_at = NOW()
        WHERE id = $5 AND couple_id = $6
      `, [nextUrl, nextTitle || nextUrl, nextNote, nextTags, id, auth.couple.id]);

      sendJson(res, 200, { link: await getLink(ctx.db, auth.couple.id, id) });
      return;
    }

    if (req.method === "DELETE") {
      const existing = await getLink(ctx.db, auth.couple.id, id);
      if (!existing) { sendJson(res, 404, { error: "Link not found." }); return; }
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

// ── Validation ────────────────────────────────────────────────────────────

type AuthOk  = { ok: true;  name: string; code: string };
type AuthErr = { ok: false; error: string };
type AuthResult = AuthOk | AuthErr;

function validateAuthBody(body: unknown): AuthResult {
  const raw = body as Record<string, unknown> | null | undefined;
  const name = normalizeName(raw?.["name"]);
  const code = normalizeCode(raw?.["code"]);

  if (!name)                            return { ok: false, error: "Enter your name." };
  if (name.length > 60)                 return { ok: false, error: "Name must be 60 characters or fewer." };
  if (!code)                            return { ok: false, error: "Enter the shared code." };
  if (code.length < 4 || code.length > 80)
    return { ok: false, error: "Shared code must be between 4 and 80 characters." };

  return { ok: true, name, code };
}

type LinkBodyOk = {
  ok: true;
  url?: string | undefined;
  title?: string | undefined;
  note?: string | undefined;
  tags?: string[] | undefined;
};
type LinkBodyErr = { ok: false; error: string };
type LinkBodyResult = LinkBodyOk | LinkBodyErr;

function validateLinkBody(
  body: unknown,
  { requireUrl }: { requireUrl: boolean }
): LinkBodyResult {
  const raw = body as Record<string, unknown> | null | undefined;
  const url   = raw?.["url"]   === undefined ? undefined : normalizeUrl(raw["url"]);
  const title = raw?.["title"] === undefined ? undefined : normalizeText(raw["title"], 140);
  const note  = raw?.["note"]  === undefined ? undefined : normalizeText(raw["note"], 600);
  const tags  = raw?.["tags"]  === undefined ? undefined : normalizeTags(raw["tags"]);

  if (requireUrl && !url)  return { ok: false, error: "Enter a valid http or https URL." };
  if (url === null)        return { ok: false, error: "Enter a valid http or https URL." };
  if (title === null)      return { ok: false, error: "Title must be 140 characters or fewer." };
  if (note === null)       return { ok: false, error: "Note must be 600 characters or fewer." };
  if (tags === null)       return { ok: false, error: "Use up to 10 tags, each 24 characters or fewer." };

  return {
    ok: true,
    url: url ?? undefined,
    title: title ?? undefined,
    note: note ?? undefined,
    tags: tags ?? undefined,
  };
}

function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    const tag = entry.trim().replace(/\s+/g, " ");
    if (!tag || tag.length > 24) return null;
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) {
      tags.push(tag);
      seen.add(key);
    }
  }
  return tags;
}

// ── Auth ──────────────────────────────────────────────────────────────────

type RequestAuthOk  = { ok: true;  name: string; couple: Couple };
type RequestAuthErr = { ok: false; status: number; error: string };
type RequestAuthResult = RequestAuthOk | RequestAuthErr;

async function authenticateRequest(
  req: IncomingMessage,
  db: DbClient,
  codeSecret: string
): Promise<RequestAuthResult> {
  const raw = {
    name: req.headers["x-partner-name"],
    code: req.headers["x-couple-code"],
  };
  const auth = validateAuthBody(raw);
  if (!auth.ok) {
    return { ok: false, status: 401, error: "Enter your name and shared code again." };
  }

  const codeHash = hashCode(auth.code, codeSecret);
  const couple = await db.get<Couple>("SELECT id FROM couples WHERE code_hash = $1", [codeHash]);
  if (!couple) {
    return { ok: false, status: 401, error: "That shared code does not have a space yet." };
  }

  return { ok: true, name: auth.name, couple };
}

async function getOrCreateCouple(db: DbClient, codeHash: string): Promise<Couple | undefined> {
  await db.query(
    "INSERT INTO couples (code_hash) VALUES ($1) ON CONFLICT (code_hash) DO NOTHING",
    [codeHash]
  );
  return db.get<Couple>("SELECT id FROM couples WHERE code_hash = $1", [codeHash]);
}

async function getLink(db: DbClient, coupleId: number, linkId: number): Promise<Link | undefined> {
  return db.get<Link>(`
    SELECT id, url, title, note, tags,
           is_favorite AS "isFavorite",
           preview_image AS "previewImage",
           description, site_name AS "siteName",
           saver_name AS "saverName",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
    FROM links
    WHERE id = $1 AND couple_id = $2
  `, [linkId, coupleId]);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function hashCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(normalizeCode(code)).digest("hex");
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text.length <= maxLength ? text : null;
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchPageMetadata(url: string): Promise<PageMetadata> {
  const empty: PageMetadata = { title: "", description: "", image: "", siteName: "" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "ShareLink/1.0 (+local app)" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/html")) return empty;
    const html = await response.text();
    const metaValues = new Map<string, string>();
    for (const tagMatch of html.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = tagMatch[0];
      const key = readHtmlAttribute(tag, "property") || readHtmlAttribute(tag, "name");
      const value = readHtmlAttribute(tag, "content");
      if (key && value) metaValues.set(key.toLowerCase(), decodeHtml(value).trim());
    }
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const imageValue = metaValues.get("og:image") || metaValues.get("twitter:image") || "";
    let image = "";
    try { image = imageValue ? new URL(imageValue, url).toString() : ""; } catch {}
    return {
      title: (metaValues.get("og:title") || metaValues.get("twitter:title") ||
        (titleMatch ? decodeHtml(titleMatch[1]!).trim() : ""))
        .replace(/\s+/g, " ").slice(0, 140),
      description: (metaValues.get("og:description") || metaValues.get("description") ||
        metaValues.get("twitter:description") || "").replace(/\s+/g, " ").slice(0, 400),
      image,
      siteName: (metaValues.get("og:site_name") || "").replace(/\s+/g, " ").slice(0, 100),
    };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

function readHtmlAttribute(tag: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  // Vercel may expose an already parsed body on its IncomingMessage adapter.
  // Prefer it when present; otherwise read the raw stream for the local server.
  const parsedBody = (req as IncomingMessage & { body?: unknown }).body;
  if (parsedBody !== undefined) {
    if (typeof parsedBody === "string") {
      try { return JSON.parse(parsedBody) as unknown; } catch { return {}; }
    }
    return parsedBody;
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk as string;
    if (body.length > MAX_BODY_BYTES) {
      const error = Object.assign(new Error("Request body is too large."), { status: 413 });
      throw error;
    }
  }
  if (!body) return {};
  try { return JSON.parse(body) as unknown; } catch { return {}; }
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  publicDir: string
): Promise<void> {
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
    if (req.method !== "HEAD") res.end(content);
    else res.end();
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(fallback);
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

// ── Vercel default export ─────────────────────────────────────────────────

let vercelApp: AppHandler | undefined;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (!vercelApp) vercelApp = createApp();
  return vercelApp(req, res);
}
