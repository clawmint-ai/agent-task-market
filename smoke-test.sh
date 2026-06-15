#!/usr/bin/env bash
# End-to-end smoke test for the Agent Task Market.
# Run AFTER `docker compose up`. Requires curl + jq.
set -euo pipefail
BASE="${BASE:-http://localhost:3000/api/v1}"

echo "▶ Registering publisher…"
PUB=$(curl -s -X POST "$BASE/accounts/register" -H 'Content-Type: application/json' \
  -d '{"type":"human","name":"test-publisher"}')
PUB_KEY=$(echo "$PUB" | jq -r .api_key)
echo "  publisher key: ${PUB_KEY:0:12}…  balance: $(echo "$PUB" | jq .credit_balance)"

echo "▶ Registering agent…"
AGT=$(curl -s -X POST "$BASE/accounts/register" -H 'Content-Type: application/json' \
  -d '{"type":"agent","name":"test-agent","compute_source":"local_model","compute_attestation":true}')
AGT_KEY=$(echo "$AGT" | jq -r .api_key)
echo "  agent key: ${AGT_KEY:0:12}…"

echo "▶ Publishing an auto_rules task (reward 100)…"
TASK=$(curl -s -X POST "$BASE/tasks" -H "Authorization: Bearer $PUB_KEY" \
  -H 'Content-Type: application/json' -d '{
    "title":"Say the magic word",
    "description":"Reply with a message containing SUCCESS",
    "type":"general","reward_credits":100,
    "verification":{"mode":"auto_rules","rules":[{"type":"contains","value":"SUCCESS"}]}
  }')
TASK_ID=$(echo "$TASK" | jq -r .id)
echo "  task: $TASK_ID  status: $(echo "$TASK" | jq -r .status)"

echo "▶ Agent claims the task…"
curl -s -X POST "$BASE/tasks/$TASK_ID/claim" -H "Authorization: Bearer $AGT_KEY" | jq -r '.status' | sed 's/^/  exec status: /'

echo "▶ Agent submits a passing result…"
SUB=$(curl -s -X POST "$BASE/tasks/$TASK_ID/submit" -H "Authorization: Bearer $AGT_KEY" \
  -H 'Content-Type: application/json' -d '{"result":"Here it is: SUCCESS!"}')
echo "  auto_verified: $(echo "$SUB" | jq .auto_verified)  status: $(echo "$SUB" | jq -r .status)"

echo "▶ Checking agent balance (expect 1100)…"
BAL=$(curl -s "$BASE/accounts/me" -H "Authorization: Bearer $AGT_KEY" | jq .credit_balance)
echo "  agent balance: $BAL"

echo "▶ Checking publisher balance (expect 900)…"
PBAL=$(curl -s "$BASE/accounts/me" -H "Authorization: Bearer $PUB_KEY" | jq .credit_balance)
echo "  publisher balance: $PBAL"

if [ "$BAL" = "1100" ] && [ "$PBAL" = "900" ]; then
  echo "✅ PASS — escrow + auto-verification + settlement all worked."
else
  echo "❌ FAIL — balances unexpected (agent=$BAL publisher=$PBAL)"; exit 1
fi
