# ATM Verifiable Agent Work Product Plan

Date: 2026-06-23

Detailed source of truth:

- `docs/product/verifiable-agent-work-product-tech-plan.md`

This `.omx/plans` entry is the execution pointer. Do not duplicate detailed
contracts here; update the `docs/product` plan first, then reflect only status
and routing notes here.

## Current Positioning

ATM is planned as an **MCP-native, self-hostable market for machine-verifiable
agent work**, with automatic verification and auditable credit settlement.

Role boundary:

- Web console: owner/operator control plane for publishing, review, audit,
  ledger, agent identity management, and market operations.
- Agent keys: MCP execution identities for finding suitable work, claiming,
  submitting results, and reading execution/settlement status.

## Competitive Positioning (added 2026-06-23)

A competitive scan of dealwork.ai was folded into the detailed plan (see §1.1,
§4.5, §16). Summary of routing notes:

- Moat confirmed: verifiable settlement (machine verdict-gated payout +
  conservation-checked ledger) vs. the competitor's escrow + timed auto-release.
  No plan changes to the M0→M3 main line; the scan backs the existing direction.
- Moat to surface in product/docs, not just backend: compliance-first
  (subscription-OAuth refusal, Tier 1 preference).
- Acknowledged gap: value exit for earned credits (competitor has x402/USDC;
  ATM redemption is hard-locked). Documented as strategic context, explicitly
  out of MVP scope.
- Added open decisions: external settlement rail vs. in-ecosystem redemption;
  public discoverable reputation.

## Multi-Expert Review Status

Status: revised after multi-expert review.

Review lanes completed:

- Product/UX
- Architecture/API
- Test strategy
- Adversarial critic

Blocking items incorporated into the detailed plan:

- Owner/operator web-console boundary versus MCP agent execution boundary.
- Milestone split between Product Reframe MVP, Verifiability MVP,
  Auditability MVP, Agent Identity, and Market Ops.
- Verification package visibility/redaction policy.
- Verification run state machine and transaction-boundary rules.
- Settlement events as append-only ledger projections, including idempotency,
  nullable `task_id` for account-level redemption, and grouped ledger rows.
- Server-derived claimability contract shared by UI and MCP.
- MCP `explain_task_fit` slice.
- Market Ops backend slice before enforcing operator notes in UI.
- Milestone-specific test gates.

Rejected review item:

- One architecture review claimed the app frontend should be under
  `website/src`. That does not match this repository. The application console is
  under `web/src`; `website/src` is the documentation site.

## Execution Order

Use the milestone plan in `docs/product/verifiable-agent-work-product-tech-plan.md`.

High-level sequence:

1. Baseline build/type alignment and shared response contracts.
2. Product Reframe MVP: owner console shape and derived verification/settlement
   summaries without new audit tables.
3. Verifiability MVP: persist `verification_runs`.
4. Auditability MVP: persist `settlement_events` and expose audit traces.
5. MCP task-fit/status/trace deepening.
6. Agent Identity operational visibility.
7. Market Ops controls and operator audit flows.

Important dependency note:

- `B5` has a Product Reframe version that derives execution summaries from
  existing task/execution/ledger data.
- After `B6` and `B7`, enhance the same execution detail contract to prefer
  persisted `verification_runs` and `settlement_events`.

## Verification Policy

Before claiming implementation complete, run the relevant gates from the detailed
plan:

- Backend build and targeted backend tests for changed API/service behavior.
- Web build and tests for changed console behavior.
- MCP build and tool tests for changed agent-facing behavior.
- Website build when docs content changes.

For this planning-only review update, no runtime code was changed.
