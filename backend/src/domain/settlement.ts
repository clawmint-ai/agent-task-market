// Pure settlement domain logic. Zero I/O.
//
// Winner-take-all: a task escrows exactly ONE bounty, so at most one executor is
// ever paid. This module decides — given the task state and how many other
// executions are still in flight — WHAT should happen when an execution is
// finalized. The service layer is responsible for EXECUTING the decision inside
// a transaction (row locks, ledger writes); the rule itself lives here so every
// branch is exhaustively unit-testable without a database.

export type FinalizeAction =
  // Task already completed (bounty paid to an earlier winner): this late passing
  // submission is superseded — no payout, no refund.
  | { kind: 'supersede' }
  // First accepted execution wins the single bounty, paid as redeemable 'earned'.
  | { kind: 'pay_winner'; rewardClass: 'earned' }
  // Rejected and no other executor is still in flight: refund the publisher,
  // restoring the EXACT gift/earned escrow split, and reopen the task.
  | { kind: 'reject_refund'; gift: number; earned: number }
  // Rejected but other executors are still working: keep the escrow held.
  | { kind: 'reject_hold' };

export interface FinalizeInput {
  accepted: boolean;
  taskStatus: 'open' | 'claimed' | 'submitted' | 'completed' | 'failed' | 'cancelled' | string;
  escrowGift: number;
  escrowEarned: number;
  /** Count of OTHER executions (not this one) still in_progress or submitted. */
  otherActiveCount: number;
}

/**
 * Decide the settlement action for finalizing one execution. Pure: same inputs
 * → same output. Does not touch the DB. See finalizeExecution in the service.
 */
export function decideFinalize(input: FinalizeInput): FinalizeAction {
  if (input.accepted) {
    if (input.taskStatus === 'completed') return { kind: 'supersede' };
    return { kind: 'pay_winner', rewardClass: 'earned' };
  }
  if (input.otherActiveCount === 0) {
    return { kind: 'reject_refund', gift: input.escrowGift, earned: input.escrowEarned };
  }
  return { kind: 'reject_hold' };
}

// ── Deadline reclaim ─────────────────────────────────────────────────────────

export type ReclaimAction =
  // Past deadline with work still in flight or already completed: do nothing.
  | { kind: 'skip' }
  // Past deadline, no winner, no active execution: refund escrow split, fail task.
  | { kind: 'reclaim'; gift: number; earned: number };

export interface ReclaimInput {
  taskStatus: string;
  escrowGift: number;
  escrowEarned: number;
  /** Executions still in_progress or submitted for this task. */
  activeCount: number;
}

/**
 * Decide whether an expired task's escrow should be reclaimed. Only reclaim when
 * the task never completed AND no executor is still working — otherwise an
 * in-flight or paid task must be left alone. Pure: no I/O. The caller is
 * responsible for selecting only tasks whose deadline has actually passed.
 */
export function decideReclaim(input: ReclaimInput): ReclaimAction {
  if (input.taskStatus === 'completed' || input.taskStatus === 'failed' || input.taskStatus === 'cancelled') {
    return { kind: 'skip' };
  }
  if (input.activeCount > 0) return { kind: 'skip' };
  return { kind: 'reclaim', gift: input.escrowGift, earned: input.escrowEarned };
}

// ── Stale-claim release ──────────────────────────────────────────────────────

export type StaleReleaseAction =
  // Nothing to do: task is in a terminal/irrelevant state, or releasing the stale
  // claims would not free any capacity, or none were stale.
  | { kind: 'skip' }
  // Release the stale in_progress executions; reopen the task only if doing so
  // drops the active count below the executor cap (i.e. the task was blocked
  // purely because abandoned claims held every slot).
  | { kind: 'release'; reopen: boolean };

export interface StaleReleaseInput {
  taskStatus: string;
  /** in_progress executions older than the stale threshold (abandoned claims). */
  staleCount: number;
  /** in_progress executions that are NOT stale (someone is still actively working). */
  freshInProgressCount: number;
  /** submitted executions awaiting verification (work was actually delivered). */
  submittedCount: number;
  maxExecutors: number;
}

/**
 * Decide whether abandoned ("stale") in_progress claims should be released and,
 * if so, whether the task should reopen. Pure: no I/O. The caller selects which
 * executions count as stale (older than a threshold and still in_progress).
 *
 * A task only becomes claimable-again when capacity is actually freed: we never
 * reopen a task that has a submitted result waiting (that's the verifier's job),
 * and we never touch completed/failed/cancelled tasks. Reopen happens only when,
 * after dropping the stale claims, the remaining active executions (fresh
 * in_progress + submitted) sit below max_executors.
 */
export function decideStaleRelease(input: StaleReleaseInput): StaleReleaseAction {
  if (input.taskStatus !== 'open' && input.taskStatus !== 'claimed') return { kind: 'skip' };
  if (input.staleCount <= 0) return { kind: 'skip' };
  const activeAfter = input.freshInProgressCount + input.submittedCount;
  const reopen = input.taskStatus === 'claimed' && activeAfter < input.maxExecutors;
  return { kind: 'release', reopen };
}
