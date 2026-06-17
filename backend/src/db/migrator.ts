import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Migrator, FileMigrationProvider, type MigrationResultSet } from 'kysely';
import { db } from './pool';

/**
 * Build a Migrator bound to the shared `db` and the migrations folder that sits
 * next to this module. `__dirname` resolves to `src/db` under tsx (dev + the
 * migrate CLI) and to `dist/db` under node (prod + the compiled test helper),
 * so the same path finds `.ts` sources or compiled `.js` migrations without
 * branching. FileMigrationProvider already ignores `.d.ts` / `.js.map`.
 */
function makeMigrator(): Migrator {
  return new Migrator({
    db,
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
  assertOk(await makeMigrator().migrateToLatest(), 'apply');
  console.log('✅ PostgreSQL schema up to date');
}

/** Roll back exactly one migration (the most recently applied). */
export async function migrateDown(): Promise<void> {
  assertOk(await makeMigrator().migrateDown(), 'revert');
}
