// CLAWMIN-47: a balance that exists with no matching ledger rows breaks
// conservation (reconcile gift diff != 0). The backfill inserts the ONE missing
// gift ledger row (delta = gap, balance_after = current balance) WITHOUT touching
// gift_balance, restoring Σledger(gift) == Σgift_balance. Mirrors the prod
// platform-seeder state created by the old raw-UPDATE seeder.
//
// Requires DATABASE_URL. Run: npm run test:integration

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

let acct, ctx, db, sql;

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  ({ sql } = require('kysely'));
  db = require('../../dist/db/pool.js').default;
});

after(async () => {
  await ctx.teardown();
});

const giftLedger = async (id) => {
  const r = await ctx.adminPool.query(
    `SELECT COALESCE(SUM(delta),0)::int s FROM ${ctx.schema}.credit_ledger WHERE account_id=$1 AND credit_class='gift'`,
    [id]
  );
  return r.rows[0].s;
};
const giftBalance = async (id) => (await acct.getAccountById(id)).gift_balance;

test('backfill: a balance with no ledger row → after backfill, gift conserves (1 row, balance unchanged)', async () => {
  // Build the broken state the old seeder produced: create platform-seeder
  // properly (signup grant has a ledger row), then bump gift_balance via a RAW
  // UPDATE — no ledger row, exactly the prod break.
  const seeder = await acct.createAccount({ type: 'human', name: 'platform-seeder', computeSource: 'platform_credit' });
  await ctx.adminPool.query(`UPDATE ${ctx.schema}.accounts SET gift_balance=1000000 WHERE id=$1`, [seeder.id]);

  const balBefore = await giftBalance(seeder.id);
  const ledgerBefore = await giftLedger(seeder.id);
  assert.equal(balBefore, 1000000, 'balance bumped');
  assert.equal(ledgerBefore, 1000, 'only the signup grant is in the ledger');
  const gap = balBefore - ledgerBefore; // 999000

  // Run the backfill script with --commit against this test schema.
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'backfill-seeder-gift-ledger.ts');
  execFileSync('npx', ['tsx', scriptPath, '--commit'], {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });

  const balAfter = await giftBalance(seeder.id);
  const ledgerAfter = await giftLedger(seeder.id);
  assert.equal(balAfter, balBefore, 'gift_balance is UNCHANGED by the backfill');
  assert.equal(ledgerAfter, balAfter, 'Σledger(gift) now equals gift_balance (conserved)');

  // Exactly one new gift row, tagged seed_grant_backfill, delta == gap.
  const rows = await ctx.adminPool.query(
    `SELECT delta, balance_after, reason FROM ${ctx.schema}.credit_ledger WHERE account_id=$1 AND reason='seed_grant_backfill'`,
    [seeder.id]
  );
  assert.equal(rows.rows.length, 1, 'exactly one backfill row inserted');
  assert.equal(Number(rows.rows[0].delta), gap, `delta == gap (${gap})`);
  assert.equal(Number(rows.rows[0].balance_after), balAfter, 'balance_after == current gift_balance');
});

test('backfill is idempotent: a second run is a no-op (no extra row)', async () => {
  const seeder = await db.selectFrom('accounts').select('id').where('name', '=', 'platform-seeder').executeTakeFirst();
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'backfill-seeder-gift-ledger.ts');
  execFileSync('npx', ['tsx', scriptPath, '--commit'], {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });
  const rows = await ctx.adminPool.query(
    `SELECT count(*)::int c FROM ${ctx.schema}.credit_ledger WHERE account_id=$1 AND reason='seed_grant_backfill'`,
    [seeder.id]
  );
  assert.equal(rows.rows[0].c, 1, 'still exactly one backfill row (gap was 0 → no-op)');
});

test('reconcile reports gift conserved after backfill', async () => {
  const { reconcile } = require('../../dist/services/reconcileService.js');
  const report = await reconcile(new Date().toISOString());
  assert.equal(report.gift.diff, 0, 'gift diff is zero');
  assert.equal(report.ok, true, 'overall reconcile ok');
});
