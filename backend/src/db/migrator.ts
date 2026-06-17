import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Migrator, FileMigrationProvider, sql, type MigrationResultSet } from 'kysely';
import { db } from './pool';

/**
 * Resolve the schema the connection actually writes to (the first existing
 * entry in its search_path). In prod/dev that's `public`; in integration tests
 * each run uses a disposable `atm_test_*` schema set via the DATABASE_URL
 * `options=-c search_path=…`. Returns undefined only if search_path resolves to
 * nothing (then the migrator falls back to its default, unscoped behavior).
 */
async function currentSchema(): Promise<string | undefined> {
  const { rows } = await sql<{ schema: string | null }>`select current_schema() as schema`.execute(db);
  return rows[0]?.schema ?? undefined;
}

/**
 * Build a Migrator bound to the shared `db` and the migrations folder next to
 * this module. `__dirname` resolves to `src/db` under tsx (dev + migrate CLI)
 * and `dist/db` under node (prod + compiled test helper), so the same path
 * finds `.ts` sources or compiled `.js` migrations. FileMigrationProvider
 * already ignores `.d.ts` / `.js.map`.
 *
 * `migrationTableSchema` is pinned to the connection's current schema. Without
 * it the migrator's existence check (`introspection.getTables`) scans EVERY
 * schema in the database, so a `kysely_migration_lock` table in another schema
 * — e.g. a second integration-test schema running concurrently against the same
 * Postgres — makes it skip creating the table in THIS schema, and the later
 * search_path-scoped lock SELECT then fails with "relation does not exist".
 * Pinning the schema scopes both the check and the create/select to one place.
 */
function makeMigrator(migrationTableSchema: string | undefined): Migrator {
  return new Migrator({
    db,
    migrationTableSchema,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });
}

/** Throw on the first failed migration, surfacing which one broke. */
function assertOk(results: MigrationResultSet, verb: string): void {
  const { error, results: applied } = results;
  for (const r of applied ?? []) {
    if (r.status === 'Success') {
      console.log(`✅ ${verb} migration "${r.migrationName}"`);
    } else if (r.status === 'Error') {
      console.error(`❌ failed to ${verb} migration "${r.migrationName}"`);
    }
  }
  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** Apply all pending migrations. Fail-fast: a bad migration must not boot a dirty server. */
export async function migrateToLatest(): Promise<void> {
  const migrator = makeMigrator(await currentSchema());
  assertOk(await migrator.migrateToLatest(), 'apply');
  console.log('✅ PostgreSQL schema up to date');
}

/** Roll back exactly one migration (the most recently applied). */
export async function migrateDown(): Promise<void> {
  const migrator = makeMigrator(await currentSchema());
  assertOk(await migrator.migrateDown(), 'revert');
}
