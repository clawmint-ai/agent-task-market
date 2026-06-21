// Integration tests for accountService money primitives (tech-debt block C).
// creditClass.test.cjs already covers freeze/unfreeze/redeem happy paths + the
// redeem overdraw guard; this file targets the gaps: the guarded debit (can't go
// negative / account-not-found), the gift-first publish-escrow split + its exact
// returned amounts (needed to refund the same split), amount validation on the
// freeze primitive, and a concurrent double-debit race against one balance.
// Requires DATABASE_URL. Run: npm run test:integration

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let acct, ctx;
const db = () => require('../../dist/db/pool.js').default;

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
});
after(async () => { await ctx.teardown(); });
beforeEach(async () => {
  const { sql } = require('kysely');
  await sql`TRUNCATE TABLE credit_ledger, risk_flags, accounts RESTART IDENTITY CASCADE`.execute(db());
});

async function earn(accountId, amount) {
  await db().transaction().execute((trx) =>
    acct.creditCredits(trx, accountId, amount, 'test_earn', { creditClass: 'earned' })
  );
}
const tx = (fn) => db().transaction().execute(fn);

test('debitCredits: guarded decrement records a -delta and returns the new balance', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'dc', computeSource: 'local_model' });
  await earn(a.id, 100);
  const bal = await tx((trx) => acct.debitCredits(trx, a.id, 30, 'test_debit', { creditClass: 'earned' }));
  assert.equal(bal, 70, 'returns post-debit balance');
  const acctAfter = await acct.getAccountById(a.id);
  assert.equal(acctAfter.earned_balance, 70);
  // the ledger row is a real -delta
  const rows = await db().selectFrom('credit_ledger').selectAll().where('account_id', '=', a.id).where('reason', '=', 'test_debit').execute();
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].delta), -30);
});

test('debitCredits: cannot overdraw (guard rejects, balance untouched)', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'dc-over', computeSource: 'local_model' });
  await earn(a.id, 40);
  await assert.rejects(() => tx((trx) => acct.debitCredits(trx, a.id, 41, 'x', { creditClass: 'earned' })), /Insufficient credits/);
  assert.equal((await acct.getAccountById(a.id)).earned_balance, 40, 'balance unchanged after rejected debit');
});

test('debitCredits: unknown account throws Account not found', async () => {
  await assert.rejects(
    () => tx((trx) => acct.debitCredits(trx, '00000000-0000-0000-0000-000000000000', 10, 'x', { creditClass: 'earned' })),
    /Account not found/,
  );
});

test('debitForPublish: spends gift first, then earned, and returns the exact split', async () => {
  // Human signup grants 1000 gift. Add 200 earned, then publish-debit 1100:
  // should drain all 1000 gift + 100 earned.
  const a = await acct.createAccount({ type: 'human', name: 'pub-split' });
  await earn(a.id, 200);
  const split = await tx((trx) => acct.debitForPublish(trx, a.id, 1100, 'task_escrow'));
  assert.deepEqual(split, { gift: 1000, earned: 100 }, 'gift-first split');
  const after = await acct.getAccountById(a.id);
  assert.equal(after.gift_balance, 0, 'gift fully drained');
  assert.equal(after.earned_balance, 100, 'earned drained by the remainder');
});

test('debitForPublish: when gift covers it, earned is untouched (earned:0 in split)', async () => {
  const a = await acct.createAccount({ type: 'human', name: 'pub-gift-only' }); // 1000 gift
  await earn(a.id, 500);
  const split = await tx((trx) => acct.debitForPublish(trx, a.id, 300, 'task_escrow'));
  assert.deepEqual(split, { gift: 300, earned: 0 }, 'covered entirely by gift');
  const after = await acct.getAccountById(a.id);
  assert.equal(after.gift_balance, 700);
  assert.equal(after.earned_balance, 500, 'earned untouched');
});

test('freezeEarned: rejects a non-positive or non-integer amount before touching balances', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'frz-bad', computeSource: 'local_model' });
  await earn(a.id, 100);
  await assert.rejects(() => acct.freezeEarned(a.id, 0, 'x'), /positive integer/);
  await assert.rejects(() => acct.freezeEarned(a.id, -5, 'x'), /positive integer/);
  await assert.rejects(() => acct.freezeEarned(a.id, 1.5, 'x'), /positive integer/);
  assert.equal((await acct.getAccountById(a.id)).earned_balance, 100, 'balance untouched after rejected freeze');
});

test('concurrent debits cannot drive a balance negative (guard holds under race)', async () => {
  // Balance 100, fire two concurrent 70-debits. The guarded decrement must let
  // exactly one win; the other rejects on the balance>=amount guard.
  const a = await acct.createAccount({ type: 'agent', name: 'race', computeSource: 'local_model' });
  await earn(a.id, 100);
  const results = await Promise.allSettled([
    tx((trx) => acct.debitCredits(trx, a.id, 70, 'race', { creditClass: 'earned' })),
    tx((trx) => acct.debitCredits(trx, a.id, 70, 'race', { creditClass: 'earned' })),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1, 'exactly one debit succeeds');
  assert.equal(failed.length, 1, 'the other is rejected by the guard');
  assert.match(String(failed[0].reason?.message || failed[0].reason), /Insufficient credits/);
  assert.equal((await acct.getAccountById(a.id)).earned_balance, 30, 'balance never went negative (100-70)');
});
