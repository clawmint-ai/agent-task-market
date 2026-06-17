// DB-free wiring test for the HTTP RED onResponse hook. Verifies the Fastify
// API contract the hook in index.ts relies on:
//   - req.routeOptions.url is the route TEMPLATE ("/things/:id"), not the
//     concrete path ("/things/42") — so labels stay low-cardinality.
//   - reply.elapsedTime is populated in onResponse.
//   - the /metrics scrape path is excluded (no self-pollution).
// The full buildApp path additionally renders these alongside the DB snapshot;
// that part is exercised by the integration suite (needs Postgres).

import { test } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import { HttpMetrics, normalizeRoute } from '../../src/domain/httpMetrics';

async function appWithHook() {
  const app = Fastify({ logger: false });
  const httpMetrics = new HttpMetrics();
  app.addHook('onResponse', async (req, reply) => {
    if (req.url === '/metrics') return;
    httpMetrics.observe({
      method: req.method,
      route: normalizeRoute(req.routeOptions?.url),
      status: reply.statusCode,
      durationSeconds: reply.elapsedTime / 1000,
    });
  });
  app.get('/things/:id', async () => ({ ok: true }));
  app.get('/metrics', async () => 'scrape');
  return { app, httpMetrics };
}

test('hook records the route template, not the concrete id', async () => {
  const { app, httpMetrics } = await appWithHook();
  await app.inject({ method: 'GET', url: '/things/42' });
  await app.inject({ method: 'GET', url: '/things/99' });
  const out = httpMetrics.render();
  // Both requests collapse to one templated series with count 2.
  assert.match(out, /atm_http_requests_total\{method="GET",route="\/things\/:id",status="200"\} 2/);
  assert.doesNotMatch(out, /route="\/things\/42"/);
  assert.doesNotMatch(out, /route="\/things\/99"/);
  await app.close();
});

test('hook records latency (elapsedTime populated → finite sum)', async () => {
  const { app, httpMetrics } = await appWithHook();
  await app.inject({ method: 'GET', url: '/things/1' });
  const out = httpMetrics.render();
  const m = out.match(/atm_http_request_duration_seconds_sum\{[^}]*\} ([0-9.]+)/);
  assert.ok(m, 'sum line present');
  assert.ok(Number(m[1]) >= 0 && Number.isFinite(Number(m[1])), 'finite non-negative latency');
  await app.close();
});

test('/metrics scrape path is excluded from RED series', async () => {
  const { app, httpMetrics } = await appWithHook();
  await app.inject({ method: 'GET', url: '/metrics' });
  const out = httpMetrics.render();
  assert.doesNotMatch(out, /route="\/metrics"/);
  await app.close();
});

test('unmatched path (404, no route) collapses to one sentinel label', async () => {
  const { app, httpMetrics } = await appWithHook();
  await app.inject({ method: 'GET', url: '/no/such/path/aaa' });
  await app.inject({ method: 'GET', url: '/no/such/path/bbb' });
  const out = httpMetrics.render();
  assert.match(out, /route="__unmatched__"/);
  assert.doesNotMatch(out, /route="\/no\/such\/path/);
  await app.close();
});
