// CLAWMIN-41: behind a reverse proxy (Caddy in prod), Fastify must read the real
// client IP from X-Forwarded-For — otherwise every IP-keyed rate-limit bucket
// collapses into one and every signup_ip is identical (tripping the same-IP
// self-dealing freeze). TRUST_PROXY controls how many proxy hops to trust.
//
// Pure unit test: exercises the exported trustProxy() parser directly, and the
// real Fastify XFF resolution via a BARE Fastify instance — no buildApp, so no
// @fastify/static, DB pool, or routes are loaded (keeps this DB-free and
// import-safe in CI, matching the unit-test contract).

import { test } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import { trustProxy } from '../../src/index';
import { keyByIp } from '../../src/middleware/rateLimit';

// Build a bare app whose trustProxy is computed from TRUST_PROXY the same way
// buildApp does (trustProxy() reads process.env on each call).
async function bareApp(value: string | undefined) {
  if (value === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = value;
  const app = Fastify({ logger: false, trustProxy: trustProxy() });
  app.get('/__ip', async (req) => ({ ip: req.ip }));
  await app.ready();
  return app;
}

// One reverse proxy (Caddy) sets X-Forwarded-For to the client IP — a
// single-proxy deployment has exactly one hop, so XFF carries just the client.
const xff = (ip: string) => ({ 'x-forwarded-for': ip });

test('trustProxy() parser: unset/0/false → false; N≥1 → N; non-numeric → verbatim', () => {
  delete process.env.TRUST_PROXY;
  assert.equal(trustProxy(), false, 'unset → false');
  process.env.TRUST_PROXY = '0';
  assert.equal(trustProxy(), false, '0 → false');
  process.env.TRUST_PROXY = '1';
  assert.equal(trustProxy(), 1, '1 → 1');
  process.env.TRUST_PROXY = '2';
  assert.equal(trustProxy(), 2, '2 → 2');
  process.env.TRUST_PROXY = 'false';
  assert.equal(trustProxy(), false, '"false" → false');
  process.env.TRUST_PROXY = 'true';
  assert.equal(trustProxy(), true, '"true" → true');
  process.env.TRUST_PROXY = '10.0.0.0/8';
  assert.equal(trustProxy(), '10.0.0.0/8', 'CIDR passed through verbatim');
  delete process.env.TRUST_PROXY;
});

test('TRUST_PROXY=1 → req.ip is the client from X-Forwarded-For, not the proxy', async () => {
  const app = await bareApp('1');
  try {
    const res = await app.inject({ method: 'GET', url: '/__ip', headers: xff('1.2.3.4') });
    assert.equal(JSON.parse(res.body).ip, '1.2.3.4', 'trusts the one Caddy hop → real client IP');
  } finally {
    await app.close();
  }
});

test('TRUST_PROXY=0 → X-Forwarded-For is ignored (req.ip is the socket peer)', async () => {
  const app = await bareApp('0');
  try {
    const res = await app.inject({ method: 'GET', url: '/__ip', headers: xff('1.2.3.4') });
    assert.notEqual(JSON.parse(res.body).ip, '1.2.3.4', 'untrusted proxy: XFF is not honored');
  } finally {
    await app.close();
  }
});

test('unset TRUST_PROXY behaves like 0 (no proxy trusted by default)', async () => {
  const app = await bareApp(undefined);
  try {
    const res = await app.inject({ method: 'GET', url: '/__ip', headers: xff('9.9.9.9') });
    assert.notEqual(JSON.parse(res.body).ip, '9.9.9.9', 'default trusts nothing');
  } finally {
    await app.close();
  }
});

test('two distinct clients resolve to distinct req.ip → distinct rate-limit buckets (no collapse)', async () => {
  // The economic root cause: behind a proxy without trustProxy every req.ip was
  // the proxy IP, so keyByIp produced ONE bucket for all clients (register
  // limiter throttled everyone together) and one signup_ip for all accounts.
  // With trustProxy on, two clients resolve to distinct req.ip → keyByIp keys
  // can no longer collapse. Asserted purely on req.ip (no DB).
  const app = await bareApp('1');
  try {
    const a = await app.inject({ method: 'GET', url: '/__ip', headers: xff('203.0.113.1') });
    const b = await app.inject({ method: 'GET', url: '/__ip', headers: xff('203.0.113.2') });
    const ipA = JSON.parse(a.body).ip;
    const ipB = JSON.parse(b.body).ip;
    assert.equal(ipA, '203.0.113.1');
    assert.equal(ipB, '203.0.113.2');
    assert.notEqual(keyByIp({ ip: ipA } as any), keyByIp({ ip: ipB } as any), 'distinct limiter buckets');
  } finally {
    await app.close();
  }
});
