import { test } from 'node:test';
import assert from 'node:assert';
import { decideFinalize, decideReclaim, decideStaleRelease } from '../../src/domain/settlement';

test('accepted + task already completed → supersede (no payout)', () => {
  const a = decideFinalize({ accepted: true, taskStatus: 'completed', escrowGift: 0, escrowEarned: 100, otherActiveCount: 0 });
  assert.deepEqual(a, { kind: 'supersede' });
});

test('accepted + task not completed → pay_winner as earned', () => {
  const a = decideFinalize({ accepted: true, taskStatus: 'submitted', escrowGift: 50, escrowEarned: 50, otherActiveCount: 2 });
  assert.deepEqual(a, { kind: 'pay_winner', rewardClass: 'earned' });
});

test('rejected + no other active → refund exact escrow split', () => {
  const a = decideFinalize({ accepted: false, taskStatus: 'submitted', escrowGift: 30, escrowEarned: 70, otherActiveCount: 0 });
  assert.deepEqual(a, { kind: 'reject_refund', gift: 30, earned: 70 });
});

test('rejected + others still active → hold escrow (no refund)', () => {
  const a = decideFinalize({ accepted: false, taskStatus: 'submitted', escrowGift: 30, escrowEarned: 70, otherActiveCount: 1 });
  assert.deepEqual(a, { kind: 'reject_hold' });
});

test('refund split is preserved exactly (anti-laundering): all-gift escrow refunds all-gift', () => {
  const a = decideFinalize({ accepted: false, taskStatus: 'submitted', escrowGift: 200, escrowEarned: 0, otherActiveCount: 0 });
  assert.deepEqual(a, { kind: 'reject_refund', gift: 200, earned: 0 });
});

test('accepted takes precedence over otherActiveCount', () => {
  // Even with others active, an acceptance pays the winner (and the executor of
  // the others gets superseded by the service afterward).
  const a = decideFinalize({ accepted: true, taskStatus: 'submitted', escrowGift: 0, escrowEarned: 10, otherActiveCount: 5 });
  assert.equal(a.kind, 'pay_winner');
});

test('reclaim: expired open task with no active executions → reclaim escrow split', () => {
  const a = decideReclaim({ taskStatus: 'open', escrowGift: 40, escrowEarned: 60, activeCount: 0 });
  assert.deepEqual(a, { kind: 'reclaim', gift: 40, earned: 60 });
});

test('reclaim: expired but executor still working → skip', () => {
  const a = decideReclaim({ taskStatus: 'submitted', escrowGift: 40, escrowEarned: 60, activeCount: 1 });
  assert.deepEqual(a, { kind: 'skip' });
});

test('reclaim: already completed/failed/cancelled → skip', () => {
  for (const s of ['completed', 'failed', 'cancelled']) {
    assert.deepEqual(decideReclaim({ taskStatus: s, escrowGift: 10, escrowEarned: 0, activeCount: 0 }), { kind: 'skip' });
  }
});

// ── decideStaleRelease ───────────────────────────────────────────────────────

test('stale: claimed task, sole claim is stale → release + reopen', () => {
  // The reported lockup: max_executors=1, one abandoned in_progress claim.
  const a = decideStaleRelease({ taskStatus: 'claimed', staleCount: 1, freshInProgressCount: 0, submittedCount: 0, maxExecutors: 1 });
  assert.deepEqual(a, { kind: 'release', reopen: true });
});

test('stale: no stale claims → skip', () => {
  const a = decideStaleRelease({ taskStatus: 'claimed', staleCount: 0, freshInProgressCount: 1, submittedCount: 0, maxExecutors: 1 });
  assert.deepEqual(a, { kind: 'skip' });
});

test('stale: claimed, max=2, one stale + one fresh → release stale and reopen (slot freed)', () => {
  // max_executors=2 with one stale + one fresh claim. Releasing the stale drops
  // active to 1, which is below the cap → the task should reopen for a new claim.
  const a = decideStaleRelease({ taskStatus: 'claimed', staleCount: 1, freshInProgressCount: 1, submittedCount: 0, maxExecutors: 2 });
  assert.deepEqual(a, { kind: 'release', reopen: true });
});

test('stale: claimed, max=2, both slots filled by fresh claims, one extra stale → release but no reopen', () => {
  // Two fresh claims already fill the cap; releasing an extra stale claim frees
  // nothing claimable (active still == cap) → do not reopen.
  const a = decideStaleRelease({ taskStatus: 'claimed', staleCount: 1, freshInProgressCount: 2, submittedCount: 0, maxExecutors: 2 });
  assert.deepEqual(a, { kind: 'release', reopen: false });
});

test('stale: submitted work waiting → release stale claim but never reopen', () => {
  // A submitted result is the verifier's job; reopening would double-admit.
  const a = decideStaleRelease({ taskStatus: 'claimed', staleCount: 1, freshInProgressCount: 0, submittedCount: 1, maxExecutors: 1 });
  assert.deepEqual(a, { kind: 'release', reopen: false });
});

test('stale: open task with a stale claim (capacity not full) → release, no reopen needed', () => {
  // Task still open (under cap); releasing is housekeeping, reopen flag stays false.
  const a = decideStaleRelease({ taskStatus: 'open', staleCount: 1, freshInProgressCount: 0, submittedCount: 0, maxExecutors: 2 });
  assert.deepEqual(a, { kind: 'release', reopen: false });
});

test('stale: terminal task states are never touched', () => {
  for (const s of ['completed', 'failed', 'cancelled', 'submitted']) {
    const a = decideStaleRelease({ taskStatus: s, staleCount: 3, freshInProgressCount: 0, submittedCount: 0, maxExecutors: 1 });
    assert.deepEqual(a, { kind: 'skip' }, `status ${s} must skip`);
  }
});
