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
  previewImage: string | null;
  description: string;
  siteName: string;
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
        preview_image TEXT,
        description TEXT NOT NULL DEFAULT '',
        site_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      ALTER TABLE links ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
      ALTER TABLE links ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE links ADD COLUMN IF NOT EXISTS preview_image TEXT;
      ALTER TABLE links ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
      ALTER TABLE links ADD COLUMN IF NOT EXISTS site_name TEXT NOT NULL DEFAULT '';

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
    note: string;
    saver_name: string;
    tags: string[];
    is_favorite: boolean;
    preview_image: string | null;
    description: string;
    site_name: string;
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
      } else if (text.includes("UPDATE links")) {
        if (text.includes("SET is_favorite")) {
          const [isFavorite, id, coupleId] = params;
          const link = links.find((l) => l.id === Number(id) && l.couple_id === Number(coupleId));
          if (link) link.is_favorite = Boolean(isFavorite);
          return;
        }
        const [nextUrl, nextTitle, nextNote, tags, id, coupleId] = params;
        const link = links.find((l) => l.id === Number(id) && l.couple_id === Number(coupleId));
        if (link) {
          link.url = String(nextUrl);
          link.title = String(nextTitle);
          link.note = String(nextNote);
          link.tags = Array.isArray(tags) ? tags.map(String) : [];
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
            note: l.note,
            saverName: l.saver_name,
            createdAt: l.created_at,
            updatedAt: l.updated_at,
            tags: l.tags,
            isFavorite: l.is_favorite,
            previewImage: l.preview_image,
            description: l.description,
            siteName: l.site_name,
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
        const [coupleId, url, title, note, saverName, tags, previewImage, description, siteName] = params;
        const newLink: LinkRow = {
          id: linkIdSeq++,
          couple_id: Number(coupleId),
          url: String(url),
          title: String(title),
          note: String(note ?? ""),
          saver_name: String(saverName),
          tags: Array.isArray(tags) ? tags.map(String) : [],
          is_favorite: false,
          preview_image: previewImage ? String(previewImage) : null,
          description: String(description ?? ""),
          site_name: String(siteName ?? ""),
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
          note: l.note,
          saverName: l.saver_name,
          createdAt: l.created_at,
          updatedAt: l.updated_at,
          tags: l.tags,
          isFavorite: l.is_favorite,
          previewImage: l.preview_image,
          description: l.description,
          siteName: l.site_name,
        } as unknown as T;
      }
      return undefined;
    },
    async close(): Promise<void> {},
  };
}
