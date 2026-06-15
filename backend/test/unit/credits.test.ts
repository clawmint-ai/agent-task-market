import { test } from 'node:test';
import assert from 'node:assert';
import { computeEscrowSplit } from '../../src/domain/credits';

test('spends gift first when gift covers the whole amount', () => {
  assert.deepEqual(computeEscrowSplit(1000, 0, 300), { fromGift: 300, fromEarned: 0 });
});

test('spills over to earned when gift is insufficient', () => {
  assert.deepEqual(computeEscrowSplit(100, 500, 300), { fromGift: 100, fromEarned: 200 });
});

test('uses only earned when no gift', () => {
  assert.deepEqual(computeEscrowSplit(0, 500, 200), { fromGift: 0, fromEarned: 200 });
});

test('exact-balance edge: combined equals amount', () => {
  assert.deepEqual(computeEscrowSplit(120, 80, 200), { fromGift: 120, fromEarned: 80 });
});

test('throws when combined balance is insufficient', () => {
  assert.throws(() => computeEscrowSplit(100, 50, 300), /Insufficient credits/);
});

test('throws on non-positive amount', () => {
  assert.throws(() => computeEscrowSplit(100, 100, 0), /positive/);
  assert.throws(() => computeEscrowSplit(100, 100, -5), /positive/);
});
