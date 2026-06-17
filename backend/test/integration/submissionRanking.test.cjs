// Integration tests for Tier 1 submission-display priority (CLAWMIN-37, 承接 20 §4).
// Verifies getTaskSubmissions ranks compliant local-model (Tier 1) executors
// first without ignoring reputation, and that fetch_tasks (listTasks) paging /
// filtering is unaffected. Requires DATABASE_URL → real Postgres.
// Run: npm run test:integration

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let acct, task, queries, ctx;

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  task = require('../../dist/services/task/index.js');
  queries = require('../../dist/services/task/queries.js');
});

after(async () => {
  await ctx.teardown();
});

// Directly set an account's reputation (no public setter; reputation accrues via
// settlement). Scoped to the test schema the harness created.
const setRep = (id, score) =>
  ctx.adminPool.query(`UPDATE ${ctx.schema}.accounts SET reputation_score = $1 WHERE id = $2`, [score, id]);

// Publish a task open to N executors, have each submit, return the task id.
async function taskWithSubmissions(pub, executors) {
  const t = await task.createTask({
    publisherId: pub.id, title: 'rank-me', description: 'compete',
    rewardCredits: 50, maxExecutors: executors.length, verification: { mode: 'manual' },
  });
  for (const e of executors) {
    await task.claimTask(t.id, e.id);
    await task.submitResult({ taskId: t.id, executorId: e.id, result: `r-${e.id}` });
  }
  return t.id;
}

test('equal reputation: Tier 1 (local_model) submission ranks above Tier 2/3', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'rankpub1' });
  const t3 = await acct.createAccount({ type: 'agent', name: 't3', computeSource: 'platform_credit' });
  const t1 = await acct.createAccount({ type: 'agent', name: 't1', computeSource: 'local_model' });
  const t2 = await acct.createAccount({ type: 'agent', name: 't2', computeSource: 'payg_api_key' });
  // All default reputation 5.0 — pure tier ordering. Submit in t3,t1,t2 order so
  // a naive submitted_at sort would NOT produce the tier order.
  const taskId = await taskWithSubmissions(pub, [t3, t1, t2]);

  const subs = await queries.getTaskSubmissions(taskId, pub.id);
  assert.deepStrictEqual(
    subs.map((s) => s.executor_name),
    ['t1', 't2', 't3'],
    'order is Tier1 → Tier2 → Tier3 at equal reputation'
  );
  assert.deepStrictEqual(subs.map((s) => s.executor_compute_tier), [1, 2, 3], 'tier exposed in response');
});

test('reputation not ignored: high-rep Tier 2 outranks fresh Tier 1', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'rankpub2' });
  const freshT1 = await acct.createAccount({ type: 'agent', name: 'freshT1', computeSource: 'local_model' });
  const highT2 = await acct.createAccount({ type: 'agent', name: 'highT2', computeSource: 'payg_api_key' });
  await setRep(freshT1.id, 5); // 5 + 2.0 = 7.0
  await setRep(highT2.id, 10); // 10 + 0.5 = 10.5

  const taskId = await taskWithSubmissions(pub, [freshT1, highT2]);
  const subs = await queries.getTaskSubmissions(taskId, pub.id);
  assert.deepStrictEqual(
    subs.map((s) => s.executor_name),
    ['highT2', 'freshT1'],
    'a meaningfully higher reputation beats the Tier 1 bonus'
  );
});

test('within-tier ties broken by earliest submission (FIFO preserved)', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'rankpub3' });
  const a = await acct.createAccount({ type: 'agent', name: 'early', computeSource: 'local_model' });
  const b = await acct.createAccount({ type: 'agent', name: 'late', computeSource: 'local_model' });
  // Same tier + same default reputation → tie. 'early' submits first.
  const taskId = await taskWithSubmissions(pub, [a, b]);
  const subs = await queries.getTaskSubmissions(taskId, pub.id);
  assert.deepStrictEqual(subs.map((s) => s.executor_name), ['early', 'late'], 'earliest submission first on a tie');
});

test('fetch_tasks (listTasks) paging + type filter unaffected by ranking change', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'listpub' });
  for (let i = 0; i < 3; i++) {
    await task.createTask({
      publisherId: pub.id, title: `code-${i}`, description: 'x', type: 'code',
      rewardCredits: 10, maxExecutors: 1, verification: { mode: 'manual' },
    });
  }
  await task.createTask({
    publisherId: pub.id, title: 'research-0', description: 'x', type: 'research',
    rewardCredits: 10, maxExecutors: 1, verification: { mode: 'manual' },
  });

  const codeOnly = await task.listTasks({ type: 'code', limit: 20, offset: 0 });
  assert.ok(codeOnly.tasks.every((t) => t.type === 'code'), 'type filter still applies');
  assert.ok(codeOnly.tasks.length >= 3, 'all code tasks returned');

  const page1 = await task.listTasks({ limit: 2, offset: 0 });
  assert.equal(page1.tasks.length, 2, 'limit honored');
  const page2 = await task.listTasks({ limit: 2, offset: 2 });
  const ids1 = new Set(page1.tasks.map((t) => t.id));
  assert.ok(page2.tasks.every((t) => !ids1.has(t.id)), 'offset paging returns distinct rows');
});
