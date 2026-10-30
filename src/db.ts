import { Pool } from "@neondatabase/serverless";

// ── Public types ──────────────────────────────────────────────────────────

export interface Link {
  id: number;
  url: string;
  title: string;
  note: string;
  saverName: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  isFavorite: boolean;
  ogTitle: string;
  previewImage: string | null;
  description: string;
  siteName: string;
  faviconUrl: string | null;
  metadataFetchedAt: string | null;
}

export interface Couple {
  id: number;
}

export interface DbClient {
  query(text: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | undefined>;
  close(): Promise<void>;
}

// ── Implementation ────────────────────────────────────────────────────────

export function openDatabase(connectionString?: string): DbClient {
  if (connectionString === ":memory:") {
    return createMemoryDb();
  }

  const url = connectionString ?? process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Set it to your Neon Postgres connection string."
    );
  }

  const pool = new Pool({ connectionString: url });
  let initialized = false;

  async function ensureSchema(): Promise<void> {
    if (initialized) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS couples (
        id        SERIAL PRIMARY KEY,
        code_hash TEXT   NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS links (
        id         SERIAL  PRIMARY KEY,
        couple_id  INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
        url        TEXT    NOT NULL,
        title      TEXT    NOT NULL,
        note       TEXT    NOT NULL DEFAULT '',
        saver_name TEXT    NOT NULL,
        tags       TEXT[]  NOT NULL DEFAULT '{}',
        is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
        og_title TEXT NOT NULL DEFAULT '',
        preview_image TEXT,
        description TEXT NOT NULL DEFAULT '',
        site_name TEXT NOT NULL DEFAULT '',
        favicon_url TEXT,
        metadata_fetched_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      ALTER TABLE links ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
      ALTER TABLE links ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE links ADD COLUMN IF NOT EXISTS og_title TEXT NOT NULL DEFAULT '';
      ALTER TABLE links ADD COLUMN IF NOT EXISTS preview_image TEXT;
      ALTER TABLE links ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
      ALTER TABLE links ADD COLUMN IF NOT EXISTS site_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE links ADD COLUMN IF NOT EXISTS favicon_url TEXT;
      ALTER TABLE links ADD COLUMN IF NOT EXISTS metadata_fetched_at TIMESTAMP;

      CREATE TABLE IF NOT EXISTS link_favorites (
        link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
        user_name TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (link_id, user_name)
      );

      CREATE INDEX IF NOT EXISTS idx_links_couple_created
        ON links (couple_id, created_at DESC, id DESC);

    `);
    initialized = true;
  }

  return {
    async query(text, params): Promise<void> {
      await ensureSchema();
      await pool.query(text, params as unknown[]);
    },
    async all<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
      await ensureSchema();
      const result = await pool.query(text, params);
      return result.rows as T[];
    },
    async get<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | undefined> {
      await ensureSchema();
      const result = await pool.query(text, params);
      return result.rows[0] as T | undefined;
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export function closeDatabase(db: DbClient): Promise<void> {
  return db.close();
}

function createMemoryDb(): DbClient {
  interface CoupleRow { id: number; code_hash: string; created_at: string; }
  interface LinkRow {
    id: number;
    couple_id: number;
    url: string;
    title: string;
    og_title: string;
    note: string;
    saver_name: string;
    tags: string[];
    favorite_user_names: Set<string>;
    preview_image: string | null;
    description: string;
    site_name: string;
    favicon_url: string | null;
    metadata_fetched_at: string | null;
    created_at: string;
    updated_at: string;
  }

  const couples: CoupleRow[] = [];
  const links: LinkRow[] = [];
  let coupleIdSeq = 1;
  let linkIdSeq = 1;

  return {
    async query(text: string, params: unknown[] = []): Promise<void> {
      if (text.includes("INSERT INTO couples")) {
        const codeHash = params[0] as string;
        if (!couples.some((c) => c.code_hash === codeHash)) {
          couples.push({ id: coupleIdSeq++, code_hash: codeHash, created_at: new Date().toISOString() });
        }
      } else if (text.includes("INSERT INTO link_favorites")) {
        const [id, userName] = params;
        const link = links.find((l) => l.id === Number(id));
        link?.favorite_user_names.add(String(userName));
      } else if (text.includes("DELETE FROM link_favorites")) {
        const [id, userName] = params;
        const link = links.find((l) => l.id === Number(id));
        link?.favorite_user_names.delete(String(userName));
      } else if (text.includes("UPDATE links") && text.includes("SET og_title")) {
        const [ogTitle, previewImage, description, siteName, faviconUrl, id, coupleId] = params;
        const link = links.find((l) => l.id === Number(id) && l.couple_id === Number(coupleId));
        if (link) {
          if (ogTitle) link.og_title = String(ogTitle);
          if (previewImage) link.preview_image = String(previewImage);
          if (description) link.description = String(description);
          if (siteName) link.site_name = String(siteName);
          if (faviconUrl) link.favicon_url = String(faviconUrl);
          link.metadata_fetched_at = new Date().toISOString();
        }
      } else if (text.includes("UPDATE links")) {
        const [nextUrl, nextTitle, nextNote, tags, id, coupleId] = params;
        const link = links.find((l) => l.id === Number(id) && l.couple_id === Number(coupleId));
        if (link) {
          const urlChanged = link.url !== String(nextUrl);
          link.url = String(nextUrl);
          link.title = String(nextTitle);
          link.note = String(nextNote);
          link.tags = Array.isArray(tags) ? tags.map(String) : [];
          if (urlChanged) {
            link.og_title = "";
            link.preview_image = null;
            link.description = "";
            link.site_name = "";
            link.favicon_url = null;
            link.metadata_fetched_at = null;
          }
          link.updated_at = new Date().toISOString();
        }
      } else if (text.includes("DELETE FROM links")) {
        const [id, coupleId] = params;
        const idx = links.findIndex((l) => l.id === Number(id) && l.couple_id === Number(coupleId));
        if (idx !== -1) {
          links.splice(idx, 1);
        }
      }
    },
    async all<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      if (text.includes("FROM links") && text.includes("WHERE couple_id = $1")) {
        const coupleId = Number(params[0]);
        const matching = links
          .filter((l) => l.couple_id === coupleId)
          .sort((a, b) => b.id - a.id)
          .map((l) => ({
            id: l.id,
            url: l.url,
            title: l.title,
            ogTitle: l.og_title,
            note: l.note,
            saverName: l.saver_name,
            createdAt: l.created_at,
            updatedAt: l.updated_at,
            tags: l.tags,
            isFavorite: l.favorite_user_names.has(String(params[1] ?? "")),
            previewImage: l.preview_image,
            description: l.description,
            siteName: l.site_name,
            faviconUrl: l.favicon_url,
            metadataFetchedAt: l.metadata_fetched_at,
          }));
        return matching as unknown as T[];
      }
      return [];
    },
    async get<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | undefined> {
      if (text.includes("SELECT id FROM couples WHERE code_hash = $1")) {
        const codeHash = String(params[0]);
        const c = couples.find((row) => row.code_hash === codeHash);
        return c ? ({ id: c.id } as unknown as T) : undefined;
      }
      if (text.includes("INSERT INTO links") && text.includes("RETURNING id")) {
        const [coupleId, url, title, ogTitle, note, saverName, tags, previewImage, description, siteName, faviconUrl, metadataFetchedAt] = params;
        const newLink: LinkRow = {
          id: linkIdSeq++,
          couple_id: Number(coupleId),
          url: String(url),
          title: String(title),
          og_title: String(ogTitle ?? ""),
          note: String(note ?? ""),
          saver_name: String(saverName),
          tags: Array.isArray(tags) ? tags.map(String) : [],
          favorite_user_names: new Set<string>(),
          preview_image: previewImage ? String(previewImage) : null,
          description: String(description ?? ""),
          site_name: String(siteName ?? ""),
          favicon_url: faviconUrl ? String(faviconUrl) : null,
          metadata_fetched_at: metadataFetchedAt ? new Date(String(metadataFetchedAt)).toISOString() : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        links.push(newLink);
        return { id: newLink.id } as unknown as T;
      }
      if (text.includes("FROM links") && text.includes("WHERE id = $1 AND couple_id = $2")) {
        const [linkId, coupleId] = params;
        const l = links.find((row) => row.id === Number(linkId) && row.couple_id === Number(coupleId));
        if (!l) return undefined;
        return {
          id: l.id,
          url: l.url,
          title: l.title,
          ogTitle: l.og_title,
          note: l.note,
          saverName: l.saver_name,
          createdAt: l.created_at,
          updatedAt: l.updated_at,
          tags: l.tags,
          isFavorite: l.favorite_user_names.has(String(params[2] ?? "")),
          previewImage: l.preview_image,
          description: l.description,
          siteName: l.site_name,
          faviconUrl: l.favicon_url,
          metadataFetchedAt: l.metadata_fetched_at,
        } as unknown as T;
      }
      return undefined;
    },
    async close(): Promise<void> {},
  };
}
