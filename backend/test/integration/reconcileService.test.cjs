// Integration tests for reconcileService (tech-debt block B). The conservation
// self-check is THE money invariant (atm_conservation_ok) — it's what the P0
// alert pages on — yet it had zero tests. We assert it reports ok:true for
// conserved states (including the frozen-folds-into-earned subtlety) AND that it
// actually CATCHES a break: a balance mutated outside the ledger must surface a
// non-zero per-class diff and flip ok:false.
// Requires DATABASE_URL. Run: npm run test:integration

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let acct, reconcileSvc, ctx;
const db = () => require('../../dist/db/pool.js').default;
const now = () => new Date().toISOString();

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  reconcileSvc = require('../../dist/services/reconcileService.js');
});

after(async () => {
  await ctx.teardown();
});

// reconcile() sums the WHOLE schema, so each test must start from an empty ledger
// to keep diffs localized and deterministic — otherwise an earlier test's credits
// (or an injected break) leak into the next test's sums. TRUNCATE CASCADE clears
// the ledger + balances + flags in one shot regardless of FK order.
beforeEach(async () => {
  const { sql } = require('kysely');
  await sql`TRUNCATE TABLE credit_ledger, risk_flags, accounts RESTART IDENTITY CASCADE`.execute(db());
});

async function earn(accountId, amount) {
  await db().transaction().execute((trx) =>
    acct.creditCredits(trx, accountId, amount, 'test_earn', { creditClass: 'earned' })
  );
}
async function gift(accountId, amount) {
  await db().transaction().execute((trx) =>
    acct.creditCredits(trx, accountId, amount, 'test_gift', { creditClass: 'gift' })
  );
}

test('empty system reconciles (all sums zero, ok:true)', async () => {
  const r = await reconcileSvc.reconcile(now());
  assert.equal(r.ok, true);
  assert.equal(r.earned.diff, 0);
  assert.equal(r.gift.diff, 0);
  assert.equal(r.total.diff, 0);
});

test('credits via the ledger stay conserved per class', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'rc-earn', computeSource: 'local_model' });
  const b = await acct.createAccount({ type: 'human', name: 'rc-gift' });
  await earn(a.id, 230);
  await gift(b.id, 1000);

  const r = await reconcileSvc.reconcile(now());
  assert.equal(r.ok, true, 'conserved');
  assert.equal(r.earned.ledgerSum, r.earned.balanceSum, 'earned ledger == balance');
  assert.equal(r.gift.ledgerSum, r.gift.balanceSum, 'gift ledger == balance');
  assert.equal(r.earned.diff, 0);
  assert.equal(r.gift.diff, 0);
});

test('frozen earned is folded into the earned balance side (a freeze writes no ledger delta)', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'rc-frozen', computeSource: 'local_model' });
  await earn(a.id, 300);
  await acct.freezeEarned(a.id, 120, 'risk_freeze'); // earned→frozen, NO ledger delta

  const r = await reconcileSvc.reconcile(now());
  assert.equal(r.ok, true, 'still conserved: frozen counts toward the earned class');
  assert.equal(r.earned.frozen, 120, 'report surfaces the frozen total');
  // balanceSum must include frozen, else the diff would falsely flag a break.
  assert.equal(r.earned.diff, 0, 'frozen folded in → no false break');
});

test('catches a break: earned balance bumped OUTSIDE the ledger flips ok:false with a non-zero earned diff', async () => {
  const a = await acct.createAccount({ type: 'agent', name: 'rc-leak', computeSource: 'local_model' });
  await earn(a.id, 100);

  const base = await reconcileSvc.reconcile(now());
  assert.equal(base.ok, true, 'conserved before the injected break');

  // Conjure 50 earned credits directly on the balance with NO ledger row — exactly
  // the "credits created outside the double-entry path" failure the check exists for.
  await db().updateTable('accounts').set({ earned_balance: 150 }).where('id', '=', a.id).execute();

  const r = await reconcileSvc.reconcile(now());
  assert.equal(r.ok, false, 'break detected');
  // Assert the DELTA the break caused (robust to any residual global state): the
  // earned balance side grew 50 with no ledger row, so the diff drops by exactly 50.
  assert.equal(r.earned.diff - base.earned.diff, -50, 'earned diff shifts by the 50-credit leak');
  assert.equal(r.gift.diff - base.gift.diff, 0, 'gift class unaffected (break localized to earned)');
});

test('catches a break in the gift class independently', async () => {
  const a = await acct.createAccount({ type: 'human', name: 'rc-leak-gift' });
  await gift(a.id, 100);

  const base = await reconcileSvc.reconcile(now());
  assert.equal(base.ok, true, 'conserved before the injected break');

  // Destroy 20 gift credits with NO ledger row (relative decrement, so this is
  // independent of the signup-gift starting balance createAccount grants).
  const { sql } = require('kysely');
  await db().updateTable('accounts').set({ gift_balance: sql`gift_balance - 20` }).where('id', '=', a.id).execute();

  const r = await reconcileSvc.reconcile(now());
  assert.equal(r.ok, false);
  // Gift balance side shrank by 20 with no ledger row → gift diff rises by 20.
  assert.equal(r.gift.diff - base.gift.diff, 20, 'gift diff shifts by the destroyed 20');
  assert.equal(r.earned.diff - base.earned.diff, 0, 'earned class unaffected');
});
