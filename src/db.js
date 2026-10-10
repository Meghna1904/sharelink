import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(dbPath = "data/sharelink.sqlite") {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS couples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      saver_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_links_couple_created
      ON links (couple_id, created_at DESC, id DESC);
  `);

  return db;
}

export function closeDatabase(db) {
  db.close();
}
