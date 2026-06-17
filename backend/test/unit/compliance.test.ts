import { test } from 'node:test';
import assert from 'node:assert';
import {
  evaluateRegistration,
  computeTier,
  parseAllowedTokenPlans,
  COMPUTE_SOURCES,
} from '../../src/domain/compliance';

test('humans are exempt — no compute_source needed', () => {
  const r = evaluateRegistration({ type: 'human' });
  assert.strictEqual(r.allow, true);
});

test('agent without compute_source → 400', () => {
  const r = evaluateRegistration({ type: 'agent', computeAttestation: true });
  assert.strictEqual(r.allow, false);
  if (!r.allow) assert.strictEqual(r.status, 400);
});

test('agent with subscription_oauth → 403 compliance refusal', () => {
  for (const v of ['subscription_oauth', 'claude-pro', 'Claude Max', 'ChatGPT Plus', 'max_oauth']) {
    const r = evaluateRegistration({ type: 'agent', computeSource: v, computeAttestation: true });
    assert.strictEqual(r.allow, false, `${v} should be rejected`);
    if (!r.allow) assert.strictEqual(r.status, 403, `${v} should be 403`);
  }
});

test('agent with unknown/misspelled source → 400', () => {
  const r = evaluateRegistration({ type: 'agent', computeSource: 'lokal_modle', computeAttestation: true });
  assert.strictEqual(r.allow, false);
  if (!r.allow) assert.strictEqual(r.status, 400);
});

test('agent with valid source but no attestation → 400', () => {
  const r = evaluateRegistration({ type: 'agent', computeSource: 'local_model', computeAttestation: false });
  assert.strictEqual(r.allow, false);
  if (!r.allow) assert.strictEqual(r.status, 400);
});

test('compliant agent (local_model) → allow, Tier 1', () => {
  const r = evaluateRegistration({ type: 'agent', computeSource: 'local_model', computeAttestation: true });
  assert.strictEqual(r.allow, true);
  if (r.allow) {
    assert.strictEqual(r.source, 'local_model');
    assert.strictEqual(r.tier, 1);
  }
});

test('normalizes spacing/case ("Local Model" → local_model)', () => {
  const r = evaluateRegistration({ type: 'agent', computeSource: 'Local Model', computeAttestation: true });
  assert.strictEqual(r.allow, true);
  if (r.allow) assert.strictEqual(r.source, 'local_model');
});

test('token_plan_whitelist requires a plan on the allow-list', () => {
  const denied = evaluateRegistration({
    type: 'agent',
    computeSource: 'token_plan_whitelist',
    computeAttestation: true,
    tokenPlan: 'random_plan',
    allowedTokenPlans: ['team_api'],
  });
  assert.strictEqual(denied.allow, false);
  if (!denied.allow) assert.strictEqual(denied.status, 403);

  const ok = evaluateRegistration({
    type: 'agent',
    computeSource: 'token_plan_whitelist',
    computeAttestation: true,
    tokenPlan: 'team_api',
    allowedTokenPlans: ['team_api'],
  });
  assert.strictEqual(ok.allow, true);
  if (ok.allow) assert.strictEqual(ok.tier, 2);
});

test('token_plan_whitelist with empty allow-list → 403', () => {
  const r = evaluateRegistration({
    type: 'agent',
    computeSource: 'token_plan_whitelist',
    computeAttestation: true,
    tokenPlan: 'anything',
    allowedTokenPlans: [],
  });
  assert.strictEqual(r.allow, false);
  if (!r.allow) assert.strictEqual(r.status, 403);
});

test('computeTier mapping', () => {
  assert.strictEqual(computeTier('local_model'), 1);
  assert.strictEqual(computeTier('payg_api_key'), 2);
  assert.strictEqual(computeTier('token_plan_whitelist'), 2);
  assert.strictEqual(computeTier('platform_credit'), 3);
  assert.strictEqual(computeTier('unspecified'), 3);
});

test('parseAllowedTokenPlans trims and drops empties', () => {
  assert.deepStrictEqual(parseAllowedTokenPlans(' a, b ,,c '), ['a', 'b', 'c']);
  assert.deepStrictEqual(parseAllowedTokenPlans(undefined), []);
  assert.deepStrictEqual(parseAllowedTokenPlans(''), []);
});

test('COMPUTE_SOURCES excludes unspecified and any oauth variant', () => {
  assert.ok(!COMPUTE_SOURCES.includes('unspecified' as any));
  assert.ok(COMPUTE_SOURCES.every((s) => !s.includes('oauth')));
});
