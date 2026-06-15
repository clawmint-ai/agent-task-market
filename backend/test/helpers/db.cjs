// Shared Postgres bootstrap for integration tests. Creates a disposable schema,
// runs the migrations into it, and exposes setup/teardown. Requires DATABASE_URL
// to point at a real Postgres (local docker or Neon). Sandbox CI without a DB
// should run `npm run test:unit` instead.

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function makeSchemaName() {
  return 'atm_test_' + Math.random().toString(36).slice(2, 8);
}

/**
 * Bootstrap a disposable schema and point the app's pool at it. Returns
 * { schema, adminPool, teardown }. MUST be called before requiring any
 * dist/services module (the pool reads DATABASE_URL at import time).
 */
async function setupSchema() {
  const RAW = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
  const schema = makeSchemaName();

  const scoped = new URL(RAW);
  scoped.searchParams.set('options', `-c search_path=${schema}`);
  const scopedUrl = scoped.toString();

  // App pool (dist/db/pool.js) reads this at import → must be set before require.
  process.env.DATABASE_URL = scopedUrl;

  const adminPool = new Pool({ connectionString: RAW });
  await adminPool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

  const ddl = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'db', 'schema.pg.sql'), 'utf8');
  const scopedPool = new Pool({ connectionString: scopedUrl });
  await scopedPool.query(ddl);
  await scopedPool.end();

  return {
    schema,
    adminPool,
    async teardown() {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await adminPool.end();
      const { closeDb } = require('../../dist/db/pool.js');
      await closeDb();
    },
  };
}

module.exports = { setupSchema };
