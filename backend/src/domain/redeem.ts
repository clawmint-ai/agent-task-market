// Pure redemption-policy logic. Zero I/O.
//
// Redemption is the exit where earned credits convert to something of value
// (API quota / withdrawal). It is the single most attack-sensitive path in the
// system, so the rules live here as a pure function the unit tests can exhaust:
//
//   1. Hard kill-switch: when redemption is disabled platform-wide, nothing
//      passes — this gates the feature before the exit is built out.
//   2. Only 'earned' credits redeem. 'gift' (signup/promo) never converts to
//      value — that is the whole point of the two-class split (blocks the
//      money-pump: signup bonus → self-deal → cash out).
//   3. Frozen earned credits (held by risk review) are not spendable, so the
//      redeemable pool is earned_balance, which already EXCLUDES frozen.
//   4. Amount must be positive and within the redeemable balance.

export type CreditClass = 'earned' | 'gift';

export interface RedeemInput {
  enabled: boolean;        // REDEEM_ENABLED platform flag
  creditClass: CreditClass;
  amount: number;
  earnedBalance: number;   // spendable earned (already excludes frozen)
}

export interface RedeemDecision {
  allow: boolean;
  status: number;          // HTTP status the route should return
  reason?: string;
}

const ALLOW: RedeemDecision = { allow: true, status: 200 };

export function decideRedeem(input: RedeemInput): RedeemDecision {
  if (!input.enabled) {
    // 403, not 404: the route exists and is authenticated; it is deliberately
    // locked. A hard lock until the exit is audited (CLAWMIN-19 acceptance).
    return { allow: false, status: 403, reason: 'Redemption is not enabled' };
  }
  if (input.creditClass !== 'earned') {
    return { allow: false, status: 400, reason: 'Only earned credits are redeemable' };
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { allow: false, status: 400, reason: 'Amount must be a positive integer' };
  }
  if (input.amount > input.earnedBalance) {
    return { allow: false, status: 409, reason: 'Insufficient redeemable (earned) balance' };
  }
  return ALLOW;
}

/** True when the platform redemption kill-switch is on. Defaults to OFF (locked). */
export function isRedeemEnabled(env: string | undefined): boolean {
  return env === 'true' || env === '1';
}
