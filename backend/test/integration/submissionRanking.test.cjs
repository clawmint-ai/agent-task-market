// Integration tests for Tier 1 submission-display priority (CLAWMIN-37, 承接 20 §4).
// Verifies getTaskSubmissions ranks compliant local-model (Tier 1) executors
// first without ignoring reputation, and that fetch_tasks (listTasks) paging /
// filtering is unaffected. Requires DATABASE_URL → real Postgres.
// Run: npm run test:integration

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let acct, task, queries, ak, ctx;

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  task = require('../../dist/services/task/index.js');
  queries = require('../../dist/services/task/queries.js');
  ak = require('../../dist/services/agentKeyService.js');
});

after(async () => {
  await ctx.teardown();
});

// Set reputation on an AGENT KEY (reputation now lives on agent_keys, not accounts).
const setRep = (keyId, score) =>
  ctx.adminPool.query(`UPDATE ${ctx.schema}.agent_keys SET reputation_score = $1 WHERE id = $2`, [score, keyId]);

// Publish a task open to N executors (passed as agent key objects with .id),
// have each claim then submit, return the task id.
async function taskWithSubmissions(pub, agentKeys) {
  const t = await task.createTask({
    publisherId: pub.id, title: 'rank-me', description: 'compete',
    rewardCredits: 50, maxExecutors: agentKeys.length, verification: { mode: 'manual' },
  });
  // Claim ALL first, THEN submit. The first submitResult flips task.status to
  // 'submitted', after which no further claim passes the open/claimed gate
  // (lifecycle.claimTask requires status 'open'). Mirrors the winner-take-all
  // pattern in ledger.test.cjs. Submit order is preserved, so the FIFO
  // tie-break test below still sees 'early' submit before 'late'.
  for (const k of agentKeys) await task.claimTask(t.id, k.id);
  for (const k of agentKeys) await task.submitResult({ taskId: t.id, executorId: k.id, result: `r-${k.id}` });
  return t.id;
}

test('equal reputation: Tier 1 (local_model) submission ranks above Tier 2/3', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'rankpub1' });
  const t3Acct = await acct.createAccount({ type: 'agent', name: 't3', computeSource: 'platform_credit' });
  const t1Acct = await acct.createAccount({ type: 'agent', name: 't1', computeSource: 'local_model' });
  const t2Acct = await acct.createAccount({ type: 'agent', name: 't2', computeSource: 'payg_api_key' });
  // Key names match what the assertion checks (executor_name comes from agent_keys.name).
  const t3Key = await ak.issueAgentKey({ ownerAccountId: t3Acct.id, name: 't3', computeSource: 'platform_credit' });
  const t1Key = await ak.issueAgentKey({ ownerAccountId: t1Acct.id, name: 't1', computeSource: 'local_model' });
  const t2Key = await ak.issueAgentKey({ ownerAccountId: t2Acct.id, name: 't2', computeSource: 'payg_api_key' });
  // All default reputation 5.0 — pure tier ordering. Submit in t3,t1,t2 order so
  // a naive submitted_at sort would NOT produce the tier order.
  const taskId = await taskWithSubmissions(pub, [t3Key, t1Key, t2Key]);

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
  const freshT1Acct = await acct.createAccount({ type: 'agent', name: 'freshT1', computeSource: 'local_model' });
  const highT2Acct = await acct.createAccount({ type: 'agent', name: 'highT2', computeSource: 'payg_api_key' });
  const freshT1Key = await ak.issueAgentKey({ ownerAccountId: freshT1Acct.id, name: 'freshT1', computeSource: 'local_model' });
  const highT2Key = await ak.issueAgentKey({ ownerAccountId: highT2Acct.id, name: 'highT2', computeSource: 'payg_api_key' });
  await setRep(freshT1Key.id, 5); // 5 + 2.0 = 7.0
  await setRep(highT2Key.id, 10); // 10 + 0.5 = 10.5

  const taskId = await taskWithSubmissions(pub, [freshT1Key, highT2Key]);
  const subs = await queries.getTaskSubmissions(taskId, pub.id);
  assert.deepStrictEqual(
    subs.map((s) => s.executor_name),
    ['highT2', 'freshT1'],
    'a meaningfully higher reputation beats the Tier 1 bonus'
  );
});

test('within-tier ties broken by earliest submission (FIFO preserved)', async () => {
  const pub = await acct.createAccount({ type: 'human', name: 'rankpub3' });
  const aAcct = await acct.createAccount({ type: 'agent', name: 'early', computeSource: 'local_model' });
  const bAcct = await acct.createAccount({ type: 'agent', name: 'late', computeSource: 'local_model' });
  const aKey = await ak.issueAgentKey({ ownerAccountId: aAcct.id, name: 'early', computeSource: 'local_model' });
  const bKey = await ak.issueAgentKey({ ownerAccountId: bAcct.id, name: 'late', computeSource: 'local_model' });
  // Same tier + same default reputation → tie. 'early' submits first.
  const taskId = await taskWithSubmissions(pub, [aKey, bKey]);
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
