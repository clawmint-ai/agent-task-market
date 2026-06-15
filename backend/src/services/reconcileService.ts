import db from '../db/pool';
import { sql } from 'kysely';

export interface ReconcileReport {
  ok: boolean;
  // Per-class: sum of ledger deltas must equal sum of the matching balance column.
  earned: { ledgerSum: number; balanceSum: number; diff: number };
  gift: { ledgerSum: number; balanceSum: number; diff: number };
  // Total across both classes.
  total: { ledgerSum: number; balanceSum: number; diff: number };
  checkedAt: string;
}

/**
 * Ledger conservation self-check (system-deep-analysis §0 main invariant):
 * every credit balance must be reconstructable from the immutable ledger.
 * For each credit_class, Σ(ledger.delta) must equal Σ(balance column). Any
 * non-zero diff means money was created/destroyed outside the ledger — a
 * settlement bug. Returns a report; `ok` is true iff all diffs are zero.
 *
 * Pure read-only: safe to run on a live DB or schedule as a periodic job.
 */
export async function reconcile(checkedAt: string): Promise<ReconcileReport> {
  const ledger = await db
    .selectFrom('credit_ledger')
    .select((eb) => [
      eb.fn.sum(eb.case().when('credit_class', '=', 'earned').then(eb.ref('delta')).else(0).end()).as('earned'),
      eb.fn.sum(eb.case().when('credit_class', '=', 'gift').then(eb.ref('delta')).else(0).end()).as('gift'),
    ])
    .executeTakeFirst();

  const bals = await db
    .selectFrom('accounts')
    .select((eb) => [
      eb.fn.sum('earned_balance').as('earned'),
      eb.fn.sum('gift_balance').as('gift'),
    ])
    .executeTakeFirst();

  const earnedLedger = Number(ledger?.earned ?? 0);
  const giftLedger = Number(ledger?.gift ?? 0);
  const earnedBal = Number(bals?.earned ?? 0);
  const giftBal = Number(bals?.gift ?? 0);

  const earned = { ledgerSum: earnedLedger, balanceSum: earnedBal, diff: earnedLedger - earnedBal };
  const gift = { ledgerSum: giftLedger, balanceSum: giftBal, diff: giftLedger - giftBal };
  const total = {
    ledgerSum: earnedLedger + giftLedger,
    balanceSum: earnedBal + giftBal,
    diff: earnedLedger + giftLedger - (earnedBal + giftBal),
  };

  return { ok: earned.diff === 0 && gift.diff === 0, earned, gift, total, checkedAt };
}
