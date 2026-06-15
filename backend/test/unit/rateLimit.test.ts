import { test } from 'node:test';
import assert from 'node:assert';
import { decideRateLimit, RateLimitEntry } from '../../src/domain/rateLimit';

const cfg = { windowMs: 1000, max: 3 };

test('first request from a new key is allowed, starts a window', () => {
  const r = decideRateLimit(undefined, 1000, cfg);
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 2);
  assert.equal(r.limit, 3);
  assert.deepEqual(r.entry, { count: 1, windowStartMs: 1000 });
});

test('requests within window increment until max', () => {
  let e: RateLimitEntry | undefined;
  const allowed: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    const r = decideRateLimit(e, 1000 + i, cfg); // all inside the window
    allowed.push(r.allowed);
    e = r.entry;
  }
  assert.deepEqual(allowed, [true, true, true]);
  assert.equal(e!.count, 3);
});

test('the (max+1)th request in the window is blocked with Retry-After', () => {
  const e: RateLimitEntry = { count: 3, windowStartMs: 1000 };
  const r = decideRateLimit(e, 1500, cfg); // 500ms into a 1000ms window
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 0);
  assert.equal(r.resetMs, 500);
  assert.equal(r.retryAfterSec, 1); // ceil(500/1000), floored at 1
  assert.equal(r.entry.count, 3, 'blocked requests do not increment the counter');
});

test('a new window opens once windowMs has elapsed', () => {
  const e: RateLimitEntry = { count: 3, windowStartMs: 1000 };
  const r = decideRateLimit(e, 2000, cfg); // exactly windowMs later → expired
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 2);
  assert.deepEqual(r.entry, { count: 1, windowStartMs: 2000 });
});

test('window boundary is inclusive (>= windowMs resets)', () => {
  const e: RateLimitEntry = { count: 3, windowStartMs: 1000 };
  const justBefore = decideRateLimit(e, 1999, cfg);
  assert.equal(justBefore.allowed, false, '1ms before reset still blocked');
  const atBoundary = decideRateLimit(e, 2000, cfg);
  assert.equal(atBoundary.allowed, true, 'at boundary the window resets');
});

test('does not mutate the previous entry', () => {
  const e: RateLimitEntry = { count: 1, windowStartMs: 1000 };
  const snapshot = { ...e };
  decideRateLimit(e, 1100, cfg);
  assert.deepEqual(e, snapshot, 'prev entry untouched');
});
