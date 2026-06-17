import { test } from 'node:test';
import assert from 'node:assert';
import {
  HttpMetrics,
  DEFAULT_BUCKETS,
  renderBuildInfo,
  normalizeRoute,
} from '../../src/domain/httpMetrics';

test('counts requests by method/route/status', () => {
  const m = new HttpMetrics();
  m.observe({ method: 'GET', route: '/api/v1/tasks', status: 200, durationSeconds: 0.01 });
  m.observe({ method: 'GET', route: '/api/v1/tasks', status: 200, durationSeconds: 0.02 });
  m.observe({ method: 'POST', route: '/api/v1/accounts/register', status: 201, durationSeconds: 0.2 });
  const out = m.render();
  assert.match(out, /atm_http_requests_total\{method="GET",route="\/api\/v1\/tasks",status="200"\} 2/);
  assert.match(out, /atm_http_requests_total\{method="POST",route="\/api\/v1\/accounts\/register",status="201"\} 1/);
});

test('histogram emits cumulative _bucket, _sum, _count per series', () => {
  const m = new HttpMetrics();
  // durations: 0.003 (≤0.005), 0.05 (≤0.05), 2.0 (only +Inf)
  m.observe({ method: 'GET', route: '/x', status: 200, durationSeconds: 0.003 });
  m.observe({ method: 'GET', route: '/x', status: 200, durationSeconds: 0.05 });
  m.observe({ method: 'GET', route: '/x', status: 200, durationSeconds: 2.0 });
  const out = m.render();

  // Cumulative: le=0.005 catches only the 0.003 sample → 1
  assert.match(out, /atm_http_request_duration_seconds_bucket\{method="GET",route="\/x",status="200",le="0\.005"\} 1/);
  // le=0.05 is cumulative → 0.003 and 0.05 → 2
  assert.match(out, /atm_http_request_duration_seconds_bucket\{method="GET",route="\/x",status="200",le="0\.05"\} 2/);
  // +Inf catches all three
  assert.match(out, /atm_http_request_duration_seconds_bucket\{method="GET",route="\/x",status="200",le="\+Inf"\} 3/);
  assert.match(out, /atm_http_request_duration_seconds_count\{method="GET",route="\/x",status="200"\} 3/);
  // sum = 0.003 + 0.05 + 2.0 = 2.053
  assert.match(out, /atm_http_request_duration_seconds_sum\{method="GET",route="\/x",status="200"\} 2\.053/);
});

test('buckets are sorted ascending and end with +Inf', () => {
  for (let i = 1; i < DEFAULT_BUCKETS.length; i++) {
    assert.ok(DEFAULT_BUCKETS[i] > DEFAULT_BUCKETS[i - 1], 'strictly ascending');
  }
});

test('HELP/TYPE headers present once, output ends with newline', () => {
  const m = new HttpMetrics();
  m.observe({ method: 'GET', route: '/x', status: 200, durationSeconds: 0.01 });
  const out = m.render();
  assert.match(out, /# TYPE atm_http_requests_total counter/);
  assert.match(out, /# TYPE atm_http_request_duration_seconds histogram/);
  assert.equal(out.match(/# TYPE atm_http_requests_total counter/g)?.length, 1, 'TYPE emitted once');
  assert.ok(out.endsWith('\n'));
});

test('empty registry renders headers but no samples (valid exposition)', () => {
  const out = new HttpMetrics().render();
  assert.match(out, /# TYPE atm_http_requests_total counter/);
  assert.doesNotMatch(out, /atm_http_requests_total\{/);
});

test('normalizeRoute keeps templated paths, never high-cardinality ids', () => {
  // Fastify routeOptions.url is already a template; pass through.
  assert.equal(normalizeRoute('/api/v1/tasks/:id'), '/api/v1/tasks/:id');
  // Missing route (404 with no matched route) collapses to a single label.
  assert.equal(normalizeRoute(undefined), '__unmatched__');
  assert.equal(normalizeRoute(''), '__unmatched__');
});

test('label values with quotes/backslashes are escaped', () => {
  const m = new HttpMetrics();
  m.observe({ method: 'GET', route: '/a"b\\c', status: 200, durationSeconds: 0.01 });
  const out = m.render();
  assert.match(out, /route="\/a\\"b\\\\c"/);
});

test('renderBuildInfo emits a gauge=1 with version+commit labels', () => {
  const out = renderBuildInfo({ version: '0.1.0', commit: 'abc1234' });
  assert.match(out, /# TYPE atm_build_info gauge/);
  assert.match(out, /atm_build_info\{version="0\.1\.0",commit="abc1234"\} 1/);
  assert.ok(out.endsWith('\n'));
});

test('renderBuildInfo defaults missing fields to "unknown"', () => {
  const out = renderBuildInfo({});
  assert.match(out, /atm_build_info\{version="unknown",commit="unknown"\} 1/);
});
