# Design — `review-flags` CLI for frozen-reward review (CLAWMIN-48)

**Date:** 2026-06-21
**Status:** Approved, pre-implementation
**Scope:** Block A of the review-queue work. Block B (externalize Telegram from the
open-source `alertmanager.yml`) is tracked separately as CLAWMIN-49.

## Problem

When the risk engine flags a payout as suspicious (self-dealing / collusion), settlement
pays-then-freezes the reward: the executor's credits move `earned_balance → frozen_earned_balance`
(a delta=0 ledger row, conservation preserved) and an `open` `risk_flags` row is written
(`settlement.ts`). The only way to resolve a frozen flag is the existing service layer —
`releaseRiskFlag` (unfreeze, return to the executor) or `confirmRiskFlag` (uphold the freeze).

There is no operator-facing entry point to *do* that resolution. The `/admin/risk-flags*`
HTTP routes exist but require `ADMIN_TOKEN` and HTTP plumbing. What's missing is a simple
hands-on tool for an operator to list and resolve frozen rewards.

## Decision

**Human review via a CLI; reminders reuse the existing alert.** No interactive Telegram
bot, no web backoffice, no auto-timeout sweep. Rationale:

- **Reminding is already solved.** The `RiskReviewQueueStuck` alert (gated on
  `atm_frozen_earned_total > 0` for 6h) already pushes "held funds awaiting review" to
  Telegram via Alertmanager.
- **Resolving just needs an entry point.** The transactional, conservation-safe service
  functions already exist; only a thin CLI wrapper is needed.
- **Best fits current scale + the open-source boundary.** Zero real users, low-frequency
  review; zero new long-running process, zero public surface, no change to the AGPL core.
  An interactive Telegram bot is over-engineered for this scale.

## Architecture

One new file: `backend/scripts/review-flags.ts`, mirroring the existing
`backend/scripts/reconcile.ts` ops CLI:

- Imports the existing service functions (`listRiskFlags`, `releaseRiskFlag`,
  `confirmRiskFlag` from `services/riskFlagService`) and connects via `db/pool`, exactly
  as `reconcile.ts` wraps `reconcileService.reconcile`.
- Runs inside the backend container (it already has DB access), so it needs **no HTTP and
  no `ADMIN_TOKEN`** — same trust model as `reconcile`.
- Registered as an npm script in `backend/package.json`:
  `"review-flags": "tsx scripts/review-flags.ts"`.
- **The open-source core service layer is unchanged** — all three functions already exist,
  are transactional, and have conservation covered by existing integration tests.

## Components (unit boundaries)

- **`parseArgs(argv: string[])` — pure function.** Maps raw CLI args to a typed command:
  `{ cmd: 'list', status: 'open'|'frozen'|'released' }` |
  `{ cmd: 'release'|'confirm', flagId: string }` | `{ cmd: 'error', message: string }`.
  No I/O. Independently unit-tested (invalid command, missing arg, illegal status, default
  status). This is the only new logic worth isolating.
- **`main()` — thin dispatch shell.** Calls `parseArgs`, switches on `cmd`, invokes the
  matching service function, prints JSON, sets `process.exitCode`, and `closeDb()` in a
  `finally` — mirroring `reconcile.ts`'s shutdown.

## Commands

`npm run review-flags -- <cmd> [arg]`

| Command | Behavior |
|---|---|
| `list [open\|frozen\|released]` | Default `open`. Prints each flag's `id`, `kind`, `amount`, `account_id`, `created_at`, `detail` as indented JSON (eyeballable and greppable, like `reconcile`). |
| `release <flagId>` | `releaseRiskFlag(flagId, 'cli-admin')` — unfreeze, return credits to the executor's earned balance. |
| `confirm <flagId>` | `confirmRiskFlag(flagId, 'cli-admin')` — uphold the freeze (credits stay out of circulation). |

The `resolvedBy` argument is the literal `'cli-admin'`, distinguishing CLI resolutions from
the HTTP admin path's `'admin'` in the `risk_flags.resolved_by` audit column.

## Data flow (operator loop)

```
Reminder (existing, unchanged):
  Prometheus RiskReviewQueueStuck (atm_frozen_earned_total > 0, 6h)
    → Alertmanager → Telegram: "held funds awaiting review"

Resolution (new):
  operator SSHes to the box
    → docker compose exec backend npm run review-flags -- list
    → inspect flags
    → npm run review-flags -- release <id>   (or confirm <id>)
```

## Error handling

- Unknown command / missing or malformed argument → `parseArgs` returns `{cmd:'error'}`;
  `main` prints a usage line to stderr and exits non-zero.
- Flag not found or not in `open` state → the service already throws
  (`'Risk flag not found or not open'`); `main` catches, prints the message to stderr, and
  exits 1.
- Mirrors `reconcile.ts`: JSON to stdout, errors to stderr, `process.exitCode` on failure
  so a human or a wrapper can gate on it.

## Testing

- **New:** unit test for `parseArgs` (`backend/test/unit/`) — covers default status, each
  command, illegal status value, missing `flagId`, unknown command.
- **Reused:** `release`/`confirm` transactional behavior and conservation are already
  covered by the existing `riskFlagService` integration tests; not re-tested here. The CLI
  layer over them is a thin shell, exercised through `parseArgs` + manual smoke on the box.

## Documentation

`docs/deploy.md`, in the risk-engine rollout section, gains a short "Reviewing frozen
rewards" subsection: the alert → SSH → `review-flags -- list` → `release|confirm <id>` path,
with a one-line example of each command.

## Out of scope (explicit)

- Interactive Telegram review bot (rejected: over-engineered for current scale).
- Web backoffice (rejected: largest surface/effort, not warranted).
- Auto-timeout resolution (rejected: the release-vs-confirm-on-timeout decision carries real
  fund-loss risk and isn't needed at zero traffic).
- Externalizing Telegram from `alertmanager.yml` — separate work, CLAWMIN-49.
- Any change to the core service layer or the `/admin/risk-flags*` HTTP routes.
