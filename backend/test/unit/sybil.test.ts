import { test } from 'node:test';
import assert from 'node:assert';
import {
  decideSelfDealing,
  decideNewAccountPublishCap,
  decideRegistrationThrottle,
} from '../../src/domain/sybil';

// ── decideSelfDealing ─────────────────────────────────────────────────────────
test('self-dealing: same IP for publisher and executor is flagged for review', () => {
  const d = decideSelfDealing({ publisherIp: '1.2.3.4', executorIp: '1.2.3.4' });
  assert.equal(d.review, true);
  assert.deepEqual(d.flags, ['self_dealing_suspected']);
  assert.match(d.reason!, /same IP/i);
});

test('self-dealing: different IPs are not flagged', () => {
  const d = decideSelfDealing({ publisherIp: '1.2.3.4', executorIp: '5.6.7.8' });
  assert.equal(d.review, false);
  assert.deepEqual(d.flags, []);
});

test('self-dealing: unknown IP (null) on either side is not flagged (no false positive)', () => {
  assert.equal(decideSelfDealing({ publisherIp: null, executorIp: '1.2.3.4' }).review, false);
  assert.equal(decideSelfDealing({ publisherIp: '1.2.3.4', executorIp: null }).review, false);
  assert.equal(decideSelfDealing({ publisherIp: null, executorIp: null }).review, false);
});

// ── decideNewAccountPublishCap ────────────────────────────────────────────────
const WINDOW = 7 * 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-16T12:00:00Z');

test('new-account cap: a fresh account over the cap is blocked', () => {
  const d = decideNewAccountPublishCap({
    accountCreatedAt: new Date(NOW.getTime() - 1000), // ~now
    now: NOW,
    rewardCredits: 100,
    maxReward: 50,
    windowMs: WINDOW,
  });
  assert.equal(d.allow, false);
  assert.match(d.reason!, /at most 50/);
});

test('new-account cap: a fresh account at or under the cap is allowed', () => {
  const mk = (reward: number) =>
    decideNewAccountPublishCap({
      accountCreatedAt: new Date(NOW.getTime() - 1000),
      now: NOW,
      rewardCredits: reward,
      maxReward: 50,
      windowMs: WINDOW,
    });
  assert.equal(mk(50).allow, true); // exact boundary
  assert.equal(mk(10).allow, true);
});

test('new-account cap: an account older than the window is exempt even over the cap', () => {
  const d = decideNewAccountPublishCap({
    accountCreatedAt: new Date(NOW.getTime() - WINDOW - 1), // just past the window
    now: NOW,
    rewardCredits: 100_000,
    maxReward: 50,
    windowMs: WINDOW,
  });
  assert.equal(d.allow, true);
});

// ── decideRegistrationThrottle ────────────────────────────────────────────────
test('throttle: at/over threshold of prior same-IP signups → flagged for review', () => {
  const d = decideRegistrationThrottle({ priorCountInWindow: 3, threshold: 3 });
  assert.equal(d.review, true);
  assert.deepEqual(d.flags, ['rapid_signup_cluster']);
});

test('throttle: under threshold → not flagged', () => {
  assert.equal(decideRegistrationThrottle({ priorCountInWindow: 2, threshold: 3 }).review, false);
  assert.equal(decideRegistrationThrottle({ priorCountInWindow: 0, threshold: 3 }).review, false);
});
