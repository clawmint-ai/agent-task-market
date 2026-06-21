# Design — Externalize Telegram from the open-source alertmanager.yml (CLAWMIN-49)

**Date:** 2026-06-21
**Status:** Approved, pre-implementation
**Scope:** Block B of the review-queue work. Block A (review-flags CLI) shipped as CLAWMIN-48.

## Problem

When monitoring alerting was wired up (CLAWMIN-10, PRs #43–#47), `monitoring/alertmanager.yml`
was hardcoded to Telegram: `telegram_configs`, an `__CHAT_ID__` placeholder rendered inline
by the container entrypoint, and `bot_token_file`. These files live in the monitoring overlay
of the **open-source AGPL repo**.

This bakes **clawmint's own operational channel choice (Telegram)** into a generic, public
deployment config. Anyone who clones the repo gets a Telegram-specific `alertmanager.yml`; a
Slack/PagerDuty/Opsgenie user must rewrite it. This is in tension with the project's
consistent three-layer separation:

- **Open-source core** (`backend/src`) — generic; exposes only standard Prometheus `/metrics`.
  Already clean; Telegram never touched it.
- **Private risk-engine** — separate private repo.
- **Operational config** — should be externalized, not baked into the generic layer.

`alerts.yml` / `prometheus.yml` (generic monitoring logic, alert rules) staying in the
open-source repo is a reasonable reference deployment. But the **channel wiring** should not
be the open-source default.

## Decision (option a — keep Telegram in-repo as an explicit optional overlay)

Provide both in the open-source repo:
- a **channel-agnostic default** `alertmanager.yml` (works out of the box, no secrets), and
- an **explicit optional Telegram overlay** (clawmint's choice, opt-in, not default).

Rejected — option b (move Telegram wiring to a private ops layer): cleanest boundary but
introduces cross-repo deployment and a second file source on the box. Not worth the
complexity; the Telegram config contains no secrets (those stay in `monitoring/secrets/` via
files), so keeping it in-repo as opt-in preserves the "core stays generic" principle without
cross-repo overhead.

## Constraint

**Production currently uses this Telegram alert chain** (verified FIRING + RESOLVED). The
migration must not blind prod. Rollback must be a single step.

## Components

### 1. `monitoring/alertmanager.yml` → revert to channel-agnostic (open-source default)

Restore the pre-#43 shape (commit `24e39bb`): `default` + `pager` receivers, a no-op webhook
default, and commented Slack/PagerDuty placeholders. No Telegram fields, no `__CHAT_ID__`.
Keeps the routing tree, severity split, and inhibit rules (those are generic and valuable).
Any cloner gets a working, channel-neutral template.

### 2. `monitoring/alertmanager.telegram.yml` → new, clawmint's Telegram receivers

The Telegram receiver content currently in `alertmanager.yml` moves here verbatim:
`telegram` / `telegram-critical` receivers with `bot_token_file` + `__CHAT_ID__`, the
HTML message templates, and a `route` that targets them. This is a **complete** alertmanager
config (route + receivers + inhibit rules), because the Telegram overlay swaps the whole
config file (see component 3), not merges YAML fragments. Labeled clearly as an optional
operational example. Contains no secrets (token/chat_id come from files).

### 3. `docker-compose.monitoring.telegram.yml` → new, optional overlay

Overrides only the `alertmanager` service to:
- mount `alertmanager.telegram.yml` (instead of the default `alertmanager.yml`),
- keep the existing entrypoint (renders `__CHAT_ID__` from the secret file),
- mount `monitoring/secrets`.

When this overlay is NOT composed, the base `docker-compose.monitoring.yml` runs alertmanager
with the channel-agnostic default config (no-op webhook) — the stack still boots, alerts fire
internally but deliver nowhere. When it IS composed, Telegram delivery is active.

**Base `docker-compose.monitoring.yml` change:** the alertmanager service's custom entrypoint
(chat_id rendering) and secrets mount move OUT of the base into the telegram overlay. The base
alertmanager reverts to the plain `--config.file` command form (no entrypoint, no secrets
mount) — matching the channel-agnostic default that needs neither.

### 4. `.github/workflows/deploy.yml` → add the 4th `-f`

Both the `pull` and `up -d` lines gain `-f docker-compose.monitoring.telegram.yml`, so
auto-deploy keeps Telegram delivery active on the box. Without this, the next deploy would run
alertmanager on the no-op default and silently stop delivering — the exact blinding failure
mode #47 fixed for orphan-removal. Comment explains why the 4th overlay is load-bearing.

### 5. Docs

- `monitoring/secrets/README.md` — unchanged in substance (still drops the two files); note
  that Telegram is now an opt-in overlay.
- `docs/deploy.md` — monitoring section: explain the channel-agnostic default vs the optional
  Telegram overlay, and that clawmint's prod enables the latter via the 4th `-f`.

## Migration order (prod stays connected)

1. Merge → auto-deploy runs with all 4 overlays (including the new telegram one).
2. alertmanager comes up rendering `alertmanager.telegram.yml` — same delivery as today.
3. Verify: send a test alert (amtool), confirm Telegram still gets FIRING + RESOLVED.
4. **Rollback:** drop the 4th `-f` → alertmanager falls back to the no-op default. Alerts
   still fire internally (visible in the `:9093` / `:9090` UIs) but don't deliver — not a
   crash, just silent delivery. Safe, reversible.

## Testing / verification

- `docker compose ... config -q` over all 4 overlays parses (CI's merged-overlay check from
  #47 covers base+prod+monitoring; extend it or add the telegram overlay to that check).
- Local: `sed` render of `alertmanager.telegram.yml` with a sample chat_id parses as valid
  alertmanager YAML (same check used in #44).
- Box: amtool test alert delivers to Telegram (FIRING + RESOLVED) after deploy.

## Out of scope

- Any change to alert rules (`alerts.yml`) or scrape config (`prometheus.yml`) — those are
  generic and stay as-is.
- Moving Telegram config to a private repo (option b, rejected).
- The review-flags CLI (CLAWMIN-48, already shipped).
