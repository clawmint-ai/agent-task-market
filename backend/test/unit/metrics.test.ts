import { test } from 'node:test';
import assert from 'node:assert';
import { renderPrometheus, MetricsSnapshot } from '../../src/domain/metrics';
import { formatLine } from '../../src/runtime/logger';

const snapshot: MetricsSnapshot = {
  conservation: {
    ok: true,
    balance: { earned: 230, gift: 1000 },
    ledger: { earned: 230, gift: 1000 },
    diff: { earned: 0, gift: 0, total: 0 },
  },
  tasksByStatus: { open: 5, claimed: 1, submitted: 0, completed: 3, failed: 0, cancelled: 0 },
  executionsByStatus: { in_progress: 1, submitted: 0, accepted: 3, rejected: 2 },
  accountsByType: { human: 1, agent: 4 },
  riskFlagsByStatus: { open: 2, released: 1, frozen: 0 },
  frozenEarnedTotal: 42,
};

test('renders Prometheus exposition with HELP/TYPE and labeled gauges', () => {
  const out = renderPrometheus(snapshot);
  // Conservation gauges
  assert.match(out, /# TYPE atm_credit_balance_total gauge/);
  assert.match(out, /atm_credit_balance_total\{class="earned"\} 230/);
  assert.match(out, /atm_credit_balance_total\{class="gift"\} 1000/);
  assert.match(out, /atm_conservation_diff\{class="total"\} 0/);
  assert.match(out, /atm_conservation_ok 1/);
  // Flow gauges
  assert.match(out, /atm_tasks\{status="open"\} 5/);
  assert.match(out, /atm_tasks\{status="completed"\} 3/);
  assert.match(out, /atm_executions\{status="accepted"\} 3/);
  assert.match(out, /atm_accounts\{type="agent"\} 4/);
  // Risk review queue
  assert.match(out, /# TYPE atm_risk_flags gauge/);
  assert.match(out, /atm_risk_flags\{status="open"\} 2/);
  assert.match(out, /atm_frozen_earned_total 42/);
});

test('zero risk-flag statuses still render as 0 (drained queue stays visible)', () => {
  const out = renderPrometheus(snapshot);
  assert.match(out, /atm_risk_flags\{status="frozen"\} 0/);
});

test('zero-count statuses still render as 0 (not absent)', () => {
  const out = renderPrometheus(snapshot);
  assert.match(out, /atm_tasks\{status="submitted"\} 0/);
  assert.match(out, /atm_tasks\{status="cancelled"\} 0/);
  assert.match(out, /atm_executions\{status="submitted"\} 0/);
});

test('conservation_ok flips to 0 and diff is exposed when credits leak', () => {
  const leaked: MetricsSnapshot = {
    ...snapshot,
    conservation: { ok: false, balance: { earned: 225, gift: 1000 }, ledger: { earned: 230, gift: 1000 }, diff: { earned: 5, gift: 0, total: 5 } },
  };
  const out = renderPrometheus(leaked);
  assert.match(out, /atm_conservation_ok 0/);
  assert.match(out, /atm_conservation_diff\{class="earned"\} 5/);
});

test('output ends with a trailing newline (Prometheus parsers require it)', () => {
  assert.ok(renderPrometheus(snapshot).endsWith('\n'));
});

test('logger formatLine emits one JSON object with reserved keys uncloberrable', () => {
  const line = formatLine('info', '2026-06-15T00:00:00.000Z', 'settlement', {
    event: 'settlement.pay_winner',
    earnedDelta: 15,
    level: 'HACKED', // must NOT override the real level
  });
  const obj = JSON.parse(line);
  assert.equal(obj.level, 'info');
  assert.equal(obj.time, '2026-06-15T00:00:00.000Z');
  assert.equal(obj.msg, 'settlement');
  assert.equal(obj.event, 'settlement.pay_winner');
  assert.equal(obj.earnedDelta, 15);
});
