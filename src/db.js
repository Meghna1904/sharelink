import { Pool } from "@neondatabase/serverless";

export function openDatabase(connectionString = process.env.DATABASE_URL) {
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
