/**
 * db.mjs — the one place that owns the Daivik Vani pipeline database.
 *
 * data/dv.db is DISPOSABLE working state (gitignored). The durable truth is
 * the published artifact set under data/articles/*.json — the pipeline's seed
 * step can rebuild any row from its artifact with zero LLM calls. Deleting the
 * DB therefore loses nothing.
 */

import { createRequire } from 'module';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = join(__dirname, '..', '..');
export const DB_PATH = process.env.DB_PATH
  ? (process.env.DB_PATH.startsWith('/') ? process.env.DB_PATH : join(ROOT, process.env.DB_PATH))
  : join(ROOT, 'data', 'dv.db');

// One column map = one source of truth for the schema. ensureSchema() creates
// the table if missing and ALTERs in any column added later — both idempotent,
// so every entrypoint can call it unconditionally.
const COLUMNS = {
  slug: "TEXT PRIMARY KEY",
  topic: "TEXT",
  category: "TEXT",
  era: "TEXT",
  title: "TEXT",
  meta_description: "TEXT",
  tags: "TEXT",                 // JSON array
  bundle_data: "TEXT",          // JSON: {title, meta_description, tags, outline}
  sections_data: "TEXT",        // JSON: [{id, heading, paragraphs, list?, faq?}]
  html: "TEXT",                 // assembled <article> inner html
  word_count: "INTEGER DEFAULT 0",
  sanitized: "INTEGER DEFAULT 0",
  sanitize_failures: "TEXT",
  db_complete: "INTEGER DEFAULT 0",
  db_complete_failures: "TEXT", // JSON array of failed contract checks
  db_complete_at: "TEXT",
  publish_status: "TEXT",
  published_at: "TEXT",
  retry_bundle: "INTEGER DEFAULT 0",
  retry_sections: "INTEGER DEFAULT 0",
  status_step: "TEXT",
  status_blockers: "TEXT",      // JSON
  status_llm_needed: "TEXT",    // JSON
  status_checked_at: "TEXT",
  created_at: "TEXT DEFAULT (datetime('now'))",
  updated_at: "TEXT",
};

export function ensureSchema(db) {
  const defs = Object.entries(COLUMNS).map(([name, def]) => `${name} ${def}`).join(',\n  ');
  db.exec(`CREATE TABLE IF NOT EXISTS articles (\n  ${defs}\n)`);
  const existing = new Set(db.prepare(`PRAGMA table_info(articles)`).all().map(c => c.name));
  for (const [name, def] of Object.entries(COLUMNS)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE articles ADD COLUMN ${name} ${def}`);
  }
}

export function openDb({ readonly = false } = {}) {
  const Database = require('better-sqlite3');
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (readonly) {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma('query_only = true');
    return db;
  }
  const db = new Database(DB_PATH);
  ensureSchema(db);
  return db;
}

export const COLUMN_NAMES = Object.keys(COLUMNS);
