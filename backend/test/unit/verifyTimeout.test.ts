import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  LocalProcessSandbox,
  setSandboxRunnerForTest,
  resetSandboxRunnerForTest,
  type SandboxRunner,
  type SandboxResult,
} from '../../src/runtime/sandbox';
import { autoVerify } from '../../src/services/verificationService';

afterEach(() => resetSandboxRunnerForTest());

// A stub runner that returns whatever SandboxResult we hand it, so verification
// logic can be exercised for timeout/crash paths without a real Docker daemon.
function stubRunner(result: SandboxResult): SandboxRunner {
  return { run: () => Promise.resolve(result) };
}

// ── Layer 1: the runner actually flags a real timeout ────────────────────────
test('LocalProcessSandbox: a run that exceeds timeoutMs sets timedOut', async () => {
  const out = await new LocalProcessSandbox().run('sleep', ['5'], process.cwd(), 200);
  assert.equal(out.timedOut, true, 'killed-by-timeout run must be flagged');
  assert.notEqual(out.code, 0, 'a killed run is not a clean exit');
});

test('LocalProcessSandbox: a normal fast exit is NOT flagged as timedOut', async () => {
  const out = await new LocalProcessSandbox().run('true', [], process.cwd(), 5000);
  assert.equal(out.code, 0);
  assert.ok(!out.timedOut, 'a process that exits on its own is not a timeout');
});

// ── Layer 2: verifyTests routes a timeout to manual review, not auto-reject ──
test('verifyTests: timeout → manual fallback (no auto-reject, no rep hit)', async () => {
  setSandboxRunnerForTest(stubRunner({ code: 1, stdout: '', stderr: '', timedOut: true }));
  const vr = await autoVerify(
    { mode: 'auto_tests', language: 'python', tests: 'def test_x(): assert True' },
    'def solution(): pass',
    {}
  );
  assert.equal(vr.passed, false);
  assert.equal((vr.detail as any).fallback, 'manual', 'timeout must route to manual, not reject');
  assert.equal((vr.detail as any).infraError, 'verification timed out');
});

test('verifyTests: a genuine non-zero exit (not timed out) IS a real reject', async () => {
  setSandboxRunnerForTest(stubRunner({ code: 1, stdout: '', stderr: 'assert failed', timedOut: false }));
  const vr = await autoVerify(
    { mode: 'auto_tests', language: 'python', tests: 'def test_x(): assert False' },
    'def solution(): pass',
    {}
  );
  assert.equal(vr.passed, false);
  assert.equal((vr.detail as any).fallback, undefined, 'a real test failure must NOT be excused as manual');
});

test('verifyTests: exit 0 → passed', async () => {
  setSandboxRunnerForTest(stubRunner({ code: 0, stdout: '1 passed', stderr: '', timedOut: false }));
  const vr = await autoVerify(
    { mode: 'auto_tests', language: 'python', tests: 'def test_x(): assert True' },
    'def solution(): pass',
    {}
  );
  assert.equal(vr.passed, true);
  assert.equal(vr.score, 10);
});
