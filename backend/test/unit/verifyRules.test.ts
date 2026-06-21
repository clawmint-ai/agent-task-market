// CLAWMIN tech-debt block D: rule-matching coverage for verifyRules via autoVerify.
// The verification service is already well-tested elsewhere — redos.test.ts (the
// ReDoS-safe regex engine), llmFallback/llmInjectionGuard.test.ts (the LLM judge),
// infraFailure/verifyTimeout.test.ts (auto_tests). The ONE gap was the auto_rules
// rule dispatch + scoring itself: the non-regex rule types and the pass/score
// aggregation across multiple rules. This fills exactly that.
//
// DB-free unit test: imports only the verification service (no db/pool).

import { test } from 'node:test';
import assert from 'node:assert';
import { autoVerify } from '../../src/services/verificationService';

const rules = (rs: unknown[]) => ({ mode: 'auto_rules' as const, rules: rs as any });

test('contains / not_contains match against the result text', async () => {
  const pass = await autoVerify(rules([{ type: 'contains', value: 'SUCCESS' }]), 'job done: SUCCESS', {});
  assert.equal(pass.passed, true);
  const fail = await autoVerify(rules([{ type: 'contains', value: 'SUCCESS' }]), 'job failed', {});
  assert.equal(fail.passed, false);

  const ncPass = await autoVerify(rules([{ type: 'not_contains', value: 'ERROR' }]), 'all good', {});
  assert.equal(ncPass.passed, true, 'absent forbidden token → passes');
  const ncFail = await autoVerify(rules([{ type: 'not_contains', value: 'ERROR' }]), 'ERROR: boom', {});
  assert.equal(ncFail.passed, false, 'present forbidden token → fails');
});

test('min_length compares result length', async () => {
  assert.equal((await autoVerify(rules([{ type: 'min_length', value: 5 }]), 'abcde', {})).passed, true);
  assert.equal((await autoVerify(rules([{ type: 'min_length', value: 5 }]), 'abcd', {})).passed, false);
});

test('json_path_equals reads a dotted path from the result metadata', async () => {
  const r = rules([{ type: 'json_path_equals', path: 'result.status', value: 'ok' }]);
  assert.equal((await autoVerify(r, 'ignored', { result: { status: 'ok' } })).passed, true);
  assert.equal((await autoVerify(r, 'ignored', { result: { status: 'bad' } })).passed, false);
  // Missing path → undefined !== value → fails (no throw).
  assert.equal((await autoVerify(r, 'ignored', {})).passed, false);
});

test('regex rule integrates the safe matcher (pass + fail)', async () => {
  const r = rules([{ type: 'regex', value: '^\\d{3}-\\d{4}$' }]);
  assert.equal((await autoVerify(r, '123-4567', {})).passed, true);
  assert.equal((await autoVerify(r, 'nope', {})).passed, false);
});

test('all rules must pass; score is the passed fraction × 10', async () => {
  const r = rules([
    { type: 'contains', value: 'A' },      // passes
    { type: 'contains', value: 'B' },      // passes
    { type: 'contains', value: 'Z' },      // fails
  ]);
  const out = await autoVerify(r, 'A and B present', {});
  assert.equal(out.passed, false, 'not all rules passed');
  assert.equal(out.score, 6.67, '2/3 × 10, rounded to 2dp');
  assert.equal((out.detail as any).passedCount, 2);
  assert.equal((out.detail as any).total, 3);
});

test('all-pass yields score 10 and passed:true', async () => {
  const out = await autoVerify(rules([{ type: 'contains', value: 'x' }, { type: 'min_length', value: 1 }]), 'x', {});
  assert.equal(out.passed, true);
  assert.equal(out.score, 10);
});

test('an empty rule set does not silently pass', async () => {
  const out = await autoVerify(rules([]), 'anything', {});
  assert.equal(out.passed, false, 'no rules → not a pass (fail-safe)');
  assert.equal(out.score, 0);
});

test('autoVerify rejects a non-auto-verifiable mode', async () => {
  await assert.rejects(
    () => autoVerify({ mode: 'manual' as any }, 'x', {}),
    /not auto-verifiable/,
  );
});
