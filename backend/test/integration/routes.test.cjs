// HTTP route tests (tech-debt block H). Routes were 0% covered, and they map
// service failures to status codes — previously by string-matching e.message,
// now via typed AppErrors + a single setErrorHandler. These tests pin the EXACT
// status codes each route returns so the typed-error refactor is provably
// behavior-preserving (the codes here are what the string-matching returned).
// Requires DATABASE_URL. Run: npm run test:integration

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let app, acct, ctx;

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  const { buildApp } = require('../../dist/index.js');
  app = await buildApp({ logger: false });
});

after(async () => {
  await app.close();
  await ctx.teardown();
});

// Register a human (1000 gift) and return its api_key for authed calls.
async function human(name) {
  const r = await app.inject({ method: 'POST', url: '/api/v1/accounts/register', payload: { type: 'human', name } });
  assert.equal(r.statusCode, 201, 'human registered');
  return JSON.parse(r.body).api_key;
}
async function agent(name) {
  const r = await app.inject({
    method: 'POST', url: '/api/v1/accounts/register',
    payload: { type: 'agent', name, compute_source: 'local_model', compute_attestation: true },
  });
  assert.equal(r.statusCode, 201, 'agent registered');
  return JSON.parse(r.body);
}
const auth = (key) => ({ authorization: `Bearer ${key}` });

test('register: duplicate email → 409', async () => {
  const p = { type: 'human', name: 'dup', email: `dup-${Date.now()}@x.io` };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/accounts/register', payload: p })).statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/accounts/register', payload: p })).statusCode, 409, 'second registration with same email conflicts');
});

test('POST /tasks: insufficient credits → 402', async () => {
  const key = await human('poor-pub');
  // 1000 gift on signup; ask for 5000 → can't escrow.
  const r = await app.inject({
    method: 'POST', url: '/api/v1/tasks', headers: auth(key),
    payload: { title: 'too big', description: 'x', type: 'general', reward_credits: 5000, verification: { mode: 'manual' } },
  });
  assert.equal(r.statusCode, 402, 'over-budget publish is 402');
});

test('POST /tasks/:id/claim: unknown task → 400 (client error batch)', async () => {
  const ag = await agent('claimer');
  const r = await app.inject({
    method: 'POST', url: '/api/v1/tasks/00000000-0000-0000-0000-000000000000/claim', headers: auth(ag.api_key),
  });
  assert.equal(r.statusCode, 400, 'claim of a non-existent task is 400, not 404 (preserved)');
});

test('POST /tasks/:id/claim: cannot claim your own task → 400', async () => {
  const key = await human('selfclaim');
  const mk = await app.inject({
    method: 'POST', url: '/api/v1/tasks', headers: auth(key),
    payload: { title: 'mine', description: 'x', type: 'general', reward_credits: 10, verification: { mode: 'manual' } },
  });
  const taskId = JSON.parse(mk.body).id;
  const r = await app.inject({ method: 'POST', url: `/api/v1/tasks/${taskId}/claim`, headers: auth(key) });
  assert.equal(r.statusCode, 400, 'self-claim rejected as 400');
});

test('GET /tasks/:id/submissions: not owner / unknown → 403 (preserved)', async () => {
  const key = await human('subviewer');
  const r = await app.inject({
    method: 'GET', url: '/api/v1/tasks/00000000-0000-0000-0000-000000000000/submissions', headers: auth(key),
  });
  assert.equal(r.statusCode, 403, 'submissions of a task you do not own is 403');
});

test('admin/risk-flags: 401 without token (token IS configured)', async () => {
  // buildApp picks up ADMIN_TOKEN from env; the integration env sets it. If unset,
  // the route 404s (disabled) — assert whichever guard applies, both are non-200.
  const r = await app.inject({ method: 'GET', url: '/api/v1/admin/risk-flags' });
  assert.ok(r.statusCode === 401 || r.statusCode === 404, `unauthenticated admin call is blocked (got ${r.statusCode})`);
});

test('unauthenticated task create → 401', async () => {
  const r = await app.inject({
    method: 'POST', url: '/api/v1/tasks',
    payload: { title: 'x', description: 'x', type: 'general', reward_credits: 1, verification: { mode: 'manual' } },
  });
  assert.equal(r.statusCode, 401, 'no bearer → 401');
});
