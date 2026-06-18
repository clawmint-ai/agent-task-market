// Regression for CLAWMIN-39: escrow double-spend (money minted from nothing).
//
// Repro: a rejected submission with no other active execution takes the
// `reject_refund` path — the publisher is refunded ONCE. Before the fix the
// service also set the task back to `open` while leaving `tasks.escrow_gift /
// escrow_earned` non-zero, so a later `reclaimExpiredTasks` sweep saw a live
// escrow on an expired open task and refunded the SAME escrow a SECOND time.
//
// Each refund writes a balanced `credit_ledger` row, so the Σledger==Σbalances
// self-check stays green — the only observable symptom is the publisher's
// balance climbing past where it started. This test pins both: balance is
// conserved AND the escrow columns are zeroed once the refund is consumed.
//
// Requires DATABASE_URL. Run: npm run test:integration

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let acct, task, ctx;

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  task = require('../../dist/services/task/index.js');
});

after(async () => {
  await ctx.teardown();
});

const total = async (id) => {
  const a = await acct.getAccountById(id);
  return a.earned_balance + a.gift_balance;
};

const escrowOf = async (taskId) => {
  const r = await ctx.adminPool.query(
    `SELECT escrow_gift, escrow_earned FROM ${ctx.schema}.tasks WHERE id = $1`,
    [taskId]
  );
  return r.rows[0];
};

test('reject_refund then deadline sweep refunds escrow exactly ONCE (no minting)', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'dsp-pub' });
  const ag = await acct.createAccount({ type: 'agent', name: 'dsp-ag', computeSource: 'local_model' });
  const start = await total(pub.id);

  // Deadline already in the past so the reclaim sweep will consider this task.
  const past = new Date(Date.now() - 60_000).toISOString();
  const t = await task.createTask({
    publisherId: pub.id, title: 'double-spend', description: 'reject then sweep',
    rewardCredits: 200, maxExecutors: 1, deadline: past, verification: { mode: 'manual' },
  });
  assert.equal(await total(pub.id), start - 200, 'escrow debited once on publish');

  const e = await task.claimTask(t.id, ag.id);
  await task.submitResult({ taskId: t.id, executorId: ag.id, result: 'bad' });
  // Reject with no other executor in flight → reject_refund (refund #1).
  await task.verifyResult({ taskId: t.id, executionId: e.id, publisherId: pub.id, accepted: false });

  assert.equal(await total(pub.id), start, 'publisher made whole by the single refund');

  // The bug: this sweep finds the (formerly reopened) expired task with live
  // escrow and refunds a SECOND time, minting 200 credits from nothing.
  await task.reclaimExpiredTasks(new Date());

  assert.equal(
    await total(pub.id),
    start,
    'NO double refund: balance stays at the single-refund amount'
  );

  const esc = await escrowOf(t.id);
  assert.equal(Number(esc.escrow_gift), 0, 'escrow_gift zeroed once refund consumed');
  assert.equal(Number(esc.escrow_earned), 0, 'escrow_earned zeroed once refund consumed');
});

test('rejected escrow cannot later be paid out as a reward (no pay-after-refund)', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'dsp-pub2' });
  const ag = await acct.createAccount({ type: 'agent', name: 'dsp-ag2', computeSource: 'local_model' });
  const start = await total(pub.id);

  const t = await task.createTask({
    publisherId: pub.id, title: 'no-pay-after-refund', description: 'reject, then try accept',
    rewardCredits: 120, maxExecutors: 1, verification: { mode: 'manual' },
  });
  const e = await task.claimTask(t.id, ag.id);
  await task.submitResult({ taskId: t.id, executorId: ag.id, result: 'bad' });
  await task.verifyResult({ taskId: t.id, executionId: e.id, publisherId: pub.id, accepted: false });
  assert.equal(await total(pub.id), start, 'refunded once');

  // The execution is terminal (rejected); accepting it again must not pay from
  // already-refunded escrow. finalizeExecution guards on status='submitted'.
  await assert.rejects(
    () => task.verifyResult({ taskId: t.id, executionId: e.id, publisherId: pub.id, accepted: true, score: 9 }),
    /not submitted/,
    'rejected execution cannot be re-accepted'
  );
  assert.equal(await total(ag.id), 1000, 'executor not paid from refunded escrow');
});
