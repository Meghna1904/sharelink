import { Pool } from "@neondatabase/serverless";
// ── Implementation ────────────────────────────────────────────────────────
export function openDatabase(connectionString) {
    if (connectionString === ":memory:") {
        return createMemoryDb();
    }
    const url = connectionString ?? process.env["DATABASE_URL"];
    if (!url) {
        throw new Error("DATABASE_URL is not set. Set it to your Neon Postgres connection string.");
    }
    const pool = new Pool({ connectionString: url });
    let initialized = false;
    async function ensureSchema() {
        if (initialized)
            return;
        await pool.query(`
      CREATE TABLE IF NOT EXISTS couples (
        id        SERIAL PRIMARY KEY,
        code_hash TEXT   NOT NULL UNIQUE,
        owner_name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE couples ADD COLUMN IF NOT EXISTS owner_name TEXT;

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

      CREATE TABLE IF NOT EXISTS members (
        id SERIAL PRIMARY KEY,
        couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE members ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE members DROP CONSTRAINT IF EXISTS members_couple_id_name_key;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_members_active_name
        ON members (couple_id, name) WHERE active;

      INSERT INTO members (couple_id, name)
      SELECT DISTINCT couple_id, BTRIM(saver_name)
      FROM links
      WHERE BTRIM(saver_name) <> '' AND saver_name <> 'Former member'
      ON CONFLICT DO NOTHING;

      UPDATE couples c SET owner_name = (
        SELECT m.name FROM members m
        WHERE m.couple_id = c.id AND m.active
        ORDER BY m.created_at, m.id LIMIT 1
      ) WHERE c.owner_name IS NULL AND EXISTS (
        SELECT 1 FROM members m WHERE m.couple_id = c.id AND m.active
      );

      CREATE TABLE IF NOT EXISTS member_removals (
        token TEXT PRIMARY KEY,
        couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        member_name TEXT NOT NULL,
        link_ids INTEGER[] NOT NULL DEFAULT '{}',
        favorite_link_ids INTEGER[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE member_removals ADD COLUMN IF NOT EXISTS member_id INTEGER REFERENCES members(id) ON DELETE CASCADE;

      CREATE TABLE IF NOT EXISTS link_favorites (
        link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
        user_name TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (link_id, user_name)
      );

      CREATE INDEX IF NOT EXISTS idx_links_couple_created
        ON links (couple_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_links_couple_saver
        ON links (couple_id, saver_name);

    `);
        initialized = true;
    }
    return {
        async query(text, params) {
            await ensureSchema();
            await pool.query(text, params);
        },
        async all(text, params) {
            await ensureSchema();
            const result = await pool.query(text, params);
            return result.rows;
        },
        async get(text, params) {
            await ensureSchema();
            const result = await pool.query(text, params);
            return result.rows[0];
        },
        async close() {
            await pool.end();
        },
    };
}
export function closeDatabase(db) {
    return db.close();
}
function createMemoryDb() {
    const couples = [];
    const members = [];
    const memberRemovals = [];
    const links = [];
    let coupleIdSeq = 1;
    let memberIdSeq = 1;
    let linkIdSeq = 1;
    return {
        async query(text, params = []) {
            if (text.includes("WITH requested AS") && text.includes("UPDATE links")) {
                const [coupleId, sourceNames, keepName] = params;
                const sources = new Set(sourceNames.map(String));
                for (const link of links) {
                    if (link.couple_id === Number(coupleId) && sources.has(link.saver_name))
                        link.saver_name = String(keepName);
                }
                for (let i = members.length - 1; i >= 0; i--) {
                    const member = members[i];
                    if (member.couple_id === Number(coupleId) && sources.has(member.name))
                        members.splice(i, 1);
                }
            }
            else if (text.includes("INSERT INTO members")) {
                const [coupleId, name] = params;
                addMember(coupleId, name);
            }
            else if (text.includes("UPDATE members") && text.includes("SET active = FALSE")) {
                const [coupleId, name] = params;
                const member = members.find((row) => row.couple_id === Number(coupleId) && row.name === name);
                if (member)
                    member.active = false;
            }
            else if (text.includes("INSERT INTO couples")) {
                const codeHash = params[0];
                if (!couples.some((c) => c.code_hash === codeHash)) {
                    couples.push({ id: coupleIdSeq++, code_hash: codeHash, created_at: new Date().toISOString() });
                }
            }
            else if (text.includes("INSERT INTO link_favorites")) {
                const [id, userName] = params;
                const link = links.find((l) => l.id === Number(id));
                link?.favorite_user_names.add(String(userName));
            }
            else if (text.includes("DELETE FROM link_favorites")) {
                const [id, userName] = params;
                const link = links.find((l) => l.id === Number(id));
                link?.favorite_user_names.delete(String(userName));
            }
            else if (text.includes("UPDATE links") && text.includes("SET og_title")) {
                const [ogTitle, previewImage, description, siteName, faviconUrl, id, coupleId] = params;
                const link = links.find((l) => l.id === Number(id) && l.couple_id === Number(coupleId));
                if (link) {
                    if (ogTitle)
                        link.og_title = String(ogTitle);
                    if (previewImage)
                        link.preview_image = String(previewImage);
                    if (description)
                        link.description = String(description);
                    if (siteName)
                        link.site_name = String(siteName);
                    if (faviconUrl)
                        link.favicon_url = String(faviconUrl);
                    link.metadata_fetched_at = new Date().toISOString();
                }
            }
            else if (text.includes("UPDATE links")) {
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
            }
            else if (text.includes("DELETE FROM links")) {
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
                    .filter((member) => member.active)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((member) => ({
                    name: member.name,
                    linkCount: links.filter((link) => link.couple_id === coupleId && link.saver_name === member.name).length,
                }));
            }
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
                return matching;
            }
            return [];
        },
        async get(text, params = []) {
            if (text.includes("WITH requested AS") && text.includes("UPDATE links")) {
                const [coupleId, sourceNames, keepName] = params;
                const sources = new Set(sourceNames.map(String));
                const exists = (name) => members.some((member) => member.couple_id === Number(coupleId) && member.active && member.name === name);
                const valid = exists(keepName) && sources.size > 0 && !sources.has(keepName) && [...sources].every(exists);
                if (!valid)
                    return { valid: false, merged: 0 };
                await this.query(text, params);
                return { valid: true, merged: sources.size };
            }
            if (text.includes("INSERT INTO members") && text.includes("RETURNING id")) {
                const [coupleId, name] = params;
                const member = addMember(coupleId, name);
                return member ? { id: member.id, name: member.name } : undefined;
            }
            if (text.includes("FROM members") && text.includes("WHERE couple_id = $1 AND name = $2")) {
                const [coupleId, name] = params;
                const member = members.find((row) => row.couple_id === Number(coupleId) && row.active && row.name === String(name));
                return member ? { id: member.id, name: member.name } : undefined;
            }
            if (text.includes("FROM couples") && text.includes("owner_name")) {
                const [coupleId] = params;
                const couple = couples.find((row) => row.id === Number(coupleId));
                return couple ? { ownerName: couple.owner_name ?? null } : undefined;
            }
            if (text.includes("SELECT id FROM couples WHERE code_hash = $1")) {
                const codeHash = String(params[0]);
                const c = couples.find((row) => row.code_hash === codeHash);
                return c ? { id: c.id } : undefined;
            }
            if (text.includes("INSERT INTO links") && text.includes("RETURNING id")) {
                const [coupleId, url, title, ogTitle, note, saverName, tags, previewImage, description, siteName, faviconUrl, metadataFetchedAt] = params;
                const newLink = {
                    id: linkIdSeq++,
                    couple_id: Number(coupleId),
                    url: String(url),
                    title: String(title),
                    og_title: String(ogTitle ?? ""),
                    note: String(note ?? ""),
                    saver_name: String(saverName),
                    tags: Array.isArray(tags) ? tags.map(String) : [],
                    favorite_user_names: new Set(),
                    preview_image: previewImage ? String(previewImage) : null,
                    description: String(description ?? ""),
                    site_name: String(siteName ?? ""),
                    favicon_url: faviconUrl ? String(faviconUrl) : null,
                    metadata_fetched_at: metadataFetchedAt ? new Date(String(metadataFetchedAt)).toISOString() : null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                };
                links.push(newLink);
                return { id: newLink.id };
            }
            if (text.includes("FROM links") && text.includes("WHERE id = $1 AND couple_id = $2")) {
                const [linkId, coupleId] = params;
                const l = links.find((row) => row.id === Number(linkId) && row.couple_id === Number(coupleId));
                if (!l)
                    return undefined;
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
                };
            }
            return undefined;
        },
        async close() { },
    };
    function addMember(coupleId, value) {
        const name = String(value).trim().replace(/\s+/g, " ");
        if (!name)
            return undefined;
        const existing = members.find((member) => member.couple_id === Number(coupleId) && member.active && member.name === name);
        if (existing)
            return existing;
        const member = { id: memberIdSeq++, couple_id: Number(coupleId), name, active: true, created_at: new Date().toISOString() };
        members.push(member);
        return member;
    }
}
//# sourceMappingURL=db.js.map