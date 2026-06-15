import { test } from 'node:test';
import assert from 'node:assert';
import { detectInfraFailure } from '../../src/services/verificationService';

// The fairness-critical distinction: a genuine assertion failure (agent's fault →
// reject) must NOT be excused, but a broken test harness (platform's fault) must
// route to manual fallback instead of failing the agent.

test('python: missing pytest → infra failure', () => {
  const out = { code: 1, stdout: '', stderr: '/usr/bin/python3: No module named pytest' };
  assert.equal(detectInfraFailure('python', out), 'pytest not installed');
});

test('python: genuine test failure (assertion) → NOT infra', () => {
  const out = { code: 1, stdout: '1 failed in 0.02s', stderr: 'E   assert add(1,2) == 4' };
  assert.equal(detectInfraFailure('python', out), null);
});

test('python: all tests pass (code 0) → NOT infra', () => {
  const out = { code: 0, stdout: '3 passed in 0.01s', stderr: '' };
  assert.equal(detectInfraFailure('python', out), null);
});

test('interpreter not found (127) → infra failure', () => {
  const out = { code: 127, stdout: '', stderr: 'python3: command not found' };
  assert.equal(detectInfraFailure('python', out), 'test runner not found');
});

test('spawn ENOENT → infra failure', () => {
  const out = { code: 1, stdout: '', stderr: 'Error: spawn node ENOENT' };
  assert.equal(detectInfraFailure('javascript', out), 'test runner not found');
});

test('js: test harness cannot load its own deps → infra failure', () => {
  const out = { code: 1, stdout: '', stderr: "Error: Cannot find module 'assert'\n    at test.js:1" };
  assert.equal(detectInfraFailure('javascript', out), 'node test harness failed to load');
});

test('js: solution throws / assertion fails → NOT infra', () => {
  const out = { code: 1, stdout: '', stderr: 'AssertionError: expected 3 got 4\n    at test.js:5' };
  assert.equal(detectInfraFailure('javascript', out), null);
});

test('js: passing run → NOT infra', () => {
  const out = { code: 0, stdout: 'ok', stderr: '' };
  assert.equal(detectInfraFailure('javascript', out), null);
});
