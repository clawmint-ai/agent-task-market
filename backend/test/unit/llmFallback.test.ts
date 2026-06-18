// CLAWMIN-43: auto_llm verification must treat LLM-runtime failures (network
// error, non-2xx, unparseable body) as the PLATFORM's fault → manual fallback,
// not the executor's fault → auto-reject + reputation hit. This mirrors the
// auto_tests infra-failure path. Only a successfully parsed score is a verdict.
//
// DB-free unit test: stubs the global fetch, imports only the verification
// service (no db/pool).

import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import { autoVerify } from '../../src/services/verificationService';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.LLM_API_URL;
  delete process.env.LLM_API_KEY;
});

function withLLM() {
  process.env.LLM_API_URL = 'https://llm.example/v1/chat/completions';
  process.env.LLM_API_KEY = 'test-key';
}

const cfg = { mode: 'auto_llm' as const, rubric: 'grade it', pass_threshold: 6 };

test('LLM HTTP 500 → manual fallback (not auto-reject)', async () => {
  withLLM();
  globalThis.fetch = (async () => new Response('upstream boom', { status: 500 })) as typeof fetch;
  const r = await autoVerify(cfg, 'submission', {});
  assert.equal((r.detail as any).fallback, 'manual', 'non-2xx routes to manual review');
  assert.equal(r.passed, false, 'no pass on infra failure');
});

test('LLM network error (fetch rejects) → manual fallback', async () => {
  withLLM();
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  const r = await autoVerify(cfg, 'submission', {});
  assert.equal((r.detail as any).fallback, 'manual', 'network failure routes to manual review');
});

test('LLM 200 with unparseable / missing-fields body → manual fallback', async () => {
  withLLM();
  // 200 OK but no choices[].message.content → parse step fails.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ not: 'what we expect' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  const r = await autoVerify(cfg, 'submission', {});
  assert.equal((r.detail as any).fallback, 'manual', 'unusable body routes to manual review');
  assert.equal(r.passed, false);
});

test('LLM 200 with a valid score ≥ threshold → real pass, no fallback', async () => {
  withLLM();
  const body = { choices: [{ message: { content: JSON.stringify({ score: 8, reasoning: 'good' }) } }] };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  const r = await autoVerify(cfg, 'submission', {});
  assert.equal(r.passed, true, 'score 8 ≥ threshold 6 passes');
  assert.equal((r.detail as any).fallback ?? null, null, 'a real verdict has no manual fallback');
});

test('LLM 200 with a valid score < threshold → real fail, no fallback', async () => {
  withLLM();
  const body = { choices: [{ message: { content: JSON.stringify({ score: 3, reasoning: 'weak' }) } }] };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  const r = await autoVerify(cfg, 'submission', {});
  assert.equal(r.passed, false, 'score 3 < threshold 6 is a genuine fail');
  assert.equal((r.detail as any).fallback ?? null, null, 'genuine fail is NOT a fallback (rep hit applies)');
});

test('LLM not configured → manual fallback (unchanged baseline)', async () => {
  // No LLM_API_URL/KEY set.
  const r = await autoVerify(cfg, 'submission', {});
  assert.equal((r.detail as any).fallback, 'manual', 'missing config still falls back to manual');
});
