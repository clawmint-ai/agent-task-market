// Flywheel economic proof — runs the full loop THROUGH MCP TOOLS and asserts the
// two invariants a skeptic asks first:
//   (1) Value is conserved — no credits minted from nothing. The publisher's gift
//       balance drops by exactly the bounty; the winning worker's EARNED balance
//       rises by exactly the same; a rejected attempt nets zero (escrow refunded).
//   (2) Wrong answers earn nothing — a failing submission is auto-rejected and the
//       worker is paid 0, while the bounty is refunded and the task reopens.
//
// This complements mcp-e2e.mjs (which proves the protocol/toolchain works). Here we
// prove the LEDGER behaves. Everything below the one-time key registration goes
// through MCP tool calls, exactly as a real agent would.
//
// Prereqs (easiest: the compose stack from `docker compose up --build`):
//   backend on :3000, MCP server on :8080.  Then:  node mcp-server/scripts/flywheel-proof.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BACKEND = process.env.MARKET_API_URL || 'http://localhost:3000/api/v1';
const MCP_URL = process.env.MCP_URL || 'http://localhost:8080/mcp';
const BOUNTY = 15;

const log = (...a) => console.log(...a);
const ok = (m) => log(`  ✅ ${m}`);
let failed = false;
const fail = (m) => { log(`  ❌ ${m}`); failed = true; };

function toolText(res) {
  return (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}
function parseTrailingJson(s) {
  const m = s.match(/[\{\[][\s\S]*[\}\]]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
async function callJson(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const txt = toolText(res);
  return { txt, json: parseTrailingJson(txt), isError: res.isError === true };
}

// Register an agent via backend REST (one time, to mint an API key), then open an
// MCP session authed with that key. Returns { id, key, client, reg }.
async function newAgent(name) {
  const reg = await fetch(`${BACKEND}/accounts/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'agent', name, compute_source: 'local_model', compute_attestation: true }),
  }).then((r) => r.json());
  if (!reg.api_key) throw new Error(`register ${name} failed: ${JSON.stringify(reg)}`);
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { 'X-Market-Api-Key': reg.api_key } },
  });
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(transport);
  return { id: reg.id, key: reg.api_key, client, reg };
}

// Read (earned, gift) for an agent through the who_am_i MCP tool.
async function balances(agent) {
  const me = await callJson(agent.client, 'who_am_i');
  return { earned: me.json?.earned_balance ?? NaN, gift: me.json?.gift_balance ?? NaN };
}

async function main() {
  log('— Flywheel economic proof (through MCP tools) —\n');

  const publisher = await newAgent(`proof-publisher-${Date.now()}`);
  const good = await newAgent(`proof-worker-good-${Date.now()}`);
  const bad = await newAgent(`proof-worker-bad-${Date.now()}`);
  ok('three MCP sessions connected (publisher, good worker, bad worker)');

  const pub0 = await balances(publisher);
  const good0 = await balances(good);
  const bad0 = await balances(bad);
  log(`  start: publisher gift=${pub0.gift} | good earned=${good0.earned} | bad earned=${bad0.earned}`);

  // ── publish: an auto_tests task. Escrow is taken from the publisher immediately. ──
  const pub = await callJson(publisher.client, 'publish_task', {
    title: `Flywheel proof: triple(n) ${Date.now()}`,
    description: 'Return n*3.',
    type: 'code',
    reward_credits: BOUNTY,
    verification: {
      mode: 'auto_tests',
      language: 'python',
      tests: 'from solution import triple\ndef test_t():\n    assert triple(2)==6\n    assert triple(0)==0',
    },
  });
  const taskId = pub.json?.id;
  if (!taskId) return fail(`publish_task failed: ${pub.txt.slice(0, 200)}`);
  ok(`published task ${taskId.slice(0, 8)}… (escrowed ${BOUNTY})`);

  const pubAfterEscrow = await balances(publisher);
  if (pubAfterEscrow.gift === pub0.gift - BOUNTY) ok(`escrow held: publisher gift ${pub0.gift} → ${pubAfterEscrow.gift}`);
  else fail(`escrow wrong: expected ${pub0.gift - BOUNTY}, got ${pubAfterEscrow.gift}`);

  // ── leg 1: BAD worker claims + submits a WRONG answer → auto-rejected, refund. ──
  const badClaim = await callJson(bad.client, 'claim_task', { task_id: taskId });
  if (badClaim.json?.status === 'in_progress') ok('bad worker claimed');
  else return fail(`bad claim failed: ${badClaim.txt.slice(0, 160)}`);

  const badSubmit = await callJson(bad.client, 'submit_result', {
    task_id: taskId,
    result: 'def triple(n):\n    return n * 2\n', // wrong on purpose
  });
  if (badSubmit.json?.auto_verified === true && badSubmit.json?.status !== 'accepted') {
    ok(`wrong answer auto-REJECTED (status=${badSubmit.json.status})`);
  } else fail(`expected rejection, got: ${badSubmit.txt.slice(0, 200)}`);

  const badAfter = await balances(bad);
  if (badAfter.earned === bad0.earned) ok(`bad worker earned nothing (still ${badAfter.earned})`);
  else fail(`bad worker was paid for a wrong answer! ${bad0.earned} → ${badAfter.earned}`);

  const pubAfterRefund = await balances(publisher);
  if (pubAfterRefund.gift === pub0.gift) ok(`bounty refunded on rejection: publisher gift back to ${pubAfterRefund.gift}`);
  else fail(`refund wrong: expected ${pub0.gift}, got ${pubAfterRefund.gift}`);

  // ── leg 2: GOOD worker claims the reopened task + submits a CORRECT answer → paid. ──
  const goodClaim = await callJson(good.client, 'claim_task', { task_id: taskId });
  if (goodClaim.json?.status === 'in_progress') ok('good worker claimed the reopened task');
  else return fail(`good claim failed (did the task reopen?): ${goodClaim.txt.slice(0, 160)}`);

  const goodSubmit = await callJson(good.client, 'submit_result', {
    task_id: taskId,
    result: 'def triple(n):\n    return n * 3\n',
  });
  if (goodSubmit.json?.status === 'accepted' && goodSubmit.json?.auto_verified === true) {
    ok(`correct answer ACCEPTED (score=${goodSubmit.json.score})`);
  } else return fail(`expected acceptance, got: ${goodSubmit.txt.slice(0, 200)}`);

  // ── final conservation check ──────────────────────────────────────────────────
  const pubF = await balances(publisher);
  const goodF = await balances(good);
  const badF = await balances(bad);
  log(`\n  end:   publisher gift=${pubF.gift} | good earned=${goodF.earned} | bad earned=${badF.earned}`);

  const publisherPaid = pub0.gift - pubF.gift;          // should be exactly BOUNTY
  const workerGained = goodF.earned - good0.earned;     // should be exactly BOUNTY
  if (publisherPaid === BOUNTY) ok(`publisher paid exactly ${BOUNTY} (gift, non-redeemable in → earned out)`);
  else fail(`publisher delta ${publisherPaid} ≠ ${BOUNTY}`);
  if (workerGained === BOUNTY) ok(`good worker earned exactly ${BOUNTY} (redeemable)`);
  else fail(`good worker delta ${workerGained} ≠ ${BOUNTY}`);
  if (publisherPaid === workerGained) ok('CONSERVED: credits out of publisher == credits into worker, none minted');
  else fail(`NOT conserved: ${publisherPaid} paid ≠ ${workerGained} earned`);
  if (goodF.gift === good0.gift) ok('payout landed in EARNED, not gift (redeemable/non-redeemable kept separate)');
  else fail(`payout leaked into gift balance: ${good0.gift} → ${goodF.gift}`);

  await Promise.all([publisher.client.close(), good.client.close(), bad.client.close()]);

  if (failed) { log('\n❌ FAIL — an invariant did not hold (see above).'); process.exit(1); }
  log('\n🎉 PASS — full flywheel through MCP: escrow → reject+refund → accept+pay, value conserved, wrong answers paid nothing.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
