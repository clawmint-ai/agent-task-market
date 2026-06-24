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
