// Milestone 1 Test Gate coverage for the verification-read (B4) and
// execution-detail (B5) authorization boundaries, plus the claimability gate.
// The happy paths live in productReframeReadApis.test.cjs; this file fills the
// boundary cases the gate calls out: unknown-task 404, after-claim vs publisher
// visibility, owning-agent-key access, unrelated-principal 403, and the three
// claimability outcomes (unspecified compute, low reputation, eligible).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let app, ctx;

const auth = (key) => ({ authorization: `Bearer ${key}` });

before(async () => {
  ctx = await setupSchema();
  const { buildApp } = require('../../dist/index.js');
  app = await buildApp({ logger: false });
});

after(async () => {
  await app.close();
  await ctx.teardown();
});

async function registerOwner(name) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts/register',
    payload: { type: 'human', name },
  });
  assert.equal(res.statusCode, 201, 'owner registered');
  return JSON.parse(res.body);
}

async function issueAgentKey(ownerKey, name, computeSource) {
  const payload = { name };
  if (computeSource !== undefined) payload.compute_source = computeSource;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts/me/agent-keys',
    headers: auth(ownerKey),
    payload,
  });
  assert.equal(res.statusCode, 201, 'agent key issued');
  return JSON.parse(res.body);
}

async function publishTask(ownerKey, overrides = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers: auth(ownerKey),
    payload: {
      title: 'boundary task',
      description: 'do the work',
      type: 'general',
      reward_credits: 20,
      requirements: { expected_artifact: 'plain_text' },
      verification: { mode: 'manual' },
      ...overrides,
    },
  });
  assert.equal(res.statusCode, 201, 'task published');
  return JSON.parse(res.body);
}

// ---- B4: verification read ------------------------------------------------

test('GET /tasks/:id/verification returns 404 for an unknown task', async () => {
  const owner = await registerOwner('verif-404-owner');
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/tasks/00000000-0000-0000-0000-000000000000/verification',
    headers: auth(owner.api_key),
  });
  assert.equal(res.statusCode, 404);
});

test('GET /tasks/:id/verification redacts regex value pre-claim but reveals it after claim', async () => {
  const owner = await registerOwner('verif-claim-owner');
  const agentOwner = await registerOwner('verif-claim-agent-owner');
  const key = await issueAgentKey(agentOwner.api_key, 'verif-agent', 'local_model');
  const task = await publishTask(owner.api_key, {
    title: 'regex gated task',
    verification: { mode: 'auto_rules', rules: [{ type: 'regex', value: '^secret:' }] },
  });

  // Pre-claim: a different agent (no claim) sees the regex value redacted.
  const preClaim = await app.inject({
    method: 'GET',
    url: `/api/v1/tasks/${task.id}/verification`,
    headers: auth(key.api_key),
  });
  assert.equal(preClaim.statusCode, 200);
  const preBody = JSON.parse(preClaim.body);
  assert.equal(preBody.verification_package.rules[0].value_redacted, true);
  assert.equal(preBody.verification_package.rules[0].value, undefined, 'regex value hidden pre-claim');
  assert.ok(preBody.verification_package.redacted_fields.includes('rules.value'));

  // Claim, then the owning agent key sees the full acceptance criteria.
  const claimRes = await app.inject({
    method: 'POST',
    url: `/api/v1/tasks/${task.id}/claim`,
    headers: auth(key.api_key),
  });
  assert.equal(claimRes.statusCode, 201, 'task claimed');

  const afterClaim = await app.inject({
    method: 'GET',
    url: `/api/v1/tasks/${task.id}/verification`,
    headers: auth(key.api_key),
  });
  assert.equal(afterClaim.statusCode, 200);
  const afterBody = JSON.parse(afterClaim.body);
  assert.equal(afterBody.verification_package.rules[0].value, '^secret:', 'regex value visible after claim');
  assert.deepEqual(afterBody.verification_package.redacted_fields, []);
});

test('GET /tasks/:id/verification gives the publisher full detail', async () => {
  const owner = await registerOwner('verif-publisher-owner');
  const task = await publishTask(owner.api_key, {
    title: 'publisher view task',
    verification: { mode: 'auto_rules', rules: [{ type: 'regex', value: '^token:' }] },
  });
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tasks/${task.id}/verification`,
    headers: auth(owner.api_key),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.verification_package.rules[0].value, '^token:', 'publisher sees raw value');
  assert.deepEqual(body.verification_package.redacted_fields, []);
});

// ---- B5: execution detail authorization -----------------------------------

test('GET /executions/:id returns 404 for an unknown execution', async () => {
  const owner = await registerOwner('exec-404-owner');
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/executions/00000000-0000-0000-0000-000000000000',
    headers: auth(owner.api_key),
  });
  assert.equal(res.statusCode, 404);
});

test('GET /executions/:id lets the owning agent key read its own execution', async () => {
  const owner = await registerOwner('exec-agent-read-owner');
  const agentOwner = await registerOwner('exec-agent-read-agent-owner');
  const key = await issueAgentKey(agentOwner.api_key, 'exec-agent', 'local_model');
  const task = await publishTask(owner.api_key);
  const claimRes = await app.inject({
    method: 'POST',
    url: `/api/v1/tasks/${task.id}/claim`,
    headers: auth(key.api_key),
  });
  assert.equal(claimRes.statusCode, 201, 'task claimed');
  const execution = JSON.parse(claimRes.body);

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/executions/${execution.id}`,
    headers: auth(key.api_key),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.execution.id, execution.id);
  assert.equal(body.execution.agent_key_id, key.id);
});

test('GET /executions/:id rejects an unrelated principal with 403', async () => {
  const owner = await registerOwner('exec-unrelated-owner');
  const agentOwner = await registerOwner('exec-unrelated-agent-owner');
  const key = await issueAgentKey(agentOwner.api_key, 'exec-unrelated-agent', 'local_model');
  const task = await publishTask(owner.api_key);
  const claimRes = await app.inject({
    method: 'POST',
    url: `/api/v1/tasks/${task.id}/claim`,
    headers: auth(key.api_key),
  });
  assert.equal(claimRes.statusCode, 201, 'task claimed');
  const execution = JSON.parse(claimRes.body);

  // An owner who neither published the task nor owns the agent key.
  const stranger = await registerOwner('exec-stranger-owner');
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/executions/${execution.id}`,
    headers: auth(stranger.api_key),
  });
  assert.equal(res.statusCode, 403);
});

// ---- Claimability gate (server-derived) -----------------------------------

test('claimability blocks an unspecified-compute agent key', async () => {
  const owner = await registerOwner('claim-compute-owner');
  const agentOwner = await registerOwner('claim-compute-agent-owner');
  // No compute_source → defaults to 'unspecified'.
  const key = await issueAgentKey(agentOwner.api_key, 'no-compute-agent');
  const task = await publishTask(owner.api_key);

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tasks/${task.id}`,
    headers: auth(key.api_key),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.claimability.can_claim, false);
  assert.ok(body.claimability.missing_requirements.includes('compute_source'));
});

test('claimability blocks an agent key below the task min_reputation', async () => {
  const owner = await registerOwner('claim-rep-owner');
  const agentOwner = await registerOwner('claim-rep-agent-owner');
  const key = await issueAgentKey(agentOwner.api_key, 'low-rep-agent', 'local_model');
  // Default agent-key reputation is 5.0; gate the task above that.
  const task = await publishTask(owner.api_key, { min_reputation: 8 });

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tasks/${task.id}`,
    headers: auth(key.api_key),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.claimability.can_claim, false);
  assert.ok(body.claimability.missing_requirements.includes('min_reputation'));
});

test('claimability allows an eligible agent key', async () => {
  const owner = await registerOwner('claim-ok-owner');
  const agentOwner = await registerOwner('claim-ok-agent-owner');
  const key = await issueAgentKey(agentOwner.api_key, 'eligible-agent', 'local_model');
  const task = await publishTask(owner.api_key, { min_reputation: 0 });

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tasks/${task.id}`,
    headers: auth(key.api_key),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(body.claimability, {
    can_claim: true,
    principal_kind: 'agent',
    reasons: [],
    missing_requirements: [],
  });
});
