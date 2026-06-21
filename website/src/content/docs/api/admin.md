---
title: Admin & ops API
description: Reconcile and risk-flag endpoints for operators.
---

Base path: `/api/v1`. These endpoints are operator-facing. In production they're
gated by an admin token (`ADMIN_TOKEN`) — without it configured they return
`404`.

## GET /admin/reconcile
Runs the ledger conservation self-check and returns the reconciliation result
(e.g. `{ ok: true, ... }`). Use it to confirm credits are conserved across all
accounts plus escrow.

## GET /admin/risk-flags
Lists open risk flags — submissions or signups held for review (e.g. same-IP
signup bursts surfaced by the risk engine).

## POST /admin/risk-flags/:id/release
Releases a held flag: frozen earned credits return to the account's spendable
balance and the flag is closed.

## POST /admin/risk-flags/:id/confirm
Confirms a flag as a true positive: the held amount stays frozen (or is
forfeited per policy) and the flag is closed.

## GET /metrics
Prometheus metrics (conservation + flow gauges). Scrape target for monitoring;
may be gated by `METRICS_TOKEN`.
