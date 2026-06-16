import { test } from 'node:test';
import assert from 'node:assert';
import { RemoteRiskEngine } from '../../src/risk/remote';
import type { RegisterCtx, FinalizeCtx } from '../../src/risk/types';

// ── fetch mock ──────────────────────────────────────────────────────────────
// RemoteRiskEngine calls the global fetch; we swap it per-test and record calls.
type FetchCall = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;

function installFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function restore() {
  globalThis.fetch = realFetch;
}

const REGISTER: RegisterCtx = { type: 'agent', name: 'a-1', ip: '1.2.3.4' };

// ── happy path ────────────────────────────────────────────────────────────────
test('parses a RiskDecision and hits POST {baseUrl}/{hook}', async () => {
  const calls = installFetch(async () => jsonResponse({ allow: true, reason: 'ok' }));
  try {
    const engine = new RemoteRiskEngine('http://risk:9000', undefined, 2000);
    const d = await engine.onRegister(REGISTER);
    assert.equal(d.allow, true);
    assert.equal(d.reason, 'ok');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://risk:9000/onRegister');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal((calls[0].init.headers as any)['Content-Type'], 'application/json');
    assert.equal(calls[0].init.body, JSON.stringify(REGISTER));
  } finally {
    restore();
  }
});

test('allow:false is a VALID decision — it must NOT throw', async () => {
  installFetch(async () => jsonResponse({ allow: false, reason: 'sybil_cluster', flags: ['s'] }));
  try {
    const engine = new RemoteRiskEngine('http://risk:9000');
    const d = await engine.onRegister(REGISTER);
    assert.equal(d.allow, false, 'a rejection is data, not an error');
    assert.deepEqual(d.flags, ['s']);
  } finally {
    restore();
  }
});

test('each hook targets its own path', async () => {
  const calls = installFetch(async () => jsonResponse({ allow: true }));
  try {
    const engine = new RemoteRiskEngine('http://risk:9000');
    await engine.onClaim({ taskId: 't', executorId: 'e', publisherId: 'p' });
    await engine.onPublish({ publisherId: 'p', rewardCredits: 5, type: 'code', verificationMode: 'auto_tests' });
    const fin: FinalizeCtx = { taskId: 't', executionId: 'x', executorId: 'e', publisherId: 'p', accepted: true, verifiedBy: 'llm' };
    await engine.onFinalize(fin);
    assert.deepEqual(
      calls.map((c) => c.url),
      ['http://risk:9000/onClaim', 'http://risk:9000/onPublish', 'http://risk:9000/onFinalize'],
    );
  } finally {
    restore();
  }
});

// ── auth header ───────────────────────────────────────────────────────────────
test('sends Bearer auth when apiKey is set', async () => {
  const calls = installFetch(async () => jsonResponse({ allow: true }));
  try {
    await new RemoteRiskEngine('http://risk:9000', 'secret-key').onRegister(REGISTER);
    assert.equal((calls[0].init.headers as any).Authorization, 'Bearer secret-key');
  } finally {
    restore();
  }
});

test('omits Authorization header when no apiKey', async () => {
  const calls = installFetch(async () => jsonResponse({ allow: true }));
  try {
    await new RemoteRiskEngine('http://risk:9000', undefined).onRegister(REGISTER);
    assert.equal((calls[0].init.headers as any).Authorization, undefined);
  } finally {
    restore();
  }
});

// ── URL normalization ───────────────────────────────────────────────────────
test('trailing slash on baseUrl does not produce a double slash', async () => {
  const calls = installFetch(async () => jsonResponse({ allow: true }));
  try {
    await new RemoteRiskEngine('http://risk:9000///').onRegister(REGISTER);
    assert.equal(calls[0].url, 'http://risk:9000/onRegister');
  } finally {
    restore();
  }
});

// ── failure → THROW (so call sites apply fail-open / fail-closed) ─────────────
test('non-2xx response throws (does not silently allow)', async () => {
  installFetch(async () => jsonResponse({ allow: true }, 500));
  try {
    const engine = new RemoteRiskEngine('http://risk:9000');
    await assert.rejects(() => engine.onRegister(REGISTER), /HTTP 500/);
  } finally {
    restore();
  }
});

test('body missing a boolean "allow" throws', async () => {
  installFetch(async () => jsonResponse({ reason: 'no allow field' }));
  try {
    const engine = new RemoteRiskEngine('http://risk:9000');
    await assert.rejects(() => engine.onRegister(REGISTER), /missing boolean "allow"/);
  } finally {
    restore();
  }
});

test('a non-boolean allow (e.g. "true" string) throws', async () => {
  installFetch(async () => jsonResponse({ allow: 'true' }));
  try {
    const engine = new RemoteRiskEngine('http://risk:9000');
    await assert.rejects(() => engine.onRegister(REGISTER), /missing boolean "allow"/);
  } finally {
    restore();
  }
});

test('transport rejection (timeout/unreachable) propagates as a throw', async () => {
  installFetch(async () => {
    throw new Error('The operation was aborted due to timeout');
  });
  try {
    const engine = new RemoteRiskEngine('http://risk:9000', undefined, 1);
    await assert.rejects(() => engine.onRegister(REGISTER), /aborted due to timeout/);
  } finally {
    restore();
  }
});

test('passes an AbortSignal so the request is bounded', async () => {
  const calls = installFetch(async () => jsonResponse({ allow: true }));
  try {
    await new RemoteRiskEngine('http://risk:9000').onRegister(REGISTER);
    assert.ok(calls[0].init.signal instanceof AbortSignal, 'a timeout signal must be attached');
  } finally {
    restore();
  }
});
