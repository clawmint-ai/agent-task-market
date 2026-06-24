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
  if (app) await app.close();
  if (ctx) await ctx.teardown();
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

async function issueAgentKey(ownerKey, name) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts/me/agent-keys',
    headers: auth(ownerKey),
    payload: { name, compute_source: 'local_model' },
  });
  assert.equal(res.statusCode, 201, 'agent key issued');
  return JSON.parse(res.body);
}

test('GET /market/overview returns owner console counts without agent online claims', async () => {
  const owner = await registerOwner('overview-owner');
  await issueAgentKey(owner.api_key, 'active-key');

  const taskRes = await app.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers: auth(owner.api_key),
    payload: {
      title: 'overview task',
      description: 'needs review',
      type: 'general',
      reward_credits: 25,
      verification: { mode: 'manual' },
    },
  });
  assert.equal(taskRes.statusCode, 201, 'task published');

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/market/overview',
    headers: auth(owner.api_key),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(body.principal, {
    kind: 'owner',
    account_id: owner.id,
    agent_key_id: null,
  });
  assert.equal(body.counts.work_packages_open, 1);
  assert.equal(body.counts.executions_in_progress, 0);
  assert.equal(body.counts.submissions_awaiting_review, 0);
  assert.equal(body.counts.risk_holds_open, 0);
  assert.equal(body.wallet.gift, 975);
  assert.equal(body.wallet.earned, 0);
  assert.equal(body.wallet.frozen_earned, 0);
  assert.equal(body.wallet.spendable, 975);
  assert.equal(body.agent_identities.issued, 1);
  assert.equal(body.agent_identities.active_credentials, 1);
  assert.equal(body.agent_identities.revoked, 0);
  assert.equal(Object.hasOwn(body.agent_identities, 'online'), false);
  assert.equal(Object.hasOwn(body.agent_identities, 'offline'), false);
});

test('GET /market/overview is owner-console only', async () => {
  const owner = await registerOwner('overview-agent-owner');
  const key = await issueAgentKey(owner.api_key, 'agent-principal');

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/market/overview',
    headers: auth(key.api_key),
  });

  assert.equal(res.statusCode, 403);
});

test('GET /accounts/me/ledger returns paged ledger rows and split balances', async () => {
  const owner = await registerOwner('ledger-owner');
  const taskRes = await app.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers: auth(owner.api_key),
    payload: {
      title: 'ledger task',
      description: 'escrow row',
      type: 'general',
      reward_credits: 40,
      verification: { mode: 'manual' },
    },
  });
  assert.equal(taskRes.statusCode, 201, 'task published');

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/accounts/me/ledger?limit=10&offset=0',
    headers: auth(owner.api_key),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(body.balance, {
    earned: 0,
    gift: 960,
    frozen_earned: 0,
    spendable: 960,
  });
  assert.ok(body.rows.length >= 2, 'signup and escrow rows are returned');
  assert.equal(body.rows[0].account_id, owner.id);
  assert.equal(typeof body.rows[0].delta, 'number');
  assert.equal(typeof body.rows[0].balance_after, 'number');
  assert.ok(['earned', 'gift'].includes(body.rows[0].credit_class));
  assert.equal(body.pagination.limit, 10);
  assert.equal(body.pagination.offset, 0);
});

test('GET /tasks includes verification summary and server-derived owner claimability', async () => {
  const owner = await registerOwner('task-summary-owner');
  const taskRes = await app.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers: auth(owner.api_key),
    payload: {
      title: 'summary task',
      description: 'return markdown',
      type: 'content',
      reward_credits: 30,
      requirements: { expected_artifact: 'markdown' },
      verification: { mode: 'auto_rules', rules: [{ type: 'contains', value: '# ' }] },
    },
  });
  assert.equal(taskRes.statusCode, 201, 'task published');

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/tasks?status=open',
    headers: auth(owner.api_key),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  const task = body.tasks.find((t) => t.title === 'summary task');
  assert.ok(task, 'new task returned');
  assert.deepEqual(task.verification_summary, {
    mode: 'auto_rules',
    summary: 'auto_rules verification for markdown deliverable',
    expected_artifact: 'markdown',
    fallback_policy: 'manual_review_on_fallback',
  });
  assert.deepEqual(task.claimability, {
    can_claim: false,
    principal_kind: 'owner',
    reasons: ['owner_credentials_cannot_claim_work'],
    missing_requirements: [],
  });
});

test('GET /tasks/:id/verification redacts pre-claim verifier internals', async () => {
  const owner = await registerOwner('verification-owner');
  const taskRes = await app.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers: auth(owner.api_key),
    payload: {
      title: 'regex task',
      description: 'return matching output',
      type: 'general',
      reward_credits: 20,
      requirements: { expected_artifact: 'plain_text' },
      verification: { mode: 'auto_rules', rules: [{ type: 'regex', value: '^secret:' }] },
    },
  });
  assert.equal(taskRes.statusCode, 201, 'task published');
  const task = JSON.parse(taskRes.body);

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tasks/${task.id}/verification`,
    headers: auth(owner.api_key),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.verification_package.mode, 'auto_rules');
  assert.equal(body.verification_package.expected_artifact, 'plain_text');
  assert.equal(body.verification_package.rules[0].value, '^secret:');
  assert.deepEqual(body.verification_package.redacted_fields, []);
});

test('GET /executions/:id returns derived verification and settlement summaries', async () => {
  const owner = await registerOwner('execution-owner');
  const agentOwner = await registerOwner('execution-agent-owner');
  const key = await issueAgentKey(agentOwner.api_key, 'execution-agent');
  const taskRes = await app.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers: auth(owner.api_key),
    payload: {
      title: 'execution detail task',
      description: 'submit result',
      type: 'general',
      reward_credits: 20,
      requirements: { expected_artifact: 'plain_text' },
      verification: { mode: 'manual' },
    },
  });
  assert.equal(taskRes.statusCode, 201, 'task published');
  const task = JSON.parse(taskRes.body);
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
    headers: auth(owner.api_key),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.execution.id, execution.id);
  assert.equal(body.execution.agent_key_id, key.id);
  assert.equal(body.work_package.id, task.id);
  assert.equal(body.verification_summary.mode, 'manual');
  assert.equal(body.settlement_summary.status, 'not_settled');
  assert.equal(body.settlement_summary.source, 'derived_from_current_execution_and_ledger');
});
