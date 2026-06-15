// Pure credit domain logic. Zero I/O.
//
// Two credit classes: 'earned' (redeemable) and 'gift' (signup/promo, publish-
// only, non-redeemable). Both may fund a task bounty. This module decides how a
// publish escrow is split across the two classes — gift is spent first so that
// redeemable earned credits are preserved. A refund must restore the SAME split
// (see settlement), which is what blocks laundering gift → earned.

export interface EscrowSplit {
  fromGift: number;
  fromEarned: number;
}

/**
 * Split a publish amount across gift then earned balances. Throws if the
 * combined balance can't cover the amount. Pure: same inputs → same outputs.
 */
export function computeEscrowSplit(giftBalance: number, earnedBalance: number, amount: number): EscrowSplit {
  if (amount <= 0) throw new Error('Amount must be positive');
  if (giftBalance + earnedBalance < amount) throw new Error('Insufficient credits');
  const fromGift = Math.min(giftBalance, amount);
  const fromEarned = amount - fromGift;
  return { fromGift, fromEarned };
}
