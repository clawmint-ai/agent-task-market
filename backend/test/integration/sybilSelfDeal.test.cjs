// Integration test for self-dealing detection + pay-then-freeze (CLAWMIN-23).
// Drives a real settlement with the open-core LocalRiskEngine active:
//   - same-IP publisher→executor: accepted reward is PAID then FROZEN (pending review),
//     a risk_flags row is opened, and per-class conservation still holds.
//   - different-IP: reward settles normally into spendable earned.
//   - admin release: frozen credits return to spendable earned, flag → released.
// Requires DATABASE_URL. Run: npm run test:integration
// (sandbox without a DB: the pure heuristics are covered by test/unit/sybil.test.ts)

const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Must be set BEFORE requiring dist/risk (getRiskEngine reads it once, memoized).
process.env.RISK_ENGINE_MODE = 'local';
delete process.env.RISK_ENGINE_URL; // ensure local engine wins precedence
const { setupSchema } = require('../helpers/db.cjs');

let acct, ak, task, reconcileSvc, riskFlags, risk, ctx;

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  ak = require('../../dist/services/agentKeyService.js');
  task = require('../../dist/services/task/index.js');
  reconcileSvc = require('../../dist/services/reconcileService.js');
  riskFlags = require('../../dist/services/riskFlagService.js');
  risk = require('../../dist/risk/index.js');
  risk.resetRiskEngine();
  assert.equal(risk.getRiskEngine().constructor.name, 'LocalRiskEngine', 'local engine active');
});

after(async () => {
  await ctx.teardown();
});

// Run a task to acceptance: publisher publishes (reward under new-account cap),
// executor claims+submits, publisher accepts. Returns { taskId, executionId, executorId }.
async function runToAccept({ publisherIp, executorIp, reward = 40 }) {
  const pub = await acct.createAccount({ type: 'agent', name: 'pub', computeSource: 'local_model', signupIp: publisherIp });
  const exe = await acct.createAccount({ type: 'agent', name: 'exe', computeSource: 'local_model', signupIp: executorIp });
  // Executor identity is an AGENT KEY owned by `exe`. Risk correlation uses the
  // key's OWNER account (exe, which carries executorIp), so self-dealing
  // detection by account+IP still works.
  const exeKey = await ak.issueAgentKey({ ownerAccountId: exe.id, name: 'exe-key', computeSource: 'local_model' });
  const t = await task.createTask({ publisherId: pub.id, title: 'job', description: 'do it', rewardCredits: reward });
  const ex = await task.claimTask(t.id, exeKey.id);
  await task.submitResult({ taskId: t.id, executorId: exeKey.id, result: 'done' });
  await task.finalizeExecution({
    taskId: t.id,
    executionId: ex.id,
    accepted: true,
    verifiedBy: 'manual',
    verificationDetail: {},
  });
  return { taskId: t.id, executionId: ex.id, executorId: exe.id, reward };
}

test('same-IP self-deal: reward is paid then FROZEN, flag opened, conservation holds', async () => {
  const { executorId, reward } = await runToAccept({ publisherIp: '9.9.9.9', executorIp: '9.9.9.9' });

  const a = await acct.getAccountById(executorId);
  assert.equal(a.earned_balance, 0, 'reward is NOT spendable');
  assert.equal(a.frozen_earned_balance, reward, 'reward held in frozen_earned');

  const flags = await riskFlags.listRiskFlags('open');
  const mine = flags.filter((f) => f.account_id === executorId);
  assert.equal(mine.length, 1, 'one open risk flag for the executor');
  assert.equal(mine[0].kind, 'self_dealing_suspected');
  assert.equal(mine[0].amount, reward, 'flag records the frozen amount');

  const rep = await reconcileSvc.reconcile(new Date().toISOString());
  assert.equal(rep.ok, true, 'per-class conservation holds (freeze is delta=0 within earned)');
});

test('different-IP: reward settles normally into spendable earned, no flag', async () => {
  const { executorId, reward } = await runToAccept({ publisherIp: '1.1.1.1', executorIp: '2.2.2.2' });

  const a = await acct.getAccountById(executorId);
  assert.equal(a.earned_balance, reward, 'reward is spendable');
  assert.equal(a.frozen_earned_balance, 0, 'nothing frozen');

  const flags = await riskFlags.listRiskFlags('open');
  assert.equal(flags.filter((f) => f.account_id === executorId).length, 0, 'no flag raised');
});

test('admin release: frozen reward returns to spendable earned and flag → released', async () => {
  const { executorId, reward } = await runToAccept({ publisherIp: '7.7.7.7', executorIp: '7.7.7.7' });
  const open = (await riskFlags.listRiskFlags('open')).filter((f) => f.account_id === executorId);
  assert.equal(open.length, 1);

  await riskFlags.releaseRiskFlag(open[0].id, 'tester');

  const a = await acct.getAccountById(executorId);
  assert.equal(a.earned_balance, reward, 'released back to spendable');
  assert.equal(a.frozen_earned_balance, 0, 'no longer frozen');

  const stillOpen = (await riskFlags.listRiskFlags('open')).filter((f) => f.account_id === executorId);
  assert.equal(stillOpen.length, 0, 'flag no longer open');

  const rep = await reconcileSvc.reconcile(new Date().toISOString());
  assert.equal(rep.ok, true, 'conserved after release');

  // Idempotency: releasing again must fail (no open flag), not double-credit.
  await assert.rejects(() => riskFlags.releaseRiskFlag(open[0].id, 'tester'), /not found or not open/);
});

test('new-account publish cap: a brand-new account cannot publish over the cap', async () => {
  const pub = await acct.createAccount({ type: 'agent', name: 'big', computeSource: 'local_model', signupIp: '3.3.3.3' });
  await assert.rejects(
    () => task.createTask({ publisherId: pub.id, title: 'huge', description: 'x', rewardCredits: 999 }),
    /at most 50/
  );
});
