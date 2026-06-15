import db, { DB } from '../db/pool';
import { randomUUID } from 'crypto';
import { nextReputation } from '../domain/reputation';

// Reputation is a 0-10 score. New accounts start at 5.0. The EMA math lives in
// domain/reputation.ts (pure, unit-tested); this service persists the result.

/**
 * Apply a reputation update from a verified task outcome. Pass the enclosing
 * transaction (`conn`) so the score change is atomic with the payout.
 */
export async function applyReputation(
  conn: DB,
  accountId: string,
  outcomeScore: number,
  reason: 'task_accepted' | 'task_rejected' | 'task_expired',
  refId?: string
): Promise<number> {
  const row = await conn
    .selectFrom('accounts')
    .select('reputation_score')
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (!row) throw new Error('Account not found');

  const { scoreAfter, delta } = nextReputation(row.reputation_score, outcomeScore);

  await conn.updateTable('accounts').set({ reputation_score: scoreAfter }).where('id', '=', accountId).execute();
  await conn
    .insertInto('reputation_events')
    .values({
      id: randomUUID(),
      account_id: accountId,
      delta,
      score_after: scoreAfter,
      reason,
      ref_id: refId ?? null,
    })
    .execute();
  return scoreAfter;
}

export async function getReputationHistory(accountId: string) {
  return db
    .selectFrom('reputation_events')
    .selectAll()
    .where('account_id', '=', accountId)
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();
}
