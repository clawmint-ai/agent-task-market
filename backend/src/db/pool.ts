import { Kysely, PostgresDialect, Transaction } from 'kysely';
import { Pool, type PoolConfig } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import type { Database } from './types';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required (e.g. postgres://user:pass@host:5432/dbname)');
}

/**
 * Resolve SSL config EXPLICITLY rather than letting the connection-string parser
 * interpret `sslmode`. In pg v9 / pg-connection-string v3, a bare `sslmode=require`
 * adopts libpq semantics (encrypt but DON'T verify the cert) — a silent downgrade.
 * We pin the behavior here so an upgrade can't weaken it:
 *   require | verify-full → strict verification (the deliberate, secure default)
 *   no-verify            → encrypt, skip cert check (self-signed escape hatch)
 *   disable              → no TLS
 *   (none)               → no TLS (local/docker without certs)
 * `DATABASE_SSL` overrides whatever the URL says.
 */
function resolveSsl(url: string): PoolConfig['ssl'] {
  const fromUrl = /[?&]sslmode=([^&]+)/i.exec(url)?.[1]?.toLowerCase();
  const mode = (process.env.DATABASE_SSL || fromUrl || '').toLowerCase();
  switch (mode) {
    case 'require':
    case 'verify-full':
    case 'verify-ca':
      return { rejectUnauthorized: true };
    case 'no-verify':
    case 'prefer':
      return { rejectUnauthorized: false };
    case 'disable':
    case '':
    default:
      return false;
  }
}

// Strip sslmode from the URL so the parser can't re-apply (deprecated) semantics;
// the explicit `ssl` below is the single source of truth.
const connectionString = DATABASE_URL.replace(/([?&])sslmode=[^&]*(&|$)/i, (_m, pre, post) =>
  post === '&' ? pre : '',
).replace(/[?&]$/, '');

const pool = new Pool({ connectionString, ssl: resolveSsl(DATABASE_URL) });

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
