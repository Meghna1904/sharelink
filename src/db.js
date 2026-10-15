import { Pool } from "@neondatabase/serverless";

export function openDatabase(connectionString = process.env.DATABASE_URL) {
  if (connectionString === ":memory:") {
    return createMemoryDb();
  }

  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set. Please set it to your Neon Postgres database connection string.");
  }

  const pool = new Pool({ connectionString });
  let initialized = false;

  return {
    async query(text, params) {
      if (!initialized) {
        // Initialize tables on first query
        await pool.query(`
          CREATE TABLE IF NOT EXISTS couples (
            id SERIAL PRIMARY KEY,
            code_hash TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS links (
            id SERIAL PRIMARY KEY,
            couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            title TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            saver_name TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_links_couple_created
            ON links (couple_id, created_at DESC, id DESC);
        `);
        initialized = true;
      }
      return pool.query(text, params);
    },
    async all(text, params) {
      const res = await this.query(text, params);
      return res.rows;
    },
    async get(text, params) {
      const res = await this.query(text, params);
      return res.rows[0];
    },
    close() {
      return pool.end();
    }
  };
}

export function closeDatabase(db) {
  db.close();
}

function createMemoryDb() {
  const couples = [];
  const links = [];
  let coupleIdSeq = 1;
  let linkIdSeq = 1;

  return {
    async query(text, params = []) {
      if (text.includes("INSERT INTO couples")) {
        const codeHash = params[0];
        if (!couples.some((c) => c.code_hash === codeHash)) {
          couples.push({ id: coupleIdSeq++, code_hash: codeHash, created_at: new Date().toISOString() });
        }
      } else if (text.includes("UPDATE links")) {
        const [nextUrl, nextTitle, nextNote, id, coupleId] = params;
        const link = links.find((l) => l.id === Number(id) && l.couple_id === Number(coupleId));
        if (link) {
          link.url = String(nextUrl);
          link.title = String(nextTitle);
          link.note = String(nextNote);
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
    async all(text, params = []) {
      if (text.includes("FROM links") && text.includes("WHERE couple_id = $1")) {
        const coupleId = Number(params[0]);
        return links
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
          }));
      }
      return [];
    },
    async get(text, params = []) {
      if (text.includes("SELECT id FROM couples WHERE code_hash = $1")) {
        const codeHash = String(params[0]);
        const c = couples.find((row) => row.code_hash === codeHash);
        return c ? { id: c.id } : undefined;
      }
      if (text.includes("INSERT INTO links") && text.includes("RETURNING id")) {
        const [coupleId, url, title, note, saverName] = params;
        const newLink = {
          id: linkIdSeq++,
          couple_id: Number(coupleId),
          url: String(url),
          title: String(title),
          note: String(note ?? ""),
          saver_name: String(saverName),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        links.push(newLink);
        return { id: newLink.id };
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
        };
      }
      return undefined;
    },
    async close() {},
  };
}
