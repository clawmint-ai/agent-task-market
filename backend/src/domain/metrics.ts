// Pure metrics shaping + Prometheus rendering. No I/O, no DB — lives in the domain
// layer so it's unit-testable without a database (the DB-touching collector that
// feeds it lives in services/metricsService.ts).

// Full label domains, so a status with zero rows still renders as 0 (a missing
// series in Prometheus reads as "no data", which hides a drained queue).
export const TASK_STATUSES = ['open', 'claimed', 'submitted', 'completed', 'failed', 'cancelled'] as const;
export const EXEC_STATUSES = ['in_progress', 'submitted', 'accepted', 'rejected'] as const;
export const ACCOUNT_TYPES = ['human', 'agent'] as const;

export interface MetricsSnapshot {
  conservation: {
    ok: boolean;
    balance: { earned: number; gift: number };
    ledger: { earned: number; gift: number };
    diff: { earned: number; gift: number; total: number };
  };
  tasksByStatus: Record<string, number>;
  executionsByStatus: Record<string, number>;
  accountsByType: Record<string, number>;
}

/** Seed every label to 0, then overlay the rows actually present in the DB. */
export function countInto(labels: readonly string[], rows: Array<{ k: string; c: number | string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of labels) out[l] = 0;
  for (const r of rows) out[r.k] = Number(r.c);
  return out;
}

// ── Prometheus text exposition (v0.0.4) ───────────────────────────────────────
function line(name: string, value: number, labels?: Record<string, string>): string {
  const lbl = labels
    ? '{' + Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',') + '}'
    : '';
  return `${name}${lbl} ${value}`;
}

/**
 * Render a snapshot as Prometheus exposition text. Pure — no I/O, no clock — so
 * the exact output is unit-tested. Each metric carries HELP/TYPE per convention.
 */
export function renderPrometheus(s: MetricsSnapshot): string {
  const out: string[] = [];

  out.push('# HELP atm_credit_balance_total Sum of account balances by credit class.');
  out.push('# TYPE atm_credit_balance_total gauge');
  out.push(line('atm_credit_balance_total', s.conservation.balance.earned, { class: 'earned' }));
  out.push(line('atm_credit_balance_total', s.conservation.balance.gift, { class: 'gift' }));

  out.push('# HELP atm_credit_ledger_total Sum of immutable ledger deltas by credit class.');
  out.push('# TYPE atm_credit_ledger_total gauge');
  out.push(line('atm_credit_ledger_total', s.conservation.ledger.earned, { class: 'earned' }));
  out.push(line('atm_credit_ledger_total', s.conservation.ledger.gift, { class: 'gift' }));

  out.push('# HELP atm_conservation_diff Ledger sum minus balance sum; 0 means conserved. Alert on != 0.');
  out.push('# TYPE atm_conservation_diff gauge');
  out.push(line('atm_conservation_diff', s.conservation.diff.earned, { class: 'earned' }));
  out.push(line('atm_conservation_diff', s.conservation.diff.gift, { class: 'gift' }));
  out.push(line('atm_conservation_diff', s.conservation.diff.total, { class: 'total' }));

  out.push('# HELP atm_conservation_ok 1 when the ledger reconciles, 0 when credits leaked.');
  out.push('# TYPE atm_conservation_ok gauge');
  out.push(line('atm_conservation_ok', s.conservation.ok ? 1 : 0));

  out.push('# HELP atm_tasks Current task count by status.');
  out.push('# TYPE atm_tasks gauge');
  for (const [status, c] of Object.entries(s.tasksByStatus)) out.push(line('atm_tasks', c, { status }));

  out.push('# HELP atm_executions Current execution count by status.');
  out.push('# TYPE atm_executions gauge');
  for (const [status, c] of Object.entries(s.executionsByStatus)) out.push(line('atm_executions', c, { status }));

  out.push('# HELP atm_accounts Account count by type.');
  out.push('# TYPE atm_accounts gauge');
  for (const [type, c] of Object.entries(s.accountsByType)) out.push(line('atm_accounts', c, { type }));

  return out.join('\n') + '\n';
}
