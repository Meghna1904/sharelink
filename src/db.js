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

          CREATE TABLE IF NOT EXISTS members (
            id SERIAL PRIMARY KEY,
            couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (couple_id, name)
          );

          INSERT INTO members (couple_id, name)
          SELECT DISTINCT couple_id, BTRIM(saver_name)
          FROM links
          WHERE BTRIM(saver_name) <> ''
          ON CONFLICT (couple_id, name) DO NOTHING;

          CREATE INDEX IF NOT EXISTS idx_links_couple_created
            ON links (couple_id, created_at DESC, id DESC);
          CREATE INDEX IF NOT EXISTS idx_links_couple_saver
            ON links (couple_id, saver_name);
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
  const members = [];
  let coupleIdSeq = 1;
  let linkIdSeq = 1;
  let memberIdSeq = 1;

  return {
    async query(text, params = []) {
      if (text.includes("WITH requested AS") && text.includes("UPDATE links")) {
        const [coupleId, sourceNames, keepName] = params;
        const sources = new Set(sourceNames.map(String));
        for (const link of links) {
          if (link.couple_id === Number(coupleId) && sources.has(link.saver_name) && link.saver_name !== keepName) {
            link.saver_name = String(keepName);
          }
        }
        for (let i = members.length - 1; i >= 0; i--) {
          const member = members[i];
          if (member.couple_id === Number(coupleId) && sources.has(member.name) && member.name !== keepName) members.splice(i, 1);
        }
      } else if (text.includes("INSERT INTO members") && text.includes("SELECT DISTINCT")) {
        for (const link of links) addMember(link.couple_id, link.saver_name);
      } else if (text.includes("INSERT INTO members")) {
        const [coupleId, name] = params;
        addMember(coupleId, name);
      } else if (text.includes("INSERT INTO couples")) {
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
      if (text.includes("FROM members m") && text.includes("LEFT JOIN links")) {
        const coupleId = Number(params[0]);
        return members
          .filter((member) => member.couple_id === coupleId)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((member) => ({
            name: member.name,
            linkCount: links.filter((link) => link.couple_id === coupleId && link.saver_name === member.name).length,
          }));
      }
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
      if (text.includes("WITH requested AS") && text.includes("UPDATE links")) {
        const [coupleId, sourceNames, keepName] = params;
        const sources = new Set(sourceNames.map(String));
        const exists = (name) => members.some((member) => member.couple_id === Number(coupleId) && member.name === name);
        const valid = exists(keepName) && [...sources].every(exists) && sources.size > 0 && !sources.has(keepName);
        if (!valid) return { merged: false };
        await this.query(text, params);
        return { merged: true };
      }
      if (text.includes("INSERT INTO members") && text.includes("RETURNING id")) {
        const [coupleId, name] = params;
        const member = addMember(coupleId, name);
        return member ? { id: member.id, name: member.name } : undefined;
      }
      if (text.includes("FROM members") && text.includes("WHERE couple_id = $1 AND name = $2")) {
        const [coupleId, name] = params;
        const member = members.find((row) => row.couple_id === Number(coupleId) && row.name === String(name));
        return member ? { id: member.id, name: member.name } : undefined;
      }
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

  function addMember(coupleId, name) {
    const normalizedName = String(name).trim().replace(/\s+/g, " ");
    if (!normalizedName) return undefined;
    const existing = members.find((row) => row.couple_id === Number(coupleId) && row.name === normalizedName);
    if (existing) return existing;
    const member = { id: memberIdSeq++, couple_id: Number(coupleId), name: normalizedName, created_at: new Date().toISOString() };
    members.push(member);
    return member;
  }
}
