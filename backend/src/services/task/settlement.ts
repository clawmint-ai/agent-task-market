import { sql, Transaction } from 'kysely';
import { randomUUID } from 'crypto';
import db, { withTransaction } from '../../db/pool';
import type { Database } from '../../db/types';
import { creditCredits } from '../accountService';
import { applyReputation } from '../reputationService';
import { insertRiskFlag } from '../riskFlagService';
import { decideFinalize, decideReclaim, decideStaleRelease } from '../../domain/settlement';
import { TaskExecution, parseExecution } from './mappers';
import { getRiskEngine } from '../../risk';
import { logger } from '../../runtime/logger';

export async function verifyResult(params: {
  taskId: string;
  executionId: string;
  publisherId: string;
  accepted: boolean;
  feedback?: string;
  score?: number;
}): Promise<TaskExecution> {
  const owns = await db
    .selectFrom('tasks')
    .select('id')
    .where('id', '=', params.taskId)
    .where('publisher_id', '=', params.publisherId)
    .executeTakeFirst();
  if (!owns) throw new Error('Task not found or not owned by you');
  return finalizeExecution({
    taskId: params.taskId,
    executionId: params.executionId,
    accepted: params.accepted,
    feedback: params.feedback,
    score: params.score,
    verifiedBy: 'manual',
    verificationDetail: {},
  });
}

/**
 * Shared finalizer for both manual and auto verification. Atomic.
 *
 * The winner-take-all DECISION lives in domain/settlement.decideFinalize (pure,
 * unit-tested). This function only EXECUTES the decision inside one transaction:
 * lock the task row, mark this execution, then apply the action's DB writes.
 */
export async function finalizeExecution(params: {
  taskId: string;
  executionId: string;
  accepted: boolean;
  score?: number;
  verifiedBy: string;
  verificationDetail: Record<string, unknown>;
  feedback?: string;
}): Promise<TaskExecution> {
  // Captured inside the trx, logged AFTER commit — a rolled-back settlement must
  // never emit a money-move log line. undefined for the no-op supersede branch.
  let settled: { event: string; gift: number; earned: number; executorId?: string } | undefined;
  await withTransaction(async (trx) => {
    const task = await trx.selectFrom('tasks').selectAll().where('id', '=', params.taskId).forUpdate().executeTakeFirst();
    if (!task) throw new Error('Task not found');

    // Risk seam (FAIL-CLOSED for payouts): this is the money path. For an
    // acceptance, an unreachable risk-engine must NOT silently pay — abort so the
    // outcome can be retried/reviewed. For a rejection (no payout), fail-open.
    const exec = await trx
      .selectFrom('task_executions')
      .select(['executor_id'])
      .where('id', '=', params.executionId)
      .where('task_id', '=', params.taskId)
      .executeTakeFirst();
    let finalizeDecision;
    try {
      finalizeDecision = await getRiskEngine().onFinalize({
        taskId: params.taskId,
        executionId: params.executionId,
        executorId: exec?.executor_id ?? '',
        publisherId: task.publisher_id,
        accepted: params.accepted,
        score: params.score,
        verifiedBy: params.verifiedBy,
      });
    } catch (err) {
      if (params.accepted) throw new Error('Settlement held: risk-engine unavailable (fail-closed)');
      finalizeDecision = { allow: true }; // rejection has no payout → fail-open
    }
    if (params.accepted && !finalizeDecision.allow) {
      throw new Error(finalizeDecision.reason || 'Settlement blocked by risk policy (held for review)');
    }

    // Count OTHER executions still in flight (excludes this one). Needed by the
    // decision to know whether a rejection should refund or hold the escrow.
    const otherActiveRow = await trx
      .selectFrom('task_executions')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('task_id', '=', params.taskId)
      .where('id', '!=', params.executionId)
      .where('status', 'in', ['in_progress', 'submitted'])
      .executeTakeFirst();
    const otherActiveCount = Number(otherActiveRow?.c ?? 0);

    const action = decideFinalize({
      accepted: params.accepted,
      taskStatus: task.status,
      escrowGift: task.escrow_gift,
      escrowEarned: task.escrow_earned,
      otherActiveCount,
    });

    if (action.kind === 'supersede') {
      const sup = await trx
        .updateTable('task_executions')
        .set({
          status: 'rejected',
          feedback: 'Superseded — another executor was accepted first',
          score: params.score ?? null,
          verified_by: params.verifiedBy,
          verification_detail: JSON.stringify({ ...params.verificationDetail, superseded: true }),
          verified_at: new Date(),
        })
        .where('id', '=', params.executionId)
        .where('task_id', '=', params.taskId)
        .where('status', '=', 'submitted')
        .returning('id')
        .executeTakeFirst();
      if (!sup) throw new Error('Execution not found or not submitted');
      return;
    }

    // Transition this execution to its terminal state (accepted or rejected).
    const updated = await trx
      .updateTable('task_executions')
      .set({
        status: params.accepted ? 'accepted' : 'rejected',
        feedback: params.feedback ?? null,
        score: params.score ?? null,
        verified_by: params.verifiedBy,
        verification_detail: JSON.stringify(params.verificationDetail || {}),
        verified_at: new Date(),
      })
      .where('id', '=', params.executionId)
      .where('task_id', '=', params.taskId)
      .where('status', '=', 'submitted')
      .returning(['id', 'executor_id'])
      .executeTakeFirst();
    if (!updated) throw new Error('Execution not found or not submitted');

    if (action.kind === 'pay_winner') {
      // Pay the single winner as EARNED (redeemable) — real work done, regardless
      // of how the publisher funded escrow.
      await creditCredits(trx, updated.executor_id, task.reward_credits, 'task_reward', {
        refId: task.id,
        description: `Reward for completing task: ${task.title}`,
        creditClass: action.rewardClass,
      });
      // Risk review (CLAWMIN-23): the engine flagged this payout (e.g. same-IP
      // self-dealing) via reviewSample. We PAY then immediately FREEZE the reward —
      // it's credited to the earned ledger (conservation holds) but moved out of the
      // spendable/redeemable balance into frozen_earned_balance, pending admin review.
      // The freeze is a delta=0 move within the 'earned' class, atomic with the payout.
      let frozenForReview = false;
      if (finalizeDecision.reviewSample) {
        const frz = await trx
          .updateTable('accounts')
          .set({
            earned_balance: sql<number>`earned_balance - ${task.reward_credits}`,
            frozen_earned_balance: sql<number>`frozen_earned_balance + ${task.reward_credits}`,
            updated_at: sql<Date>`now()`,
          } as any)
          .where('id', '=', updated.executor_id)
          .where(sql<boolean>`earned_balance >= ${task.reward_credits}`)
          .returning(['earned_balance'])
          .executeTakeFirst();
        if (!frz) throw new Error('Cannot freeze reward for review: insufficient earned balance');
        await trx
          .insertInto('credit_ledger')
          .values({
            id: randomUUID(),
            account_id: updated.executor_id,
            delta: 0,
            balance_after: Number(frz.earned_balance),
            credit_class: 'earned',
            reason: 'risk_freeze',
            ref_id: task.id,
            description: `Reward held for review: ${(finalizeDecision.flags || []).join(',') || 'flagged'}`,
          })
          .execute();
        await insertRiskFlag(trx, {
          accountId: updated.executor_id,
          kind: (finalizeDecision.flags || [])[0] || 'review',
          refId: task.id,
          amount: task.reward_credits,
          detail: {
            flags: finalizeDecision.flags || [],
            reason: finalizeDecision.reason,
            executionId: params.executionId,
            publisherId: task.publisher_id,
          },
        });
        frozenForReview = true;
      }
      await trx
        .updateTable('accounts')
        .set((eb) => ({ total_tasks_completed: eb('total_tasks_completed', '+', 1) }))
        .where('id', '=', updated.executor_id)
        .execute();
      await applyReputation(trx, updated.executor_id, params.score ?? 8, 'task_accepted', updated.id);
      await trx
        .updateTable('tasks')
        .set({ status: 'completed', completed_at: new Date() })
        .where('id', '=', params.taskId)
        .execute();
      // Supersede every other still-active execution: bounty is now paid.
      await trx
        .updateTable('task_executions')
        .set({
          status: 'rejected',
          feedback: 'Superseded — another executor was accepted first',
          verification_detail: JSON.stringify({ superseded: true }),
          verified_at: new Date(),
        })
        .where('task_id', '=', params.taskId)
        .where('id', '!=', updated.id)
        .where('status', 'in', ['in_progress', 'submitted'])
        .execute();
      // Winner is always paid as EARNED (redeemable) — see creditCredits call above.
      settled = {
        event: frozenForReview ? 'pay_winner_held' : 'pay_winner',
        gift: 0,
        earned: task.reward_credits,
        executorId: updated.executor_id,
      };
      return;
    }

    // Rejection paths.
    await applyReputation(trx, updated.executor_id, 0, 'task_rejected', updated.id);
    if (action.kind === 'reject_refund') {
      // Refund the EXACT gift/earned split that was escrowed (anti-laundering).
      if (action.gift > 0) {
        await creditCredits(trx, task.publisher_id, action.gift, 'task_refund', {
          refId: task.id,
          description: `Refund (gift) - rejected result for task: ${task.title}`,
          creditClass: 'gift',
        });
      }
      if (action.earned > 0) {
        await creditCredits(trx, task.publisher_id, action.earned, 'task_refund', {
          refId: task.id,
          description: `Refund (earned) - rejected result for task: ${task.title}`,
          creditClass: 'earned',
        });
      }
      // A refund is TERMINAL. The escrowed bounty has been returned to the
      // publisher, so the task is no longer funded — reopening it (the old
      // behavior) left a live escrow on a claimable task, which the deadline
      // sweep would refund a SECOND time (CLAWMIN-39: minting), and a later
      // pay_winner could pay reward_credits against money already returned.
      // Mark it failed and zero the escrow columns so any subsequent
      // reclaim/finalize is a guarded no-op (decideReclaim already skips
      // 'failed'; zeroing is defense-in-depth in the same locked txn).
      await trx
        .updateTable('tasks')
        .set({ status: 'failed', escrow_gift: 0, escrow_earned: 0, claimed_at: null })
        .where('id', '=', params.taskId)
        .execute();
      settled = { event: 'reject_refund', gift: action.gift, earned: action.earned, executorId: updated.executor_id };
    } else {
      // reject_hold: others still working, keep escrow held.
      await trx
        .updateTable('tasks')
        .set({ status: 'claimed' })
        .where('id', '=', params.taskId)
        .where('status', '=', 'submitted')
        .execute();
      settled = { event: 'reject_hold', gift: 0, earned: 0, executorId: updated.executor_id };
    }
  });

  // Post-commit: emit a structured money-move record for ops/audit. Only reached
  // when the transaction committed, so it never logs a settlement that rolled back.
  if (settled) {
    logger.info('settlement', {
      event: `settlement.${settled.event}`,
      taskId: params.taskId,
      executionId: params.executionId,
      executorId: settled.executorId,
      accepted: params.accepted,
      verifiedBy: params.verifiedBy,
      score: params.score ?? null,
      giftDelta: settled.gift,
      earnedDelta: settled.earned,
    });
  }

  const row = await db.selectFrom('task_executions').selectAll().where('id', '=', params.executionId).executeTakeFirst();
  return parseExecution(row);
}

/**
 * Reclaim escrow from expired tasks. Sweeps tasks whose deadline has passed and
 * that are still open/claimed/submitted with no executor in flight: refunds the
 * publisher (restoring the exact gift/earned split) and marks the task failed.
 * Idempotent and safe to run periodically. Returns the count reclaimed.
 *
 * `now` is passed in (not read from the clock) so the sweep is deterministic and
 * testable. Each task is handled in its own locked transaction.
 */
export async function reclaimExpiredTasks(now: Date): Promise<{ reclaimed: number; skipped: number }> {
  const expired = await db
    .selectFrom('tasks')
    .select('id')
    .where('deadline', 'is not', null)
    .where('deadline', '<', now)
    .where('status', 'in', ['open', 'claimed', 'submitted'])
    .execute();

  let reclaimed = 0;
  let skipped = 0;
  for (const { id } of expired) {
    await withTransaction(async (trx) => {
      const task = await trx.selectFrom('tasks').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!task) return;

      const activeRow = await trx
        .selectFrom('task_executions')
        .select((eb) => eb.fn.countAll<number>().as('c'))
        .where('task_id', '=', id)
        .where('status', 'in', ['in_progress', 'submitted'])
        .executeTakeFirst();
      const activeCount = Number(activeRow?.c ?? 0);

      const action = decideReclaim({
        taskStatus: task.status,
        escrowGift: task.escrow_gift,
        escrowEarned: task.escrow_earned,
        activeCount,
      });
      if (action.kind === 'skip') {
        skipped++;
        return;
      }

      // Refund the exact escrow split, then fail the task.
      if (action.gift > 0) {
        await creditCredits(trx, task.publisher_id, action.gift, 'task_refund', {
          refId: task.id,
          description: `Deadline reclaim (gift) for task: ${task.title}`,
          creditClass: 'gift',
        });
      }
      if (action.earned > 0) {
        await creditCredits(trx, task.publisher_id, action.earned, 'task_refund', {
          refId: task.id,
          description: `Deadline reclaim (earned) for task: ${task.title}`,
          creditClass: 'earned',
        });
      }
      await trx.updateTable('tasks').set({ status: 'failed' }).where('id', '=', id).execute();
      reclaimed++;
    });
  }
  return { reclaimed, skipped };
}

// ── Stale-claim release ──────────────────────────────────────────────────────

/** Claims left in_progress longer than this (ms) are treated as abandoned. */
export const STALE_CLAIM_MS = Number(process.env.STALE_CLAIM_MS) || 30 * 60 * 1000; // 30 min

/**
 * Release abandoned claims for ONE task inside an EXISTING locked transaction.
 * Caller MUST already hold a `forUpdate()` lock on the task row (claimTask does).
 *
 * An in_progress execution older than STALE_CLAIM_MS with no submission is treated
 * as abandoned: it's transitioned to 'rejected' (terminal) so it stops occupying a
 * slot. We do NOT run settlement or a reputation penalty here — abandoning via
 * timeout is not the same as delivering a failing result, and there's no escrow
 * movement (the bounty was never paid). If releasing frees capacity on a task that
 * was 'claimed' purely because every slot was held, the task reopens.
 *
 * Returns the number of stale executions released. Idempotent.
 */
export async function releaseStaleClaimsForTask(
  trx: Transaction<Database>,
  taskId: string,
  now: Date,
  staleMs: number = STALE_CLAIM_MS
): Promise<number> {
  const task = await trx.selectFrom('tasks').select(['status', 'max_executors']).where('id', '=', taskId).executeTakeFirst();
  if (!task) return 0;

  const cutoff = new Date(now.getTime() - staleMs);
  // created_at is Generated<Timestamp>, which doesn't accept a bare Date via the
  // typed `where` operand; compare through a sql fragment (matches the codebase's
  // use of sql<T> elsewhere). Reused for both counting and the release update.
  const isStale = sql<boolean>`${sql.ref('created_at')} < ${cutoff}`;
  const isFresh = sql<boolean>`${sql.ref('created_at')} >= ${cutoff}`;

  // Three simple counts (avoids conditional-aggregate type friction; runs
  // sequentially since a transaction shares one connection).
  const staleRow = await trx
    .selectFrom('task_executions')
    .select((eb) => eb.fn.countAll<number>().as('c'))
    .where('task_id', '=', taskId)
    .where('status', '=', 'in_progress')
    .where(isStale)
    .executeTakeFirst();
  const freshRow = await trx
    .selectFrom('task_executions')
    .select((eb) => eb.fn.countAll<number>().as('c'))
    .where('task_id', '=', taskId)
    .where('status', '=', 'in_progress')
    .where(isFresh)
    .executeTakeFirst();
  const submittedRow = await trx
    .selectFrom('task_executions')
    .select((eb) => eb.fn.countAll<number>().as('c'))
    .where('task_id', '=', taskId)
    .where('status', '=', 'submitted')
    .executeTakeFirst();

  const staleCount = Number(staleRow?.c ?? 0);
  const freshInProgressCount = Number(freshRow?.c ?? 0);
  const submittedCount = Number(submittedRow?.c ?? 0);

  const action = decideStaleRelease({
    taskStatus: task.status,
    staleCount,
    freshInProgressCount,
    submittedCount,
    maxExecutors: task.max_executors,
  });
  if (action.kind === 'skip') return 0;

  const released = await trx
    .updateTable('task_executions')
    .set({
      status: 'rejected',
      feedback: 'Released — claim abandoned (in_progress past stale threshold)',
      verification_detail: JSON.stringify({ staleRelease: true }),
      verified_at: now,
    })
    .where('task_id', '=', taskId)
    .where('status', '=', 'in_progress')
    .where(isStale)
    .returning('id')
    .execute();

  if (action.reopen) {
    await trx
      .updateTable('tasks')
      .set({ status: 'open', claimed_at: null })
      .where('id', '=', taskId)
      .where('status', '=', 'claimed')
      .execute();
  }
  return released.length;
}

/**
 * Sweep ALL tasks for abandoned claims. Mirrors reclaimExpiredTasks: deterministic
 * (`now` passed in), idempotent, each task handled in its own locked transaction.
 * Safe to run periodically OR rely on the lazy release inside claimTask. Returns
 * the number of stale executions released across all tasks.
 */
export async function releaseStaleClaims(now: Date, staleMs: number = STALE_CLAIM_MS): Promise<{ released: number }> {
  const cutoff = new Date(now.getTime() - staleMs);
  const candidates = await db
    .selectFrom('task_executions')
    .select('task_id')
    .distinct()
    .where('status', '=', 'in_progress')
    .where(sql<boolean>`${sql.ref('created_at')} < ${cutoff}`)
    .execute();

  let released = 0;
  for (const { task_id } of candidates) {
    await withTransaction(async (trx) => {
      // Lock the task row so the count→release→reopen sequence is race-free against
      // a concurrent claim/submit (same discipline as claimTask / finalizeExecution).
      const locked = await trx.selectFrom('tasks').select('id').where('id', '=', task_id).forUpdate().executeTakeFirst();
      if (!locked) return;
      released += await releaseStaleClaimsForTask(trx, task_id, now, staleMs);
    });
  }
  return { released };
}
