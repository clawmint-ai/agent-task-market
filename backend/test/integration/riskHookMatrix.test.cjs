// CLAWMIN-11: end-to-end risk-hook fail-mode matrix. The existing
// remoteRiskEngine.test.cjs tests the CLIENT in isolation (transport/throw);
// THIS test drives the real register/publish/claim/finalize FLOWS through a
// stub risk-engine and asserts the call sites apply the right policy:
//
//   architecture-split-design.md:
//   - register / publish / claim → FAIL-OPEN  (engine down ⇒ action proceeds)
//   - onFinalize (accepted)      → FAIL-CLOSED (engine down ⇒ NO settlement)
//   - onFinalize (rejected)      → fail-open   (a rejection has no payout)
//
// A reachable engine's explicit allow:false is always honored; only a transport
// failure (5xx / timeout / unparseable body — what RemoteRiskEngine throws on)
// triggers the fail-open vs fail-closed split.
//
// Requires DATABASE_URL. Run: npm run test:integration

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { setupSchema } = require('../helpers/db.cjs');

let server, baseUrl, ctx, acct, task, risk;
// Per-hook canned behavior: { mode: 'allow'|'deny'|'500'|'hang'|'badbody' }.
let behavior = {};

function handlerFor(mode, res) {
  if (mode === '500') return void res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"down"}');
  if (mode === 'badbody') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"no_allow":true}');
  if (mode === 'hang') return; // never respond → client AbortSignal.timeout fires
  if (mode === 'deny') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"allow":false,"reason":"blocked by stub"}');
  // default allow
  res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"allow":true}');
}

before(async () => {
  server = http.createServer((req, res) => {
    const hook = req.url.replace('/', '');
    handlerFor(behavior[hook] || 'allow', res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  // Point the app's risk seam at the stub BEFORE requiring services. Short
  // timeout so the 'hang' cases don't slow the suite.
  process.env.RISK_ENGINE_URL = baseUrl;
  process.env.RISK_ENGINE_TIMEOUT_MS = '400';

  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  task = require('../../dist/services/task/index.js');
  risk = require('../../dist/risk/index.js');
  risk.resetRiskEngine(); // drop any memoized Noop; re-read RISK_ENGINE_URL
});

after(async () => {
  await ctx.teardown();
  await new Promise((r) => server.close(r));
  delete process.env.RISK_ENGINE_URL;
  delete process.env.RISK_ENGINE_TIMEOUT_MS;
  risk.resetRiskEngine();
});

beforeEach(() => {
  behavior = {}; // all hooks allow unless a test says otherwise
});

// Helpers ─────────────────────────────────────────────────────────────────
let n = 0;
const uniq = (p) => `${p}-${Date.now()}-${n++}`;
async function agent(name) {
  return acct.createAccount({ type: 'agent', name: uniq(name), computeSource: 'local_model' });
}
async function human(name) {
  return acct.createAccount({ type: 'human', name: uniq(name) });
}
const bal = async (id) => {
  const a = await acct.getAccountById(id);
  return a.earned_balance + a.gift_balance;
};

// ── onPublish: FAIL-OPEN ────────────────────────────────────────────────────
test('publish: engine deny → publish blocked (explicit allow:false honored)', async () => {
  behavior.onPublish = 'deny';
  const pub = await human('pub-deny');
  await assert.rejects(
    () => task.createTask({ publisherId: pub.id, title: uniq('t'), description: 'x', rewardCredits: 10, verification: { mode: 'manual' } }),
    /blocked by stub|risk policy/i,
    'a reachable engine deny must block publish'
  );
});

for (const mode of ['500', 'hang', 'badbody']) {
  test(`publish: engine ${mode} → FAIL-OPEN (publish proceeds)`, async () => {
    behavior.onPublish = mode;
    const pub = await human('pub-open');
    const t = await task.createTask({ publisherId: pub.id, title: uniq('t'), description: 'x', rewardCredits: 10, verification: { mode: 'manual' } });
    assert.ok(t.id, `transport failure (${mode}) must not block publish`);
  });
}

// ── onClaim: FAIL-OPEN ──────────────────────────────────────────────────────
test('claim: engine deny → claim blocked (explicit allow:false honored)', async () => {
  const pub = await human('cpub');
  const ag = await agent('cag-deny');
  const t = await task.createTask({ publisherId: pub.id, title: uniq('t'), description: 'x', rewardCredits: 10, maxExecutors: 1, verification: { mode: 'manual' } });
  behavior.onClaim = 'deny';
  await assert.rejects(() => task.claimTask(t.id, ag.id), /blocked by stub|risk policy/i, 'reachable deny must block claim');
});

for (const mode of ['500', 'hang', 'badbody']) {
  test(`claim: engine ${mode} → FAIL-OPEN (claim proceeds)`, async () => {
    const pub = await human('cpub2');
    const ag = await agent('cag-open');
    const t = await task.createTask({ publisherId: pub.id, title: uniq('t'), description: 'x', rewardCredits: 10, maxExecutors: 1, verification: { mode: 'manual' } });
    behavior.onClaim = mode;
    const ex = await task.claimTask(t.id, ag.id);
    assert.ok(ex.id, `transport failure (${mode}) must not block claim`);
  });
}

// ── onFinalize (accepted): FAIL-CLOSED ──────────────────────────────────────
test('finalize-accept: engine deny → settlement blocked, no payout', async () => {
  const pub = await human('fpub');
  const ag = await agent('fag-deny');
  const t = await task.createTask({ publisherId: pub.id, title: uniq('t'), description: 'x', rewardCredits: 50, maxExecutors: 1, verification: { mode: 'manual' } });
  const ex = await task.claimTask(t.id, ag.id);
  await task.submitResult({ taskId: t.id, executorId: ag.id, result: 'r' });
  const before = await bal(ag.id);
  behavior.onFinalize = 'deny';
  await assert.rejects(
    () => task.verifyResult({ taskId: t.id, executionId: ex.id, publisherId: pub.id, accepted: true, score: 9 }),
    /risk policy|held|blocked/i,
    'reachable deny on an accept must hold settlement'
  );
  assert.equal(await bal(ag.id), before, 'executor NOT paid when settlement is held');
});

for (const mode of ['500', 'hang', 'badbody']) {
  test(`finalize-accept: engine ${mode} → FAIL-CLOSED (settlement held, no payout)`, async () => {
    const pub = await human('fpub2');
    const ag = await agent('fag-closed');
    const t = await task.createTask({ publisherId: pub.id, title: uniq('t'), description: 'x', rewardCredits: 50, maxExecutors: 1, verification: { mode: 'manual' } });
    const ex = await task.claimTask(t.id, ag.id);
    await task.submitResult({ taskId: t.id, executorId: ag.id, result: 'r' });
    const before = await bal(ag.id);
    behavior.onFinalize = mode;
    await assert.rejects(
      () => task.verifyResult({ taskId: t.id, executionId: ex.id, publisherId: pub.id, accepted: true, score: 9 }),
      /unavailable|held|fail-closed|risk/i,
      `transport failure (${mode}) on an accept must NOT silently settle`
    );
    assert.equal(await bal(ag.id), before, `executor NOT paid on engine ${mode}`);
  });
}

// ── onFinalize (rejected): fail-open (a rejection has no payout) ─────────────
for (const mode of ['500', 'hang', 'badbody']) {
  test(`finalize-reject: engine ${mode} → fail-open (rejection proceeds, no payout anyway)`, async () => {
    const pub = await human('rpub');
    const ag = await agent('rag');
    const t = await task.createTask({ publisherId: pub.id, title: uniq('t'), description: 'x', rewardCredits: 50, maxExecutors: 1, verification: { mode: 'manual' } });
    const ex = await task.claimTask(t.id, ag.id);
    await task.submitResult({ taskId: t.id, executorId: ag.id, result: 'r' });
    behavior.onFinalize = mode;
    const res = await task.verifyResult({ taskId: t.id, executionId: ex.id, publisherId: pub.id, accepted: false, feedback: 'no' });
    assert.equal(res.status, 'rejected', `a rejection must proceed even when engine is ${mode}`);
  });
}

// ── onRegister: FAIL-OPEN ────────────────────────────────────────────────────
// register goes through the HTTP route (not a service fn), so drive it via
// app.inject. The fail-open fix lives in routes/accounts.ts (CLAWMIN-11): a
// transport failure must NOT 500/block signup — a down closed-engine can't be
// allowed to take the whole market's registration offline.
test('register: engine deny → 403 (explicit allow:false honored)', async () => {
  const { buildApp } = require('../../dist/index.js');
  const app = await buildApp({ logger: false });
  try {
    behavior.onRegister = 'deny';
    const res = await app.inject({
      method: 'POST', url: '/api/v1/accounts/register',
      payload: { type: 'agent', name: uniq('reg-deny'), compute_source: 'local_model', compute_attestation: true },
    });
    assert.equal(res.statusCode, 403, 'a reachable engine deny must block registration');
  } finally {
    await app.close();
  }
});

for (const mode of ['500', 'hang', 'badbody']) {
  test(`register: engine ${mode} → FAIL-OPEN (registration succeeds, 201)`, async () => {
    const { buildApp } = require('../../dist/index.js');
    const app = await buildApp({ logger: false });
    try {
      behavior.onRegister = mode;
      const res = await app.inject({
        method: 'POST', url: '/api/v1/accounts/register',
        payload: { type: 'agent', name: uniq('reg-open'), compute_source: 'local_model', compute_attestation: true },
      });
      assert.equal(res.statusCode, 201, `transport failure (${mode}) must NOT block registration (fail-open)`);
    } finally {
      await app.close();
    }
  });
}
