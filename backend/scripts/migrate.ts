/**
 * Migration CLI.
 *   npm run migrate          → apply all pending migrations (to latest)
 *   npm run migrate:down     → roll back the most recent migration
 *   npm run migrate -- down  → same as migrate:down
 *
 * Reads DATABASE_URL the same way the app does (via db/pool). Exits non-zero on
 * failure so CI and deploy scripts can gate on it.
 */
import { migrateToLatest, migrateDown } from '../src/db/migrator';
import { closeDb } from '../src/db/pool';

async function main(): Promise<void> {
  const direction = process.argv[2];
  if (direction === 'down') {
    await migrateDown();
  } else {
    await migrateToLatest();
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    try { await closeDb(); } catch { /* already closing */ }
    process.exit(1);
  });
