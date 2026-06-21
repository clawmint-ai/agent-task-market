import db, { DB, withTransaction } from '../db/pool';
import { randomUUID } from 'crypto';
import { moveEarnedFrozenInTrx } from './accountService';

/**
 * Risk-flag persistence + admin resolution (CLAWMIN-23). A flag is the audit record
 * for an outcome the risk engine routed to review. The freeze of credits itself lives
 * in accountService (freeze/unfreeze earned); this module records WHY and lets an
 * admin release (unfreeze) or confirm (keep frozen) the hold.
 */

export interface RiskFlagInput {
  accountId: string;
  kind: string;
  refId?: string | null;
  amount?: number;
  detail?: Record<string, unknown>;
}

/**
 * Insert a risk_flags row. Takes `conn` so settlement can write the flag inside the
 * SAME transaction that pays-then-freezes the reward — the flag and the freeze commit
 * atomically (a rolled-back settlement leaves no orphan flag). Returns the flag id.
 */
export async function insertRiskFlag(conn: DB, input: RiskFlagInput): Promise<string> {
  const id = randomUUID();
  await conn
    .insertInto('risk_flags')
    .values({
      id,
      account_id: input.accountId,
      kind: input.kind,
      ref_id: input.refId ?? null,
      amount: input.amount ?? 0,
      detail: JSON.stringify(input.detail ?? {}),
    })
    .execute();
  return id;
}

/** List flags, newest first, optionally filtered by status. */
export async function listRiskFlags(status?: 'open' | 'released' | 'frozen', limit = 100) {
  let q = db.selectFrom('risk_flags').selectAll().orderBy('created_at', 'desc').limit(limit);
  if (status) q = q.where('status', '=', status);
  return q.execute();
}

/**
 * Release a flag: an admin cleared the suspicion, so the held credits go back into
 * circulation. Atomically moves the flagged `amount` frozen_earned → earned and marks
 * the flag 'released'. Only an 'open' flag can be released (idempotent: a second call
 * finds no open row and throws). Returns the resolved flag id.
 */
export async function releaseRiskFlag(flagId: string, resolvedBy: string): Promise<string> {
  return withTransaction(async (trx) => {
    const flag = await trx
      .selectFrom('risk_flags')
      .selectAll()
      .where('id', '=', flagId)
      .where('status', '=', 'open')
      .forUpdate()
      .executeTakeFirst();
    if (!flag) throw new Error('Risk flag not found or not open');

    if (flag.amount > 0) {
      await moveEarnedFrozenInTrx(trx, 'unfreeze', flag.account_id, flag.amount, 'risk_release', {
        description: `Risk flag ${flagId} released by ${resolvedBy}`,
      });
    }
    await trx
      .updateTable('risk_flags')
      .set({ status: 'released', resolved_at: new Date(), resolved_by: resolvedBy })
      .where('id', '=', flagId)
      .execute();
    return flagId;
  });
}

/**
 * Confirm a flag: an admin upheld the suspicion. Credits STAY frozen (out of
 * circulation); we only move the flag 'open' → 'frozen' to close the review. No ledger
 * movement. Only an 'open' flag can be confirmed.
 */
export async function confirmRiskFlag(flagId: string, resolvedBy: string): Promise<string> {
  const updated = await db
    .updateTable('risk_flags')
    .set({ status: 'frozen', resolved_at: new Date(), resolved_by: resolvedBy })
    .where('id', '=', flagId)
    .where('status', '=', 'open')
    .returning('id')
    .executeTakeFirst();
  if (!updated) throw new Error('Risk flag not found or not open');
  return updated.id;
}
