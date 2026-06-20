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
