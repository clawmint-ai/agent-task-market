// Integration tests against a real Postgres (ledger conservation, winner-take-all,
// §1.2 claim race, §1.5 credential gate, gift/earned class). Requires DATABASE_URL.
// Run: npm run test:integration   (sandbox without a DB: use npm run test:unit)

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let acct, task, ctx;

before(async () => {
  ctx = await setupSchema();
  // Require services AFTER setupSchema points DATABASE_URL at the test schema.
  acct = require('../../dist/services/accountService.js');
  task = require('../../dist/services/task/index.js');
});

after(async () => {
  await ctx.teardown();
});

const bal = async (id) => {
  const a = await acct.getAccountById(id);
  return a.earned_balance + a.gift_balance;
};

test('winner-take-all: 3 agents race 1 task, only winner paid, credits conserved', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'pub' });
  const a1 = await acct.createAccount({ type: 'agent', name: 'a1' });
  const a2 = await acct.createAccount({ type: 'agent', name: 'a2' });
  const a3 = await acct.createAccount({ type: 'agent', name: 'a3' });
  const start = (await bal(pub.id)) + (await bal(a1.id)) + (await bal(a2.id)) + (await bal(a3.id));

  const t = await task.createTask({
    publisherId: pub.id, title: 'race', description: 'first wins',
    rewardCredits: 300, maxExecutors: 3, verification: { mode: 'manual' },
  });
  assert.equal(await bal(pub.id), 700, 'publisher escrowed 300');

  const e1 = await task.claimTask(t.id, a1.id);
  const e2 = await task.claimTask(t.id, a2.id);
  const e3 = await task.claimTask(t.id, a3.id);
  await task.submitResult({ taskId: t.id, executorId: a1.id, result: 'r1' });
  await task.submitResult({ taskId: t.id, executorId: a2.id, result: 'r2' });
  await task.submitResult({ taskId: t.id, executorId: a3.id, result: 'r3' });

  await task.verifyResult({ taskId: t.id, executionId: e1.id, publisherId: pub.id, accepted: true, score: 9 });
  assert.equal(await bal(a1.id), 1300, 'winner paid once');

  for (const e of [e2, e3]) {
    await assert.rejects(
      () => task.verifyResult({ taskId: t.id, executionId: e.id, publisherId: pub.id, accepted: true, score: 9 }),
      /not submitted/
    );
  }
  assert.equal(await bal(a2.id), 1000, 'a2 not paid');
  assert.equal(await bal(a3.id), 1000, 'a3 not paid');

  const end = (await bal(pub.id)) + (await bal(a1.id)) + (await bal(a2.id)) + (await bal(a3.id));
  assert.equal(end, start, 'total credits conserved (no inflation)');
});

test('ledger invariant: sum(delta) == sum(balances)', async () => {
  const ledger = await ctx.adminPool.query(`SELECT COALESCE(SUM(delta),0)::int AS c FROM ${ctx.schema}.credit_ledger`);
  const bals = await ctx.adminPool.query(
    `SELECT COALESCE(SUM(earned_balance + gift_balance),0)::int AS c FROM ${ctx.schema}.accounts`
  );
  assert.equal(ledger.rows[0].c, bals.rows[0].c, 'ledger sum equals balance sum');
});

test('claim race (§1.2): concurrent claims on max_executors=1 admit exactly one', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'pub2' });
  const agents = [];
  for (let i = 0; i < 8; i++) agents.push(await acct.createAccount({ type: 'agent', name: 'r' + i }));
  const t = await task.createTask({
    publisherId: pub.id, title: 'single-slot', description: 'one winner',
    rewardCredits: 50, maxExecutors: 1, verification: { mode: 'manual' },
  });

  const results = await Promise.allSettled(agents.map((a) => task.claimTask(t.id, a.id)));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  assert.equal(ok, 1, 'exactly one claim succeeds under concurrency');
});

test('credential gate (§1.5): agent registration requires compute_source + attestation', async () => {
  const { buildApp } = require('../../dist/index.js');
  const app = await buildApp({ logger: false });

  const reg = (payload) => app.inject({ method: 'POST', url: '/api/v1/accounts/register', payload });

  const r1 = await reg({ type: 'agent', name: 'no-source' });
  assert.equal(r1.statusCode, 400, 'agent without compute_source rejected');

  const r2 = await reg({ type: 'agent', name: 'no-attest', compute_source: 'local_model' });
  assert.equal(r2.statusCode, 400, 'agent without attestation rejected');

  const r3 = await reg({ type: 'agent', name: 'ok', compute_source: 'local_model', compute_attestation: true });
  assert.equal(r3.statusCode, 201, 'compliant agent accepted');
  assert.equal(JSON.parse(r3.body).compute_source, 'local_model');

  const r4 = await reg({ type: 'human', name: 'publisher' });
  assert.equal(r4.statusCode, 201, 'human accepted without compute_source');

  await app.close();
});

test('gift credits are non-redeemable but spendable on publishing; refund preserves class', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'giftpub' });
  const a1 = await acct.createAccount({ type: 'agent', name: 'gw' });
  const before = await acct.getAccountById(pub.id);
  assert.equal(before.gift_balance, 1000, 'signup bonus is gift');
  assert.equal(before.earned_balance, 0, 'no earned at signup');

  const t = await task.createTask({
    publisherId: pub.id, title: 'gift-funded', description: 'reject me',
    rewardCredits: 200, maxExecutors: 1, verification: { mode: 'manual' },
  });
  const afterPublish = await acct.getAccountById(pub.id);
  assert.equal(afterPublish.gift_balance, 800, 'escrow spent from gift');

  const e = await task.claimTask(t.id, a1.id);
  await task.submitResult({ taskId: t.id, executorId: a1.id, result: 'bad' });
  await task.verifyResult({ taskId: t.id, executionId: e.id, publisherId: pub.id, accepted: false });

  const afterRefund = await acct.getAccountById(pub.id);
  assert.equal(afterRefund.gift_balance, 1000, 'refund restored to GIFT, not earned');
  assert.equal(afterRefund.earned_balance, 0, 'gift was not laundered into earned');
});

test('SSE notifier (§3.2): publishing a task fires a task.new event to subscribers', async () => {
  const { getNotifier } = require('../../dist/runtime/notifier.js');
  const pub = await acct.createAccount({ type: 'human', name: 'ssepub' });

  const events = [];
  const off = getNotifier().subscribe('listener-agent', (e) => events.push(e));

  await task.createTask({
    publisherId: pub.id, title: 'sse-trigger', description: 'fires an event',
    rewardCredits: 20, maxExecutors: 1, type: 'code', verification: { mode: 'manual' },
  });

  off();
  const hit = events.find((e) => e.type === 'task.new' && e.task.title === 'sse-trigger');
  assert.ok(hit, 'a task.new event was delivered for the published task');
  assert.equal(hit.task.type, 'code');
  assert.equal(getNotifier().subscriberCount(), 0, 'unsubscribe cleaned up');
});

test('reconcile: ledger conserves after activity, ok=true', async () => {
  const { reconcile } = require('../../dist/services/reconcileService.js');
  const report = await reconcile(new Date().toISOString());
  assert.equal(report.ok, true, 'ledger balanced across all classes');
  assert.equal(report.total.diff, 0, 'total diff is zero');
  assert.equal(report.earned.diff, 0, 'earned diff is zero');
  assert.equal(report.gift.diff, 0, 'gift diff is zero');
});

test('deadline reclaim (§3.7): expired unclaimed task refunds escrow + fails', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'dlpub' });
  const before = (await acct.getAccountById(pub.id)).gift_balance;

  // Publish with a deadline already in the past.
  const past = new Date(Date.now() - 60_000).toISOString();
  const t = await task.createTask({
    publisherId: pub.id, title: 'expired', description: 'nobody claims',
    rewardCredits: 150, maxExecutors: 1, deadline: past, verification: { mode: 'manual' },
  });
  assert.equal((await acct.getAccountById(pub.id)).gift_balance, before - 150, 'escrowed');

  const res = await task.reclaimExpiredTasks(new Date());
  assert.ok(res.reclaimed >= 1, 'at least one task reclaimed');

  const after = await acct.getAccountById(pub.id);
  assert.equal(after.gift_balance, before, 'escrow refunded to gift on reclaim');
  const reclaimed = await task.getTaskById(t.id);
  assert.equal(reclaimed.status, 'failed', 'expired task marked failed');
});

test('deadline reclaim: does NOT touch a task with an active executor', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'dlpub2' });
  const ag = await acct.createAccount({ type: 'agent', name: 'dlagent' });
  const past = new Date(Date.now() - 60_000).toISOString();
  const t = await task.createTask({
    publisherId: pub.id, title: 'expired-but-claimed', description: 'in flight',
    rewardCredits: 100, maxExecutors: 1, deadline: past, verification: { mode: 'manual' },
  });
  await task.claimTask(t.id, ag.id); // active execution exists

  await task.reclaimExpiredTasks(new Date());
  const still = await task.getTaskById(t.id);
  assert.notEqual(still.status, 'failed', 'task with active executor is not reclaimed');
});
