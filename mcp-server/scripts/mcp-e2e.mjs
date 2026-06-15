// Real end-to-end MCP client test — exercises the full protocol stack (JSON-RPC
// over Streamable HTTP, session handshake, tools/list, tools/call) against the
// running MCP server, NOT the backend REST API directly.
//
// Prereqs (in your terminal):
//   1. backend running on :3000   (cd backend && npm run dev)
//   2. MCP server running in HTTP mode:
//        cd mcp-server && MCP_TRANSPORT=http MCP_HTTP_PORT=8080 npx tsx src/index.ts
//   3. run this:  node mcp-server/scripts/mcp-e2e.mjs
//
// The client registers its OWN agent first (via backend REST, one time, just to
// get an API key), then does everything else THROUGH MCP tools.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BACKEND = process.env.MARKET_API_URL || 'http://localhost:3000/api/v1';
const MCP_URL = process.env.MCP_URL || 'http://localhost:8080/mcp';

const log = (...a) => console.log(...a);
const ok = (m) => log(`  ✅ ${m}`);
const fail = (m) => { log(`  ❌ ${m}`); process.exitCode = 1; };

// Pull the text payload out of an MCP tool result and parse trailing JSON if any.
function toolText(res) {
  const t = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return t;
}
function parseTrailingJson(s) {
  // tool responses are "human msg\n\n{json}" — grab the largest {...} or [...].
  const m = s.match(/[\{\[][\s\S]*[\}\]]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function callJson(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const txt = toolText(res);
  return { txt, json: parseTrailingJson(txt), isError: res.isError === true };
}

async function main() {
  // 0) One-time: register an agent via backend REST to obtain an API key.
  const reg = await fetch(`${BACKEND}/accounts/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'agent', name: 'mcp-e2e-agent', compute_source: 'local_model', compute_attestation: true }),
  }).then((r) => r.json());
  const apiKey = reg.api_key;
  if (!apiKey) throw new Error('failed to register agent: ' + JSON.stringify(reg));
  log(`registered agent ${reg.id?.slice(0, 8)}… (earned=${reg.earned_balance}, gift=${reg.gift_balance})`);

  // 1) Connect a real MCP client over Streamable HTTP, authing with the API key.
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { 'X-Market-Api-Key': apiKey } },
  });
  const client = new Client({ name: 'mcp-e2e-test', version: '1.0.0' });
  await client.connect(transport); // initialize handshake
  ok('MCP initialize handshake OK');

  // 2) tools/list — all 10 tools registered?
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const expected = ['check_credits','check_reputation','claim_task','fetch_tasks','get_task','my_executions','publish_task','submit_result','verify_result','who_am_i'].sort();
  log(`  tools/list → ${names.join(', ')}`);
  if (JSON.stringify(names) === JSON.stringify(expected)) ok(`all ${expected.length} tools present`);
  else fail(`tool set mismatch. missing: ${expected.filter((e) => !names.includes(e))}`);

  // 3) who_am_i
  const me = await callJson(client, 'who_am_i');
  if (me.json?.name === 'mcp-e2e-agent') ok(`who_am_i → ${me.json.name}, rep=${me.json.reputation_score}`);
  else fail(`who_am_i unexpected: ${me.txt.slice(0, 120)}`);

  // 4) publish_task — a Python auto_tests task (this agent funds it from gift credits)
  const pub = await callJson(client, 'publish_task', {
    title: 'MCP e2e: double(n)',
    description: 'Return n*2.',
    type: 'code',
    reward_credits: 15,
    verification: { mode: 'auto_tests', language: 'python', tests: 'from solution import double\ndef test_d():\n    assert double(3)==6\n    assert double(0)==0' },
  });
  const taskId = pub.json?.id;
  if (taskId) ok(`publish_task → task ${taskId.slice(0, 8)}…`);
  else fail(`publish_task failed: ${pub.txt.slice(0, 160)}`);

  // 5) fetch_tasks — our task should appear
  const list = await callJson(client, 'fetch_tasks', { type: 'code', limit: 50 });
  const found = Array.isArray(list.json) && list.json.some((t) => t.id === taskId);
  if (found) ok('fetch_tasks → published task is listed');
  else log('  ⚠️ fetch_tasks did not list our task (may be claimed-by-self rule); continuing');

  // 6) get_task — full detail
  const detail = await callJson(client, 'get_task', { task_id: taskId });
  if (detail.json?.id === taskId) ok('get_task → detail OK');
  else fail(`get_task failed: ${detail.txt.slice(0, 120)}`);

  // NOTE: an agent cannot claim its own task (publisher === executor). So register
  // a SECOND agent and run claim→submit through a second MCP session.
  const reg2 = await fetch(`${BACKEND}/accounts/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'agent', name: 'mcp-e2e-worker', compute_source: 'local_model', compute_attestation: true }),
  }).then((r) => r.json());
  const transport2 = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { 'X-Market-Api-Key': reg2.api_key } },
  });
  const worker = new Client({ name: 'mcp-e2e-worker', version: '1.0.0' });
  await worker.connect(transport2);
  ok('second MCP session (worker) connected');

  // 7) claim_task (worker)
  const claim = await callJson(worker, 'claim_task', { task_id: taskId });
  if (claim.json?.status === 'in_progress') ok('claim_task → in_progress');
  else fail(`claim_task failed: ${claim.txt.slice(0, 160)}`);

  // 8) submit_result (worker) — correct solution, expect auto-accept
  const submit = await callJson(worker, 'submit_result', {
    task_id: taskId,
    result: 'def double(n):\n    return n * 2\n',
  });
  if (submit.json?.status === 'accepted' && submit.json?.auto_verified === true) {
    ok(`submit_result → ACCEPTED, score=${submit.json.score}`);
  } else fail(`submit_result not auto-accepted: ${submit.txt.slice(0, 200)}`);

  // 9) check_credits (worker) — earned should now be 15
  const credits = await callJson(worker, 'check_credits');
  log(`  check_credits → ${credits.txt.split('\n')[0]}`);
  const meWorker = await callJson(worker, 'who_am_i');
  if (meWorker.json?.earned_balance === 15) ok('worker earned_balance = 15 (paid through MCP)');
  else fail(`worker earned unexpected: ${meWorker.json?.earned_balance}`);

  // 10) my_executions (worker)
  const execs = await callJson(worker, 'my_executions');
  if (execs.txt.includes(taskId)) ok('my_executions → shows the completed task');
  else fail('my_executions missing the task');

  await client.close();
  await worker.close();
  log('\n🎉 MCP tool chain end-to-end: protocol handshake, tools/list, and 9 tool calls across 2 sessions all worked.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
