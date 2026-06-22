// Integration tests for agentKeyService + auth principal resolution (multi-key).
// One owner account holds many agent keys, each an independent execution identity;
// auth resolves a credential to an owner OR agent principal. Requires DATABASE_URL.
// Run: npm run test:integration

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let acct, ak, auth, ctx;
const db = () => require('../../dist/db/pool.js').default;

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  ak = require('../../dist/services/agentKeyService.js');
  auth = require('../../dist/middleware/auth.js');
});
after(async () => { await ctx.teardown(); });
beforeEach(async () => {
  const { sql } = require('kysely');
  await sql`TRUNCATE TABLE credit_ledger, risk_flags, agent_keys, accounts RESTART IDENTITY CASCADE`.execute(db());
});

test('issueAgentKey returns plaintext once and resolves back to the owner', async () => {
  const owner = await acct.createAccount({ type: 'human', name: 'owner-a' });
  const issued = await ak.issueAgentKey({ ownerAccountId: owner.id, name: 'k1', computeSource: 'local_model' });
  assert.ok(issued.api_key, 'returns a plaintext key');
  const resolved = await ak.getAgentKeyByApiKey(issued.api_key);
  assert.equal(resolved.owner_account_id, owner.id);
  assert.equal(resolved.name, 'k1');
});

test('listAgentKeys lists owner keys; revoke makes a key unresolvable', async () => {
  const owner = await acct.createAccount({ type: 'human', name: 'owner-b' });
  const issued = await ak.issueAgentKey({ ownerAccountId: owner.id, name: 'k2', computeSource: 'local_model' });
  const list = await ak.listAgentKeys(owner.id);
  assert.ok(list.some((k) => k.name === 'k2'), 'lists the issued key');
  await ak.revokeAgentKey(owner.id, issued.id);
  const after = await ak.getAgentKeyByApiKey(issued.api_key);
  assert.equal(after, null, 'revoked key does not resolve');
});

test('resolvePrincipal: owner key -> owner; agent key -> agent w/ owner; unknown -> null', async () => {
  const owner = await acct.createAccount({ type: 'human', name: 'owner-c' });
  const ownerP = await auth.resolvePrincipal(owner.api_key);
  assert.equal(ownerP.kind, 'owner');

  const issued = await ak.issueAgentKey({ ownerAccountId: owner.id, name: 'k3', computeSource: 'local_model' });
  const agentP = await auth.resolvePrincipal(issued.api_key);
  assert.equal(agentP.kind, 'agent');
  assert.equal(agentP.ownerAccount.id, owner.id);

  assert.equal(await auth.resolvePrincipal('atm_nonexistent'), null);
});
