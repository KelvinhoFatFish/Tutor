import 'server-only';
import { ACHIEVEMENT_SEED, SCHEMA_SQL } from './schema';
import { newId, nowIso } from './helpers';

export * from './helpers';

/**
 * A tiny database abstraction.
 *
 * Why? So the exact same application code can talk to:
 *   - SQLite   (default)  -> a single file on your computer. No accounts, no setup.
 *   - Postgres (optional) -> e.g. Supabase, for a deployed site where the disk
 *                            is wiped on every deploy.
 *
 * You choose with the DB_DRIVER environment variable. See .env.example.
 */

export type Dialect = 'sqlite' | 'postgres';

export interface QueryResult {
  changes: number;
}

export interface Db {
  dialect: Dialect;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
  /** Releases the connection. Used by scripts and tests. */
  close(): Promise<void>;
}

/** Rewrites `?` placeholders into PostgreSQL's `$1, $2, ...` form. */
export function toPgPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${(index += 1)}`);
}

// ---------------------------------------------------------------------------
// SQLite driver (node:sqlite, built into Node 22.5+)
// ---------------------------------------------------------------------------

async function createSqliteDb(): Promise<Db> {
  const { DatabaseSync } = await import('node:sqlite');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const file = process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : path.join(process.cwd(), 'data', 'pushup-league.db');

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA busy_timeout = 5000;');

  const normalise = (params: unknown[] = []) =>
    params.map((p) => {
      if (p === undefined) return null;
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p as never;
    });

  return {
    dialect: 'sqlite',
    async all<T>(sql: string, params: unknown[] = []) {
      return raw.prepare(sql).all(...normalise(params)) as T[];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const row = raw.prepare(sql).get(...normalise(params));
      return (row as T) ?? null;
    },
    async run(sql: string, params: unknown[] = []) {
      const result = raw.prepare(sql).run(...normalise(params));
      return { changes: Number(result.changes ?? 0) };
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
    async close() {
      raw.close();
    },
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL driver (used in production, e.g. Supabase)
// ---------------------------------------------------------------------------

async function createPostgresDb(): Promise<Db> {
  const pg = await import('pg');

  // Without this, SUM()/COUNT() come back as strings and break arithmetic.
  const types = (pg as unknown as { types?: { setTypeParser: (id: number, fn: (v: string) => unknown) => void } }).types;
  if (types?.setTypeParser) {
    types.setTypeParser(20, (v: string) => Number(v)); // int8
    types.setTypeParser(1700, (v: string) => Number(v)); // numeric
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DB_DRIVER=postgres requires DATABASE_URL to be set. Add it to .env.local (see .env.example).',
    );
  }

  const needsSsl =
    process.env.DATABASE_SSL !== 'disable' &&
    !/localhost|127\.0\.0\.1/.test(connectionString);

  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  const normalise = (params: unknown[] = []) =>
    params.map((p) => (p === undefined ? null : p));

  return {
    dialect: 'postgres',
    async all<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(toPgPlaceholders(sql), normalise(params));
      return res.rows as T[];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(toPgPlaceholders(sql), normalise(params));
      return (res.rows[0] as T) ?? null;
    },
    async run(sql: string, params: unknown[] = []) {
      const res = await pool.query(toPgPlaceholders(sql), normalise(params));
      return { changes: res.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton + one-time migration
// ---------------------------------------------------------------------------

interface DbGlobal {
  __pushupLeagueDb?: Promise<Db>;
  __pushupLeagueReady?: Promise<Db>;
}

const globalCache = globalThis as unknown as DbGlobal;

async function connect(): Promise<Db> {
  const driver = (process.env.DB_DRIVER ?? 'sqlite').toLowerCase();
  const db = driver === 'postgres' || driver === 'pg' ? await createPostgresDb() : await createSqliteDb();
  await db.exec(SCHEMA_SQL);
  await seedAchievements(db);
  return db;
}

/** Creates the tables the first time the app runs, then reuses the connection. */
export function getDb(): Promise<Db> {
  if (!globalCache.__pushupLeagueReady) {
    globalCache.__pushupLeagueReady = connect().catch((error) => {
      // Let the next request retry instead of caching a broken promise forever.
      globalCache.__pushupLeagueReady = undefined;
      throw error;
    });
  }
  return globalCache.__pushupLeagueReady;
}

async function seedAchievements(db: Db): Promise<void> {
  for (const a of ACHIEVEMENT_SEED) {
    await db.run(
      `INSERT INTO achievements (id, code, name, description, icon, kind, threshold, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (code) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         icon = excluded.icon,
         kind = excluded.kind,
         threshold = excluded.threshold,
         sort_order = excluded.sort_order`,
      [a.code, a.code, a.name, a.description, a.icon, a.kind, a.threshold, a.sort_order],
    );
  }
}

/** Convenience: run several statements atomically-ish (best effort). */
export async function transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (db.dialect === 'sqlite') {
    await db.exec('BEGIN');
    try {
      const result = await fn(db);
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }
  // For Postgres the pool hands out different connections per query, so a
  // true transaction needs a dedicated client. Our writes are individually
  // idempotent, so we accept non-transactional semantics here.
  return fn(db);
}

export { newId, nowIso };
