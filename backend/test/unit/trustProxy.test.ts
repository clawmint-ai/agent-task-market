// CLAWMIN-41: behind a reverse proxy (Caddy in prod), Fastify must read the real
// client IP from X-Forwarded-For — otherwise every IP-keyed rate-limit bucket
// collapses into one and every signup_ip is identical (tripping the same-IP
// self-dealing freeze). TRUST_PROXY controls how many proxy hops to trust.
//
// buildApp reads TRUST_PROXY at construction time, so each case sets the env and
// builds a fresh app. A tiny probe route echoes req.ip; no DB is touched.

import { test } from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../../src/index';

async function appWithTrust(value: string | undefined) {
  if (value === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = value;
  // buildApp re-reads process.env on every call, so a fresh build per case picks
  // up the TRUST_PROXY set above without any module-cache juggling.
  const app = await buildApp({ logger: false });
  app.get('/__ip', async (req: any) => ({ ip: req.ip }));
  await app.ready();
  return app;
}

// One reverse proxy (Caddy) sets X-Forwarded-For to the client IP and forwards
// to the backend — so a single-proxy deployment has exactly ONE hop and XFF
// carries just the client address. TRUST_PROXY=1 trusts that one hop.
const xff = (ip: string) => ({ 'x-forwarded-for': ip });

test('TRUST_PROXY=1 → req.ip is the client from X-Forwarded-For, not the proxy', async () => {
  const app = await appWithTrust('1');
  try {
    const res = await app.inject({ method: 'GET', url: '/__ip', headers: xff('1.2.3.4') });
    assert.equal(JSON.parse(res.body).ip, '1.2.3.4', 'trusts the one Caddy hop → real client IP');
  } finally {
    await app.close();
  }
});

test('TRUST_PROXY=0 → X-Forwarded-For is ignored (req.ip is the socket peer)', async () => {
  const app = await appWithTrust('0');
  try {
    const res = await app.inject({ method: 'GET', url: '/__ip', headers: xff('1.2.3.4') });
    assert.notEqual(JSON.parse(res.body).ip, '1.2.3.4', 'untrusted proxy: XFF is not honored');
  } finally {
    await app.close();
  }
});

test('unset TRUST_PROXY behaves like 0 (no proxy trusted by default)', async () => {
  const app = await appWithTrust(undefined);
  try {
    const res = await app.inject({ method: 'GET', url: '/__ip', headers: xff('9.9.9.9') });
    assert.notEqual(JSON.parse(res.body).ip, '9.9.9.9', 'default trusts nothing');
  } finally {
    await app.close();
  }
});

test('two distinct clients resolve to distinct req.ip → distinct rate-limit buckets (no collapse)', async () => {
  // The economic root cause of the bug: behind a proxy without trustProxy every
  // request's req.ip was the proxy IP, so keyByIp produced ONE bucket for all
  // clients (register limiter throttled everyone together) and one signup_ip for
  // all accounts (same-IP self-deal freeze). With trustProxy on, two different
  // clients resolve to two different req.ip values — the keys keyByIp builds from
  // req.ip can no longer collapse. Asserted purely on req.ip (no DB).
  const { keyByIp } = require('../../src/middleware/rateLimit');
  const app = await appWithTrust('1');
  try {
    const a = await app.inject({ method: 'GET', url: '/__ip', headers: xff('203.0.113.1') });
    const b = await app.inject({ method: 'GET', url: '/__ip', headers: xff('203.0.113.2') });
    const ipA = JSON.parse(a.body).ip;
    const ipB = JSON.parse(b.body).ip;
    assert.equal(ipA, '203.0.113.1');
    assert.equal(ipB, '203.0.113.2');
    assert.notEqual(ipA, ipB, 'distinct clients → distinct req.ip');
    assert.notEqual(keyByIp({ ip: ipA } as any), keyByIp({ ip: ipB } as any), 'distinct limiter buckets');
  } finally {
    await app.close();
  }
});
