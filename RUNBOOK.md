# RUNBOOK — Agent Task Market

Operational incident response. The top section is the one that matters at 3am:
the credit ledger no longer balances. Everything else can wait.

---

## P0 — `conservation_ok` dropped to 0

**Alert:** `ConservationBroken` (`atm_conservation_ok == 0 for 1m`).
**Meaning:** the immutable credit ledger no longer reconciles with account
balances. For at least one credit class, `Σ(credit_ledger.delta) != Σ(balance
column)`. Credits were created or destroyed **outside** the double-entry
settlement path. This is the single most important invariant in the system
([reconcileService.ts](backend/src/services/reconcileService.ts),
system-deep-analysis §0).

This is a money bug. Treat it like a payment processor would treat a balance
mismatch: **contain first, diagnose second.**

### 1. Confirm it's real (not a scrape race)

The metric is sampled live; a single scrape mid-settlement could in theory catch
an in-flight write. The `for: 1m` already debounces this, but confirm with the
authoritative read-only check:

```bash
# Authoritative reconcile (read-only, safe on live DB). 200 = balanced, 409 = broken.
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" \
  https://market.clawmint.space/admin/reconcile | jq .
```

Look at the report:

```jsonc
{
  "ok": false,
  "earned": { "ledgerSum": 1230, "balanceSum": 1250, "diff": -20 },  // ← which class
  "gift":   { "ledgerSum": 1000, "balanceSum": 1000, "diff": 0 },
  "total":  { "ledgerSum": 2230, "balanceSum": 2250, "diff": -20 }
}
```

The class with `diff != 0` localizes the leak. `diff < 0` = balances exceed the
ledger (credits conjured). `diff > 0` = ledger exceeds balances (credits lost).

If the reconcile returns `ok: true`, it was a transient scrape artifact — the
alert will clear on the next evaluation. Note it and move on.

### 2. Contain

If the discrepancy is real and growing, stop the bleeding before debugging:

- **Freeze the money-moving paths.** The fault is in a settlement write
  ([backend/src/services/task/settlement.ts](backend/src/services/task/settlement.ts)
  and the task lifecycle). If a recent deploy introduced it, **roll back**:
  ```bash
  # On the box: pin to the last known-good commit and redeploy.
  git -C "$DEPLOY_PATH" log --oneline -10
  git -C "$DEPLOY_PATH" reset --hard <last-good-sha>
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
  ```
- If no recent deploy correlates, the cause is data/state, not code. Do **not**
  manually edit balances — that destroys the audit trail. Capture evidence first.

### 3. Diagnose

The ledger is the source of truth; balances are the derived view. Find the
settlement event whose delta didn't land in (or double-counted into) a balance:

```bash
# Recent ledger entries for the affected class (adjust class/limit):
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT id, account_id, delta, credit_class, reason, created_at
     FROM credit_ledger
    WHERE credit_class = 'earned'
    ORDER BY created_at DESC LIMIT 50;"
```

Common root causes, in order of likelihood:
- A settlement wrote a balance update without a matching ledger row, or vice
  versa (the two must be in **one transaction** — check for a split commit).
- A refund/rollback path that adjusts balance but not ledger (or wrong class —
  earned/gift must be preserved across refunds; see [CLAWMIN-19] isolation).
- A direct `UPDATE accounts SET ... balance` somewhere outside the ledger path.

Cross-check against `atm_conservation_diff{class=...}` on the Grafana dashboard
("Agent Task Market — Ledger & Flow") — the **trend** shows whether it was a
one-time jump (single bad event) or a steady drift (a path leaking every call).

### 4. Recover

Once the faulty code is rolled back / fixed and deployed:
- Re-run `/admin/reconcile`. If the historical discrepancy persists (the bad
  events already happened), reconstruct the correct balances **from the ledger**
  — the ledger is immutable truth — via a reviewed, transactional migration. Never
  hand-edit to "make it balance".
- Confirm `atm_conservation_ok` returns to 1 and the alert resolves.
- Write a postmortem: which path, which deploy, how many credits, who was affected.

---

## P1 — `BackendDown` (`up{job="atm-backend"} == 0 for 2m`)

Prometheus can't scrape `backend:3000/metrics`. **While this fires, conservation
is unmonitored** — so it's urgent even though no ledger break is proven.

Checklist:
- `docker compose ps` — is `backend` up and `(healthy)`? If unhealthy, `autoheal`
  should restart it within ~5s; if it's crash-looping, check `docker compose logs
  backend`.
- Token mismatch: if `METRICS_TOKEN` is set on the backend, Prometheus must send
  the same value. A 401 on the scrape also shows as `up=0`. Verify the env passed
  to the `prometheus` service matches the backend's, then
  `docker compose -f ... -f docker-compose.monitoring.yml up -d prometheus`.
- Network: confirm Prometheus and backend are on the same compose project/network
  (`docker network inspect <project>_default`).

---

## Running the monitoring stack

Prometheus + Alertmanager + Grafana live in
[docker-compose.monitoring.yml](docker-compose.monitoring.yml), layered on top of
the app stack so they share its network and reach `backend` by service name.

```bash
# Local (against the demo stack):
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d

# Production (alongside the prod overlay):
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
               -f docker-compose.monitoring.yml up -d
```

UIs bind to **localhost only** (reach them via SSH tunnel, not the public net):

| Service       | URL                     | Notes |
|---------------|-------------------------|-------|
| Prometheus    | http://localhost:9090   | Targets at `/targets`, alerts at `/alerts` |
| Alertmanager  | http://localhost:9093   | Silences, routing |
| Grafana       | http://localhost:3001   | Dashboard auto-provisioned; login `GRAFANA_ADMIN_*` |

Relevant env (set in `.env`):
- `METRICS_TOKEN` — if set on the backend, set the **same** value here so the
  scrape authenticates.
- `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` — change from `admin/admin`
  for any non-local use.

Wire a real alert destination by uncommenting the PagerDuty/Slack block in
[monitoring/alertmanager.yml](monitoring/alertmanager.yml) and supplying the
routing key / webhook via a mounted secret file (never commit it).

---

## Testing the conservation alert (staging)

The acceptance criterion is: force `conservation_ok=0` in staging and confirm the
alert fires within ~2 minutes (1m `for:` + scrape/eval interval).

Safely break conservation on a **staging** DB by inserting a ledger row with no
matching balance change (read the warning below):

```bash
# STAGING ONLY. This deliberately breaks the money invariant.
# Inserts a ledger row with no matching balance change, so Σ(ledger) drifts off
# Σ(balances). id has no default and balance_after is NOT NULL, so supply both.
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "INSERT INTO credit_ledger (id, account_id, delta, balance_after, credit_class, reason)
   SELECT gen_random_uuid(), id, 1, earned_balance, 'earned', 'ALERT-TEST-do-not-ship'
     FROM accounts LIMIT 1;"
```

Then watch:
1. `curl -s -H "X-Admin-Token: $ADMIN_TOKEN" .../admin/reconcile` → `ok:false`, 409.
2. Prometheus `/alerts` → `ConservationBroken` goes **Pending** (during the 1m
   `for:`) then **Firing**.
3. Alertmanager `/#/alerts` shows it routed to the `pager` receiver.

**Revert immediately** (delete the test row; never let it reach prod):

```bash
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "DELETE FROM credit_ledger WHERE reason = 'ALERT-TEST-do-not-ship';"
```

`atm_conservation_ok` returns to 1 and the alert resolves on the next eval.

> Do this **only** on a throwaway staging DB. Inserting an unbacked ledger row on
> production *is* the P0 incident this runbook exists to handle.

[CLAWMIN-19]: https://linear.app/clawmint/issue/CLAWMIN-19
