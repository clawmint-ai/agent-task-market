import { test } from 'node:test';
import assert from 'node:assert';
import { decideRedeem, isRedeemEnabled } from '../../src/domain/redeem';

const base = { enabled: true, creditClass: 'earned' as const, amount: 100, earnedBalance: 500 };

test('hard lock: disabled redemption is rejected with 403', () => {
  const d = decideRedeem({ ...base, enabled: false });
  assert.equal(d.allow, false);
  assert.equal(d.status, 403);
});

test('gift credits are never redeemable (400)', () => {
  const d = decideRedeem({ ...base, creditClass: 'gift' });
  assert.equal(d.allow, false);
  assert.equal(d.status, 400);
  assert.match(d.reason!, /earned/);
});

test('earned within balance is allowed', () => {
  assert.deepEqual(decideRedeem(base), { allow: true, status: 200 });
});

test('exact-balance redemption is allowed', () => {
  assert.equal(decideRedeem({ ...base, amount: 500 }).allow, true);
});

test('amount over redeemable (earned) balance is rejected with 409', () => {
  const d = decideRedeem({ ...base, amount: 501 });
  assert.equal(d.allow, false);
  assert.equal(d.status, 409);
});

test('frozen is excluded: earnedBalance already nets out frozen, so a held account cannot redeem it', () => {
  // 500 earned total, 500 frozen → 0 spendable earned passed in.
  const d = decideRedeem({ ...base, amount: 1, earnedBalance: 0 });
  assert.equal(d.allow, false);
  assert.equal(d.status, 409);
});

test('non-positive / non-integer amounts are rejected', () => {
  assert.equal(decideRedeem({ ...base, amount: 0 }).status, 400);
  assert.equal(decideRedeem({ ...base, amount: -5 }).status, 400);
  assert.equal(decideRedeem({ ...base, amount: 1.5 }).status, 400);
});

test('isRedeemEnabled defaults OFF unless explicitly true/1', () => {
  assert.equal(isRedeemEnabled(undefined), false);
  assert.equal(isRedeemEnabled('false'), false);
  assert.equal(isRedeemEnabled('0'), false);
  assert.equal(isRedeemEnabled(''), false);
  assert.equal(isRedeemEnabled('true'), true);
  assert.equal(isRedeemEnabled('1'), true);
});
