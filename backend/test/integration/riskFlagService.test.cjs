// Integration tests for riskFlagService (block A of the tech-debt sweep). This
// module was completely untested yet CLAWMIN-48/49 (the review-flags CLI + the
// Telegram review loop) depend on it to release/confirm FROZEN rewards — i.e. to
// move real money back into circulation. We assert the audit-row lifecycle AND
// the conservation-safe freeze/unfreeze it drives.
// Requires DATABASE_URL. Run: npm run test:integration

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let flags, acct, reconcileSvc, ctx;
const db = () => require('../../dist/db/pool.js').default;

before(async () => {
  ctx = await setupSchema();
  flags = require('../../dist/services/riskFlagService.js');
  acct = require('../../dist/services/accountService.js');
  reconcileSvc = require('../../dist/services/reconcileService.js');
});

after(async () => {
  await ctx.teardown();
});

// Give an account EARNED credits (mirrors how settlement pays a winner), so we
// have a real freezable balance to exercise the release path against.
async function earn(accountId, amount) {
  await db().transaction().execute((trx) =>
    acct.creditCredits(trx, accountId, amount, 'test_earn', { creditClass: 'earned' })
  );
}

// Reproduce what settlement does on a flagged payout: pay (earn), freeze the
// reward, and record the open risk_flag with amount=reward — all the precondition
// for an admin release/confirm. Returns the flag id.
async function frozenFlag(accountId, amount, kind = 'self_dealing_same_ip') {
  await earn(accountId, amount);
  await acct.freezeEarned(accountId, amount, 'risk_freeze');
  return flags.insertRiskFlag(db(), { accountId, kind, amount, refId: null, detail: { kind } });
}

test('insertRiskFlag persists an open row that listRiskFlags returns', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'rf-insert', computeSource: 'local_model' });
  const id = await flags.insertRiskFlag(db(), { accountId: a.id, kind: 'review', amount: 0, detail: { note: 'x' } });
  const open = await flags.listRiskFlags('open');
  const row = open.find((f) => f.id === id);
  assert.ok(row, 'inserted flag appears in open list');
  assert.equal(row.status, 'open');
  assert.equal(row.account_id, a.id);
  assert.equal(Number(row.amount), 0);
});

test('releaseRiskFlag unfreezes the held reward (frozen→earned), marks released, stays conserved', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'rf-release', computeSource: 'local_model' });
  const id = await frozenFlag(a.id, 200);

  const before = await acct.getAccountById(a.id);
  assert.equal(before.earned_balance, 0, 'reward is frozen, not spendable');
  assert.equal(before.frozen_earned_balance, 200);
  assert.equal((await reconcileSvc.reconcile(new Date().toISOString())).ok, true, 'conserved while frozen');

  const returned = await flags.releaseRiskFlag(id, 'cli-admin');
  assert.equal(returned, id, 'returns the resolved flag id');

  const after = await acct.getAccountById(a.id);
  assert.equal(after.earned_balance, 200, 'reward returned to spendable earned');
  assert.equal(after.frozen_earned_balance, 0, 'nothing left frozen');

  const released = await flags.listRiskFlags('released');
  const row = released.find((f) => f.id === id);
  assert.ok(row, 'flag now in released list');
  assert.equal(row.resolved_by, 'cli-admin');
  assert.ok(row.resolved_at, 'resolved_at stamped');

  assert.equal((await reconcileSvc.reconcile(new Date().toISOString())).ok, true, 'conserved after release');
});

test('confirmRiskFlag upholds the freeze: open→frozen, credits stay held, no ledger move', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'rf-confirm', computeSource: 'local_model' });
  const id = await frozenFlag(a.id, 150);

  const returned = await flags.confirmRiskFlag(id, 'cli-admin');
  assert.equal(returned, id);

  const after = await acct.getAccountById(a.id);
  assert.equal(after.earned_balance, 0, 'still not spendable');
  assert.equal(after.frozen_earned_balance, 150, 'credits remain frozen (upheld)');

  const frozen = await flags.listRiskFlags('frozen');
  const row = frozen.find((f) => f.id === id);
  assert.ok(row, 'flag now in frozen list');
  assert.equal(row.resolved_by, 'cli-admin');

  // Confirm moves no money — conservation holds (frozen still folded into earned class).
  assert.equal((await reconcileSvc.reconcile(new Date().toISOString())).ok, true, 'conserved after confirm');
});

test('an amount=0 (audit-only) flag releases with no ledger movement', async () => {
  // Register-time sybil markers freeze nothing (amount 0); releasing must be a
  // pure status change — exercises the `if (flag.amount > 0)` guard's false arm.
  const a = await acct.createAccount({ type: 'agent', name: 'rf-zero', computeSource: 'local_model' });
  const id = await flags.insertRiskFlag(db(), { accountId: a.id, kind: 'signup_burst', amount: 0 });
  const returned = await flags.releaseRiskFlag(id, 'cli-admin');
  assert.equal(returned, id);
  const row = (await flags.listRiskFlags('released')).find((f) => f.id === id);
  assert.ok(row, 'released');
  assert.equal((await reconcileSvc.reconcile(new Date().toISOString())).ok, true, 'still conserved');
});

test('release / confirm on a non-open flag throws (idempotency guard)', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'rf-twice', computeSource: 'local_model' });
  const id = await frozenFlag(a.id, 100);
  await flags.releaseRiskFlag(id, 'cli-admin'); // first release succeeds

  // Second release: no open row → throws, and must NOT double-unfreeze.
  await assert.rejects(() => flags.releaseRiskFlag(id, 'cli-admin'), /not found or not open/);
  // Confirm on an already-released flag also throws.
  await assert.rejects(() => flags.confirmRiskFlag(id, 'cli-admin'), /not found or not open/);

  const after = await acct.getAccountById(a.id);
  assert.equal(after.earned_balance, 100, 'released once — no double credit');
  assert.equal(after.frozen_earned_balance, 0);
});

test('release / confirm of an unknown flag id throws', async () => {
  await assert.rejects(() => flags.releaseRiskFlag('00000000-0000-0000-0000-000000000000', 'cli-admin'), /not found or not open/);
  await assert.rejects(() => flags.confirmRiskFlag('00000000-0000-0000-0000-000000000000', 'cli-admin'), /not found or not open/);
});

test('listRiskFlags filters by status', async () => {
  // Across the suite we have created open, released, and frozen flags. Each
  // filtered list must contain only its status.
  for (const status of ['open', 'released', 'frozen']) {
    const rows = await flags.listRiskFlags(status);
    assert.ok(rows.every((f) => f.status === status), `every row in ${status} list has status ${status}`);
  }
});
