#!/usr/bin/env bash
# Verify the risk-engine self-dealing heuristic is LIVE and correlating by
# accountId (CLAWMIN-10). Run on the box AFTER a deploy:
#   bash scripts/verify-risk-engine.sh
#
# It execs into the backend container (the only thing on the compose network
# that reaches the engine) and replays the real prod path: two DISTINCT account
# ids that share one origin token register, then a finalize of that pair must
# flag `self_dealing_same_ip`. Before the fix the engine keyed observations by
# display name, so this flag never appeared in prod. Exits non-zero on failure.
set -euo pipefail
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

echo "▶ Probing risk-engine self-dealing via the backend container…"
$COMPOSE exec -T backend node <<'NODE'
const base = process.env.RISK_ENGINE_URL;
const key = process.env.RISK_ENGINE_KEY;
if (!base) { console.error('FAIL: RISK_ENGINE_URL not set — backend is on NoopRiskEngine'); process.exit(2); }
const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
const post = (p, b) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) })
  .then(async r => { if (!r.ok) throw new Error(p + ' -> HTTP ' + r.status); return r.json(); });
const sfx = String(process.pid) + '-' + String(process.hrtime.bigint()); // unique per run
const pub = 'verify-pub-' + sfx, exe = 'verify-exe-' + sfx, origin = 'verify-origin-' + sfx;
(async () => {
  await post('/onRegister', { type: 'human', name: 'disp-pub-' + sfx, accountId: pub, ip: origin });
  await post('/onRegister', { type: 'agent', name: 'disp-exe-' + sfx, accountId: exe, ip: origin });
  const d = await post('/onFinalize', { taskId: 't-' + sfx, executionId: 'x-' + sfx, executorId: exe, publisherId: pub, accepted: true, verifiedBy: 'llm' });
  console.log('  finalize ->', JSON.stringify(d));
  const ok = d && d.reviewSample === true && Array.isArray(d.flags) && d.flags.includes('self_dealing_same_ip');
  console.log(ok ? '✅ PASS — self-dealing correlates by accountId (fix live).'
                 : '❌ FAIL — expected reviewSample:true + flags[self_dealing_same_ip].');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('❌ FAIL —', e.message); process.exit(1); });
NODE
