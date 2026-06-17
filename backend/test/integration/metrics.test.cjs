// Integration test for the /metrics scrape (CLAWMIN-38). Boots the real app,
// drives traffic through the onResponse hook, then scrapes /metrics and asserts
// the HTTP RED series + build_info render ALONGSIDE the existing business
// gauges (the DB snapshot). Requires DATABASE_URL (real Postgres).
// Run: npm run test:integration

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let app, ctx;

before(async () => {
  ctx = await setupSchema();
  const { buildApp } = require('../../dist/index.js');
  app = await buildApp({ logger: false });
});

after(async () => {
  await app.close();
  await ctx.teardown();
});

test('/metrics renders RED + build_info alongside business gauges', async () => {
  // Drive traffic: a matched route (404 body is fine — it still flows through
  // the stack) and the health probe, so the hook records at least one series.
  await app.inject({ method: 'GET', url: '/api/v1/tasks' });
  await app.inject({ method: 'GET', url: '/health' });

  const res = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/plain; version=0\.0\.4/);
  const body = res.body;

  // RED counter present, labelled by method/route/status.
  assert.match(body, /# TYPE atm_http_requests_total counter/);
  assert.match(body, /atm_http_requests_total\{method="GET",route="[^"]+",status="\d+"\} \d+/);

  // Histogram with cumulative buckets + sum + count.
  assert.match(body, /# TYPE atm_http_request_duration_seconds histogram/);
  assert.match(body, /atm_http_request_duration_seconds_bucket\{[^}]*le="\+Inf"\} \d+/);
  assert.match(body, /atm_http_request_duration_seconds_count\{[^}]*\} \d+/);

  // build_info gauge.
  assert.match(body, /# TYPE atm_build_info gauge/);
  assert.match(body, /atm_build_info\{version="[^"]*",commit="[^"]*"\} 1/);

  // Business gauges (DB snapshot) still rendered — RED is additive, not a
  // replacement.
  assert.match(body, /atm_conservation_ok [01]/);
  assert.match(body, /# TYPE atm_tasks gauge/);
});

test('/metrics scrape excludes itself from the RED series', async () => {
  // Scrape twice; the scrape path must never appear as a labelled route.
  await app.inject({ method: 'GET', url: '/metrics' });
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  assert.doesNotMatch(res.body, /route="\/metrics"/);
});

test('route labels are templates, not concrete ids (no high cardinality)', async () => {
  // Hit a parameterised route with two distinct ids; both collapse to one
  // templated series.
  await app.inject({ method: 'GET', url: '/api/v1/tasks/11111111-1111-1111-1111-111111111111' });
  await app.inject({ method: 'GET', url: '/api/v1/tasks/22222222-2222-2222-2222-222222222222' });
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  assert.doesNotMatch(res.body, /route="\/api\/v1\/tasks\/11111111/);
  assert.match(res.body, /route="\/api\/v1\/tasks\/:id"/);
});
