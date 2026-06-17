// Integration tests for credit-class isolation (CLAWMIN-19): freeze/unfreeze,
// per-class reconciliation conservation, and the redeem persistence path.
// Requires DATABASE_URL. Run: npm run test:integration
// (sandbox without a DB: the pure policy is covered by test/unit/redeem.test.ts)

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let acct, reconcileSvc, ctx;

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  reconcileSvc = require('../../dist/services/reconcileService.js');
});

after(async () => {
  await ctx.teardown();
});

// Give an account some EARNED credits by crediting directly inside a txn (mirrors
// how settlement pays a winner) so we have a redeemable/freezable balance to test.
const db = () => require('../../dist/db/pool.js').default;
async function earn(accountId, amount) {
  await db().transaction().execute((trx) =>
    acct.creditCredits(trx, accountId, amount, 'test_earn', { creditClass: 'earned' })
  );
}

test('freeze moves earned→frozen, leaves it unspendable, and reconciliation stays conserved', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'frz', computeSource: 'local_model' });
  await earn(a.id, 500);

  // Reconciliation is balanced before freezing.
  const before = await reconcileSvc.reconcile(new Date().toISOString());
  assert.equal(before.ok, true, 'conserved before freeze');

  const r = await acct.freezeEarned(a.id, 200, 'risk_hold');
  assert.equal(r.earned_balance, 300, 'spendable earned dropped by 200');
  assert.equal(r.frozen_earned_balance, 200, 'frozen rose by 200');

  const acctAfter = await acct.getAccountById(a.id);
  assert.equal(acctAfter.earned_balance, 300);
  assert.equal(acctAfter.frozen_earned_balance, 200);

  // CRITICAL: a freeze writes NO net ledger delta, so conservation must still hold
  // because reconcile folds frozen back into the earned balance sum.
  const after = await reconcileSvc.reconcile(new Date().toISOString());
  assert.equal(after.ok, true, 'still conserved after freeze (frozen counted in earned)');
  assert.equal(after.earned.frozen, 200, 'report surfaces frozen total');
  assert.equal(after.earned.diff, 0, 'earned class conserved with frozen folded in');
});

test('unfreeze restores spendable earned and stays conserved', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'unf', computeSource: 'local_model' });
  await earn(a.id, 100);
  await acct.freezeEarned(a.id, 100, 'risk_hold');
  const r = await acct.unfreezeEarned(a.id, 60, 'cleared');
  assert.equal(r.earned_balance, 60);
  assert.equal(r.frozen_earned_balance, 40);
  const rep = await reconcileSvc.reconcile(new Date().toISOString());
  assert.equal(rep.ok, true, 'conserved after unfreeze');
});

test('cannot freeze more than spendable earned', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'over', computeSource: 'local_model' });
  await earn(a.id, 50);
  await assert.rejects(() => acct.freezeEarned(a.id, 51, 'risk_hold'), /Insufficient earned/);
});

test('redeemEarned debits earned and records a -delta ledger row (conserved)', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'rdm', computeSource: 'local_model' });
  await earn(a.id, 300);
  const newBal = await acct.redeemEarned(a.id, 120);
  assert.equal(newBal, 180, 'earned debited by redeemed amount');
  const rep = await reconcileSvc.reconcile(new Date().toISOString());
  assert.equal(rep.ok, true, 'conserved after redemption (real -delta in ledger)');
});

test('redeemEarned cannot overdraw earned balance', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'rdm2', computeSource: 'local_model' });
  await earn(a.id, 40);
  await assert.rejects(() => acct.redeemEarned(a.id, 41), /Insufficient credits/);
});

test('frozen earned is NOT redeemable: freezing it removes it from the spendable pool', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'rdm3', computeSource: 'local_model' });
  await earn(a.id, 100);
  await acct.freezeEarned(a.id, 100, 'risk_hold'); // spendable earned → 0
  // The service guard blocks it (and the route's decideRedeem would 409 first).
  await assert.rejects(() => acct.redeemEarned(a.id, 1), /Insufficient credits/);
});
