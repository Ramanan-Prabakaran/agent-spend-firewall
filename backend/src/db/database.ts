/**
 * SQLite via sql.js (pure WebAssembly — no native build tools required).
 * We persist the database to disk manually after every write.
 */
import path from 'path';
import fs from 'fs';
import initSqlJs, { Database } from 'sql.js';

const DB_PATH = path.join(__dirname, '../../firewall.db');

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  return db;
}

/** Call after any INSERT/UPDATE to persist changes to disk. */
export function persistDb(database: Database): void {
  const data = database.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export async function initDb(): Promise<void> {
  const database = await getDb();

  database.run(`
    CREATE TABLE IF NOT EXISTS decision_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      item_name         TEXT    NOT NULL,
      qty               INTEGER NOT NULL,
      unit_price        REAL    NOT NULL,
      total_usd         REAL    NOT NULL,
      verdict           TEXT    NOT NULL CHECK(verdict IN ('allow','block')),
      reasons           TEXT    NOT NULL,
      injection_score   REAL,
      injection_details TEXT,
      shipping_address  TEXT,
      rules_breakdown   TEXT,
      paypal_order_id   TEXT,
      paypal_capture_id TEXT,
      source_text       TEXT
    );
  `);

  // Non-destructive migrations if table previously existed without the new columns
  try { database.run(`ALTER TABLE decision_log ADD COLUMN injection_details TEXT;`); } catch {}
  try { database.run(`ALTER TABLE decision_log ADD COLUMN shipping_address TEXT;`); } catch {}
  try { database.run(`ALTER TABLE decision_log ADD COLUMN rules_breakdown TEXT;`); } catch {}

  persistDb(database);
  console.log('[db] SQLite (sql.js) ready at', DB_PATH);
}
