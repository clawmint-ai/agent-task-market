import db from '../db/pool';
import { reconcile } from './reconcileService';
import {
  MetricsSnapshot,
  TASK_STATUSES,
  EXEC_STATUSES,
  ACCOUNT_TYPES,
  RISK_FLAG_STATUSES,
  countInto,
} from '../domain/metrics';

// Re-export the pure shaping/render API so callers (routes) have one import site.
export { MetricsSnapshot, renderPrometheus } from '../domain/metrics';

/** Snapshot the live system from the DB: ledger conservation + task/exec/account
 *  counts + risk-review queue. Read-only; safe on a live DB and on every scrape. */
export async function collectMetrics(checkedAt: string): Promise<MetricsSnapshot> {
  const [rep, taskRows, execRows, acctRows, flagRows, frozenRow] = await Promise.all([
    reconcile(checkedAt),
    db.selectFrom('tasks').select((eb) => ['status as k', eb.fn.countAll<number>().as('c')]).groupBy('status').execute(),
    db.selectFrom('task_executions').select((eb) => ['status as k', eb.fn.countAll<number>().as('c')]).groupBy('status').execute(),
    db.selectFrom('accounts').select((eb) => ['type as k', eb.fn.countAll<number>().as('c')]).groupBy('type').execute(),
    db.selectFrom('risk_flags').select((eb) => ['status as k', eb.fn.countAll<number>().as('c')]).groupBy('status').execute(),
    db.selectFrom('accounts').select((eb) => eb.fn.sum<number>('frozen_earned_balance').as('s')).executeTakeFirst(),
  ]);

  return {
    conservation: {
      ok: rep.ok,
      balance: { earned: rep.earned.balanceSum, gift: rep.gift.balanceSum },
      ledger: { earned: rep.earned.ledgerSum, gift: rep.gift.ledgerSum },
      diff: { earned: rep.earned.diff, gift: rep.gift.diff, total: rep.total.diff },
    },
    tasksByStatus: countInto(TASK_STATUSES, taskRows as Array<{ k: string; c: number }>),
    executionsByStatus: countInto(EXEC_STATUSES, execRows as Array<{ k: string; c: number }>),
    accountsByType: countInto(ACCOUNT_TYPES, acctRows as Array<{ k: string; c: number }>),
    riskFlagsByStatus: countInto(RISK_FLAG_STATUSES, flagRows as Array<{ k: string; c: number }>),
    frozenEarnedTotal: Number(frozenRow?.s ?? 0),
  };
}

/** Owner-console overview counts + agent-identity credential summary (Slice B3). */
export interface OwnerOverview {
  counts: {
    work_packages_open: number;
    executions_in_progress: number;
    submissions_awaiting_review: number;
    risk_holds_open: number;
  };
  agent_identities: {
    issued: number;
    active_credentials: number;
    revoked: number;
  };
}

/**
 * Aggregate the owner-console overview for one owner account (Slice B3). Counts are
 * scoped to the owner's published tasks (review queue) and the owner's risk holds and
 * agent keys. Online/offline status is intentionally omitted until `agent_sessions`
 * exists (B9); identities report only issued/active/revoked credentials.
 *
 * Bounded query count (5 aggregates, no per-task loops). Wallet + principal are
 * assembled by the route from the authenticated owner account.
 */
export async function collectOwnerOverview(ownerAccountId: string): Promise<OwnerOverview> {
  const execOnMyTasks = (status: 'in_progress' | 'submitted') =>
    db
      .selectFrom('task_executions as te')
      .innerJoin('tasks as t', 't.id', 'te.task_id')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('t.publisher_id', '=', ownerAccountId)
      .where('te.status', '=', status)
      .executeTakeFirst();

  const [openTasks, inProgress, awaitingReview, riskHolds, keysIssued, keysActive] =
    await Promise.all([
      db
        .selectFrom('tasks')
        .select((eb) => eb.fn.countAll<number>().as('c'))
        .where('publisher_id', '=', ownerAccountId)
        .where('status', '=', 'open')
        .executeTakeFirst(),
      execOnMyTasks('in_progress'),
      execOnMyTasks('submitted'),
      db
        .selectFrom('risk_flags')
        .select((eb) => eb.fn.countAll<number>().as('c'))
        .where('account_id', '=', ownerAccountId)
        .where('status', '=', 'open')
        .executeTakeFirst(),
      db
        .selectFrom('agent_keys')
        .select((eb) => eb.fn.countAll<number>().as('c'))
        .where('owner_account_id', '=', ownerAccountId)
        .executeTakeFirst(),
      db
        .selectFrom('agent_keys')
        .select((eb) => eb.fn.countAll<number>().as('c'))
        .where('owner_account_id', '=', ownerAccountId)
        .where('is_active', '=', true)
        .executeTakeFirst(),
    ]);

  const issued = Number(keysIssued?.c ?? 0);
  const active = Number(keysActive?.c ?? 0);

  return {
    counts: {
      work_packages_open: Number(openTasks?.c ?? 0),
      executions_in_progress: Number(inProgress?.c ?? 0),
      submissions_awaiting_review: Number(awaitingReview?.c ?? 0),
      risk_holds_open: Number(riskHolds?.c ?? 0),
    },
    agent_identities: {
      issued,
      active_credentials: active,
      revoked: issued - active,
    },
  };
}
