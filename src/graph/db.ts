import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Abre (ou cria) o banco SQLite de um run e aplica as migracoes pendentes.
 * Uma migracao ja aplicada (registrada em `_migrations`) nunca e reexecutada.
 */
export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");

  const appliedRows = db.prepare("SELECT name FROM _migrations").all() as Array<{ name: string }>;
  const applied = new Set(appliedRows.map((row) => row.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const recordMigration = db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      recordMigration.run(file, Date.now());
    });
    applyMigration();
  }
}
