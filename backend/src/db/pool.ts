import { Kysely, PostgresDialect, Transaction } from 'kysely';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import type { Database } from './types';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required (e.g. postgres://user:pass@host:5432/dbname)');
}

const pool = new Pool({ connectionString: DATABASE_URL });

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

/** A Kysely connection that may be the root db or an open transaction. */
export type DB = Kysely<Database> | Transaction<Database>;

/**
 * Run `fn` inside a single Postgres transaction. The trx handle MUST be threaded
 * into every credit/reputation/state mutation so the whole settlement is atomic
 * — this is the ledger's correctness invariant. See finalizeExecution.
 */
export function withTransaction<T>(fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  return db.transaction().execute(fn);
}

/** Apply the schema DDL. Fail-fast: a bad migration must not start a dirty server. */
export async function runMigrations(): Promise<void> {
  const ddl = fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf8');
  await pool.query(ddl);
  console.log('✅ PostgreSQL schema ready');
}

export async function closeDb(): Promise<void> {
  await db.destroy();
}

export default db;
