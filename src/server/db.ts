import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export interface Statement {
  run: (...params: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

export interface Db {
  exec: (sql: string) => void;
  prepare: (sql: string) => Statement;
  close: () => void;
}

export const withTransaction = <T>(db: Db, operation: () => T): T => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }
};

type DatabaseSyncConstructor = new (location: string) => Db;

const getDatabaseSync = (): DatabaseSyncConstructor => {
  const sqlite = require('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor };
  return sqlite.DatabaseSync;
};

export const openDatabase = (dbPath: string): Db => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      location TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ip_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL UNIQUE,
      interface_hint TEXT,
      ip TEXT NOT NULL,
      prefix INTEGER NOT NULL CHECK (prefix BETWEEN 0 AND 32),
      gateway TEXT NOT NULL,
      dns_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      effective_from TEXT,
      effective_to TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      device_key TEXT NOT NULL UNIQUE,
      public_key TEXT,
      token_hash TEXT UNIQUE,
      hostname TEXT,
      mac_address TEXT,
      mac_hash TEXT,
      client_version TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS check_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      device_id INTEGER NOT NULL,
      observed_ip TEXT,
      observed_prefix INTEGER,
      observed_gateway TEXT,
      observed_dns_json TEXT NOT NULL DEFAULT '[]',
      observed_mac TEXT,
      observed_mac_hash TEXT,
      result TEXT NOT NULL,
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'heartbeat',
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      device_id INTEGER NOT NULL,
      target_config_json TEXT NOT NULL,
      previous_config_json TEXT,
      change_token_hash TEXT,
      status TEXT NOT NULL,
      verification_json TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (event_id) REFERENCES check_events(id) ON DELETE SET NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_sha256 TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      imported_by TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      error_count INTEGER NOT NULL,
      full_sync INTEGER NOT NULL DEFAULT 0 CHECK (full_sync IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_teachers_enabled ON teachers(enabled);
    CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON check_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_teacher_created ON check_events(teacher_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
  `);

  // Keep existing SQLite volumes compatible when new device identity fields are added.
  const ensureColumn = (table: string, column: string, definition: string): void => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
    if (!columns.some((item) => item.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  ensureColumn('devices', 'mac_address', 'TEXT');
  ensureColumn('check_events', 'observed_mac', 'TEXT');

  return db;
};
