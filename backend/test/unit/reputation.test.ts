import { test } from 'node:test';
import assert from 'node:assert';
import { nextReputation, clampReputation } from '../../src/domain/reputation';

test('EMA moves the score toward the outcome by ALPHA', () => {
  // start 5.0, perfect outcome 10 → 5*0.85 + 10*0.15 = 5.75
  const { scoreAfter, delta } = nextReputation(5.0, 10);
  assert.equal(scoreAfter, 5.75);
  assert.equal(delta, 0.75);
});

test('a bad outcome lowers the score but not catastrophically', () => {
  // start 8.0, outcome 0 → 8*0.85 = 6.8
  const { scoreAfter, delta } = nextReputation(8.0, 0);
  assert.equal(scoreAfter, 6.8);
  assert.equal(delta, -1.2);
});

test('score is clamped to [0,10]', () => {
  assert.equal(clampReputation(-3), 0);
  assert.equal(clampReputation(13), 10);
  assert.equal(clampReputation(7.5), 7.5);
});

test('rounds to 2 decimals', () => {
  const { scoreAfter } = nextReputation(5.0, 7); // 5*0.85+7*0.15 = 5.30
  assert.equal(scoreAfter, 5.3);
});

test('idempotent at the fixed point (outcome == current)', () => {
  const { scoreAfter, delta } = nextReputation(6.0, 6.0);
  assert.equal(scoreAfter, 6.0);
  assert.equal(delta, 0);
});
