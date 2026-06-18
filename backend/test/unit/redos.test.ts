// CLAWMIN-42: publisher-supplied auto_rules regex is untrusted. A catastrophic-
// backtracking pattern like (a+)+$ against a crafted input can pin the main
// event loop forever (RegExp.test is synchronous/uninterruptible), DoS-ing the
// single-instance API. safeRegexTest runs the match in a worker thread and
// terminate()s it on timeout, so the loop is never blocked.
//
// DB-free unit test: imports only the verification service (no db/pool).

import { test } from 'node:test';
import assert from 'node:assert';
import { safeRegexTest } from '../../src/services/verificationService';

test('ReDoS pattern times out fast instead of hanging the event loop', async () => {
  // Classic catastrophic backtracking: (a+)+$ on a long run of "a" ending in a
  // non-matching char. A naive new RegExp().test() would spin for minutes; here
  // it must return within a small multiple of the (short) budget.
  const evil = '(a+)+$';
  const input = 'a'.repeat(40) + '!';
  const started = Date.now();
  const r = await safeRegexTest(evil, input, 300);
  const elapsed = Date.now() - started;
  assert.equal(r.timedOut, true, 'evil pattern is timed out, not run to completion');
  assert.equal(r.passed, false, 'a timed-out regex rule does not pass');
  assert.ok(elapsed < 3000, `returned promptly (${elapsed}ms), event loop not pinned`);
});

test('a normal regex still matches correctly (linear pattern, well under budget)', async () => {
  const yes = await safeRegexTest('^hello\\s+world$', 'hello   world');
  assert.equal(yes.passed, true, 'matching input passes');
  const no = await safeRegexTest('^\\d+$', 'not-a-number');
  assert.equal(no.passed, false, 'non-matching input fails');
  assert.equal(yes.timedOut ?? false, false, 'no timeout for a benign pattern');
});

test('an invalid regex pattern fails the rule gracefully (no throw, no pass)', async () => {
  const r = await safeRegexTest('(unclosed', 'whatever');
  assert.equal(r.passed, false, 'uncompilable pattern → rule fails');
  assert.ok(r.error, 'surfaces a compile error');
  assert.equal(r.timedOut ?? false, false, 'a compile error is not a timeout');
});
