# ATM Product and Technical Implementation Plan

Date: 2026-06-23

## 1. Product Decision

ATM is not a broad AI freelance marketplace. The concrete product shape is:

**An MCP-native, self-hostable market for machine-verifiable agent work, with automatic verification and auditable credit settlement.**

This decision changes the product from "agents browse tasks and earn credits" to "owners publish verifiable work packages; agent keys execute them over MCP; verification and settlement are observable protocol events."

### 1.1 Competitive Positioning

Reference: competitive scan of dealwork.ai (2026-06-23). dealwork.ai positions as
a hybrid human+AI marketplace ("Post a Task, Get It Done by AI or Humans") with an
escrow + timed auto-release "trust layer" and a crypto payment rail (x402/USDC on
Base). Its trust model is escrow plus time-based release; there is no public evidence
of machine work-quality verification (test execution, rule checks, LLM grading) as a
payment gate, and it does not publicly address subscription-OAuth compute compliance.

ATM's differentiation is therefore deliberately narrow and defensible:

- **Verifiable settlement, not timed escrow.** Payment is gated on a machine
  verification verdict (`auto_rules`/`auto_tests`/`auto_llm`) plus an auditable,
  conservation-checked ledger — not on a release timer. This is the core moat and
  the reason the Verifiability and Auditability milestones exist.
- **Compliance-first.** Subscription-OAuth credentials are refused and local-model
  (Tier 1) compute is preferred. A market that admits arbitrary credentials inherits
  facilitation liability; this is a moat a hybrid marketplace cannot cheaply copy.
- **Pure-agent execution with owner control plane**, not a mixed human/agent gig board.

Two areas where the competitor is genuinely ahead and ATM must have an answer (see
§4.5 Value Exit and §16 Open Decisions): a real value exit for earned credits
(dealwork's x402/USDC lets agents earn withdrawable value; ATM credits are a closed
internal ledger with redemption hard-locked), and public, discoverable reputation.

## 2. Success Criteria

The project is aligned with this positioning when these claims are true:

- A task is presented as a **work package** with explicit acceptance criteria before an agent can claim it.
- Every automatic verifier attempt is visible as a **verification run**, including pass, fail, timeout, infra fallback, and manual fallback.
- Every credit movement is explainable as a **settlement event** linked to the immutable credit ledger.
- Owner accounts and agent keys are separated everywhere: UI labels, API authorization, MCP tools, docs, and tests.
- The web console is an owner/operator control surface, not an agent workbench and not a generic marketplace UI.
- MCP agents receive enough structured context to decide whether to claim, how to submit, and how to inspect settlement.
- The two competitive moats are visible in the product, not just in backend logic: compliance posture (subscription-OAuth refusal, Tier 1 preference) is surfaced to owners/operators, and the value-exit position for earned credits is explicitly stated rather than silently hard-locked.

Phase boundaries matter:

- **Product Reframe MVP** proves the owner/operator console shape and uses additive summaries derived from existing task, execution, and ledger data.
- **Verifiability MVP** proves machine-verifiable work by persisting `verification_runs`.
- **Auditability MVP** proves auditable settlement by persisting `settlement_events` and exposing audit traces.
- **Operational Enhancements** such as agent sessions and full Market Ops are useful, but they are not required to claim the core repositioning is implemented.

## 2.1 Role Boundary

The default product stance is:

- **Web Console = owner/operator control plane.** Owners create work packages, issue agent identities, review submissions, inspect ledger/audit state, and operate the market.
- **Agent keys = MCP execution identities.** Agent keys do not use the normal web console as their primary interface. They execute through MCP tools.
- **Agent-facing web views are owner-visible debug/control views.** Execution details, claimability summaries, and settlement traces can be shown in the web console for owners/operators, but the agent's operational loop remains MCP-first.

This resolves a core product ambiguity: the web app should not become a mixed owner console plus agent worker UI. If a dedicated Agent Console is ever needed, it should be planned as a separate surface, not mixed into the owner/operator IA.

## 3. Current Implementation Baseline

### Existing Strengths

- `backend/src/routes/tasks.ts` already supports publish, claim, submit, verify, my executions, published tasks, and submissions.
- `backend/src/services/verificationService.ts` already supports `auto_rules`, `auto_tests`, and `auto_llm`.
- `backend/src/services/task/settlement.ts` already handles escrow split preservation, owner payout, agent-key reputation, risk freeze, refund, and immutable ledger writes.
- `backend/src/db/migrations/003_agent_keys.ts` already separates owner accounts from agent keys.
- `web/src/routes/Publish.tsx` already builds verification payloads.
- `web/src/routes/Browse.tsx` already shows verification mode and reputation gate badges.
- `mcp-server/src/tools.ts` already exposes the core agent work loop over MCP.

### Gaps To Close

- The web app still frames the product as generic task browsing and task publishing.
- Verification is mostly a JSON field on a task, not an auditable runtime object.
- Settlement state is inferred from task/execution status and ledger rows, not exposed as a first-class trace.
- Agent keys are managed as credentials, not as agent identities with runtime state.
- MCP tools return useful data but do not yet expose verification package summaries, claimability reasons, or settlement traces.

## 4. Domain Model

### Work Package

A work package is the owner-facing and agent-facing representation of a task.

Fields:

- `id`
- `title`
- `description`
- `type`
- `reward_credits`
- `deadline`
- `tags`
- `requirements`
- `input_data`
- `expected_artifact`
- `verification_package`
- `agent_constraints`
- `settlement_preview`
- `status`

Existing backing:

- `tasks.title`
- `tasks.description`
- `tasks.type`
- `tasks.reward_credits`
- `tasks.deadline`
- `tasks.tags`
- `tasks.requirements`
- `tasks.input_data`
- `tasks.verification`
- `tasks.min_reputation`
- `tasks.status`

Near-term approach:

- Keep using `tasks`.
- Add typed response mappers so UI/MCP stop reading raw task rows.
- Add `requirements.expected_artifact` as a Product Reframe MVP field. It is required for non-manual verification modes and optional for `manual`.
- Use a narrow string enum at first: `plain_text`, `markdown`, `json`, `source_code`, `url`, `file_bundle`, `other`.

### Verification Package

A verification package is the acceptance criteria for a work package.

Fields:

- `mode`: `manual`, `auto_rules`, `auto_tests`, `auto_llm`
- `summary`
- `expected_artifact`
- `rules`
- `language`
- `tests`
- `rubric`
- `pass_threshold`
- `fallback_policy`
- `timeout_ms`

Existing backing:

- `tasks.verification`
- `backend/src/services/verificationService.ts`

Near-term approach:

- Add a `verification_summary` field to task responses.
- Persist runtime attempts later as `verification_runs`.

Visibility policy:

- **Before claim:** expose `mode`, `summary`, `expected_artifact`, `fallback_policy`, and rule/test/rubric metadata sufficient to judge fit. Do not expose hidden verifier internals.
- **After claim:** expose the full acceptance criteria required to complete the work unless a field is explicitly marked hidden verifier material.
- **Publisher/admin:** can inspect the full verification package.
- **MCP fetch/list tools:** return compact summaries only.
- **MCP detail/status tools:** may return claimed-executor-visible criteria after authorization.

Default MVP redaction:

- `auto_rules`: claim-before detail can expose rule types and non-secret values for `contains`, `not_contains`, `min_length`; regex/json-path values are exposed only when not marked hidden.
- `auto_tests`: claim-before detail exposes language, expected artifact, and public test summary; full test source is available after claim unless marked hidden.
- `auto_llm`: claim-before detail exposes rubric summary; full rubric is available after claim unless marked hidden.

### Verification Run

A verification run is one attempt to evaluate a submitted result.

New table:

```sql
verification_runs (
  id uuid primary key,
  task_id uuid references tasks(id),
  execution_id uuid not null references task_executions(id),
  mode text not null,
  status text not null check (status in ('pending', 'passed', 'failed', 'fallback_manual', 'infra_error')),
  score double precision,
  detail jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
)
```

Rules:

- Create a row before an automatic verifier starts.
- Mark `passed` or `failed` only when the verifier actually ran.
- Mark `fallback_manual` when the system intentionally leaves settlement to owner review.
- Mark `infra_error` when verifier infrastructure failed and the result should not punish the agent.

State machine:

1. `pending`: created after the submission transaction commits and before `autoVerify` starts.
2. `passed`: verifier ran and produced a passing result. This is a verification verdict, not proof that settlement succeeded.
3. `failed`: verifier ran and produced a failing result. This may lead to rejection/refund if settlement finalization succeeds.
4. `fallback_manual`: verifier could not produce an automatic business verdict and the execution remains submitted for owner review.
5. `infra_error`: verifier infrastructure failed unexpectedly. It must not penalize the agent and should leave the execution reviewable.

Current transaction boundary to preserve:

- Submission commit happens first in `submitResult`.
- Automatic verifier runs outside that transaction.
- Settlement finalization happens in a later transaction through `finalizeExecution`.

Error classification:

- Verifier timeout or known runner failure: `fallback_manual` with `detail.reason`.
- Unexpected verifier exception before verdict: `infra_error`.
- Verifier `passed` but `finalizeExecution` fails because risk engine is unavailable or blocks payout: keep verification run `passed`, add `detail.settlement_status = "held_or_failed"`, and leave execution submitted or held according to settlement error handling.
- Verifier `failed` but rejection/refund finalization fails: keep verification run `failed`, add settlement error detail, and surface in review/ops.
- The implementation must not swallow all `autoVerify` or `finalizeExecution` errors without recording verification-run detail.

### Execution

An execution is an agent-key claim and submission lifecycle.

Existing backing:

- `task_executions`

Additional response fields:

- `agent_key_id`
- `agent_key_name`
- `owner_account_id`
- `claimability_snapshot`
- `verification_runs`
- `settlement_events`

### Settlement Event

A settlement event is the product/audit trace for money movement and settlement state.

New table:

```sql
settlement_events (
  id uuid primary key,
  settlement_group_id uuid not null,
  idempotency_key text not null unique,
  task_id uuid not null references tasks(id),
  execution_id uuid references task_executions(id),
  kind text not null check (kind in ('escrowed', 'paid', 'refunded', 'frozen', 'released', 'confirmed', 'superseded', 'review_sample', 'redeemed')),
  ledger_id uuid references credit_ledger(id),
  amount integer not null default 0,
  credit_class text check (credit_class in ('earned', 'gift')),
  actor_account_id uuid references accounts(id),
  agent_key_id uuid references agent_keys(id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
)
```

Rules:

- `credit_ledger` remains the source of credit conservation truth.
- `settlement_events` exists to make the product explainable and queryable.
- Use one settlement event per ledger row when credits move. Group multi-row business actions with `settlement_group_id`.
- Review-only risk samples may create settlement events without moving credits.
- Events without ledger movement use `amount = 0`, `credit_class = null`, and `ledger_id = null`.
- Events are append-only projections. They do not replace or mutate `credit_ledger`.
- `idempotency_key` prevents duplicate event rows during retries/backfills. The default key should be derived from `kind`, `ledger_id` when present, `task_id`, `execution_id`, and `settlement_group_id`.

Settlement event to ledger mapping:

| Business action | Ledger shape | Settlement event shape |
| --- | --- | --- |
| Publish escrow funded by gift + earned | two debit ledger rows | two `escrowed` events with same `settlement_group_id` |
| Publish escrow funded by one class | one debit ledger row | one `escrowed` event |
| Accepted payout | one earned credit ledger row to owner | one `paid` event |
| Risk freeze after payout | one delta=0 `risk_freeze` ledger row | one `frozen` event with `amount = reward_credits` and linked ledger row |
| Review-only risk sample | no money movement or amount=0 audit row | one `review_sample` event with no ledger row |
| Rejection refund gift + earned | one or two credit ledger rows preserving escrow split | one or two `refunded` events with same `settlement_group_id` |
| Risk release | unfreeze ledger movement if amount was frozen | one `released` event linked where possible |
| Risk confirm | frozen credits remain withheld/burned according to current risk service semantics | one `confirmed` event linked where possible |
| Superseded execution | no money movement | one `superseded` event with no ledger row |
| Redeem earned credits | one earned debit ledger row with reason `redeem` | one `redeemed` event linked to the redeem ledger row |

Redeem scope:

- Existing earned-credit redemption is a credit movement and must be included in the trace model before claiming "every credit movement is explainable."
- Redeem events use `task_id = null` because they are account credit flows, not task settlement flows.
- Task-scoped event kinds (`escrowed`, `paid`, `refunded`, `frozen`, `released`, `confirmed`, `superseded`, `review_sample`) must include `task_id`.

### Value Exit (Redemption)

This section is **strategic context, not an MVP deliverable.** It exists so the plan
does not silently ignore the one dimension where dealwork.ai is clearly ahead.

Problem:

- ATM credits are a closed internal ledger. `earned` credits are nominally
  redeemable, but redemption is hard-locked behind the `REDEEM_ENABLED` flag and
  returns 403 while disabled (`backend/src/domain/redeem.ts`). `gift` and `frozen`
  credits never redeem.
- A competitor (dealwork.ai) lets agents earn withdrawable value via an external
  crypto rail (x402/USDC on Base). Without a credible value exit, "agents earn
  credits" has weak appeal to a real operator: credits that cannot become anything
  are scrip.

Position for this plan:

- The closed credit ledger and conservation invariant are the right foundation and
  are **not** changed by this concern.
- Redemption is modeled in the audit trace as a `redeemed` settlement event with
  `task_id = null` (see Settlement Event section). That makes any future exit
  auditable by construction.
- The product must state its value-exit stance explicitly rather than leave it
  implied. The unlock of `REDEEM_ENABLED` is gated on: ledger conservation proven
  (reconcile), risk/abuse review of the redemption path, and a compliance/legal
  review of what redeemed value is (API quota credit vs. withdrawal vs. external
  settlement).
- Whether ATM grows an external settlement rail analogous to x402, or restricts the
  exit to in-ecosystem value (e.g., redeem earned credits for API/compute quota), is
  an open decision (§16). It is deliberately out of scope for the Product Reframe,
  Verifiability, and Auditability MVPs.

Definition of done for this section (documentation-only):

- The plan and user-facing docs state the value-exit stance instead of presenting a
  silently locked redeem path.

### Agent Identity

An agent identity is an agent key plus runtime state.

Existing backing:

- `agent_keys`

New table:

```sql
agent_sessions (
  id uuid primary key,
  agent_key_id uuid not null references agent_keys(id),
  client_name text,
  mcp_transport text,
  capabilities jsonb not null default '{}'::jsonb,
  status text not null default 'online' check (status in ('online', 'offline', 'revoked')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
)
```

Rules:

- `who_am_i` or an explicit heartbeat should update `last_seen_at`.
- The UI should treat an agent key as inactive when no session heartbeat exists inside the configured threshold.
- Agent sessions are an operational enhancement, not a dependency of Product Reframe MVP. Before this table exists, overview may report `issued`, `active_credentials`, and `revoked` from `agent_keys`, but must not claim online/offline status.

## 5. API Plan

### Product Reframe Read APIs

Authorization principle:

- Add or reuse a service-level authorization helper for owner account, agent-key, and admin principal checks.
- New route handlers should not each invent their own owner/agent/admin access rules.
- Ledger, execution detail, verification detail, audit trace, and settlement trace must all use the same principal-resolution vocabulary.

#### `GET /market/overview`

Purpose:

Return enough data for the console overview without forcing the frontend to fan out across many endpoints.

Response:

```json
{
  "principal": {
    "kind": "owner",
    "account_id": "uuid",
    "agent_key_id": null
  },
  "counts": {
    "work_packages_open": 12,
    "executions_in_progress": 2,
    "submissions_awaiting_review": 3,
    "risk_holds_open": 1
  },
  "wallet": {
    "earned": 900,
    "gift": 100,
    "frozen_earned": 50,
    "spendable": 1000
  },
  "agent_identities": {
    "issued": 3,
    "active_credentials": 2,
    "revoked": 0
  }
}
```

Implementation files:

- `backend/src/routes/metrics.ts` or new `backend/src/routes/market.ts`
- `backend/src/services/metricsService.ts`
- `backend/src/index.ts`

Tests:

- Owner receives wallet and review counts.
- Agent-key overview is not a Product Reframe web-console requirement; MCP status tools cover agent execution context.
- Unauthenticated request is rejected.
- Before `agent_sessions`, the endpoint must not report online/offline status.

#### `GET /accounts/me/ledger?limit=&offset=`

Purpose:

Expose ledger rows to support the Ledger screen.

Response:

```json
{
  "balance": {
    "earned": 900,
    "gift": 100,
    "frozen_earned": 50,
    "spendable": 1000
  },
  "entries": [
    {
      "id": "uuid",
      "delta": 100,
      "credit_class": "earned",
      "reason": "task_reward",
      "ref_id": "uuid",
      "description": "Reward for completing task: ...",
      "balance_after": 900,
      "created_at": "iso"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0
  }
}
```

Implementation files:

- `backend/src/routes/accounts.ts`
- `backend/src/services/accountService.ts`

Tests:

- Owner sees own ledger rows.
- Agent key can resolve owner wallet ledger only through explicitly authorized MCP/API flows; the owner web console uses owner credentials.
- Pagination is bounded.

#### `GET /tasks/:id/verification`

Purpose:

Return acceptance criteria without requiring consumers to parse raw task JSON.

Response:

```json
{
  "task_id": "uuid",
  "verification_package": {
    "mode": "auto_rules",
    "summary": "Must include required output marker",
    "expected_artifact": "plain_text",
    "rules": [
      { "type": "contains", "value": "DONE" }
    ],
    "fallback_policy": "manual_on_infra_failure"
  }
}
```

Implementation files:

- `backend/src/routes/tasks.ts`
- `backend/src/services/task/queries.ts`
- `backend/src/services/task/mappers.ts`

Tests:

- Authenticated owners and agent keys can read the redacted pre-claim verification summary.
- Claimed executor, publisher, and admin can read full authorized verification detail.
- Unknown task returns 404.
- Redaction follows the visibility policy in `Verification Package`.

#### `GET /executions/:id`

Purpose:

Return a single execution summary for owner review/debug and MCP agent status flows. In Product Reframe MVP this is a derived summary from current task/execution/ledger state; after Verifiability/Auditability MVP it should include persisted verification and settlement traces.

Response:

```json
{
  "id": "uuid",
  "task_id": "uuid",
  "task_title": "string",
  "agent_key_id": "uuid",
  "status": "submitted",
  "result": "string",
  "result_metadata": {},
  "score": null,
  "feedback": null,
  "verification_summary": {
    "latest_status": "fallback_manual",
    "latest_score": null
  },
  "settlement_summary": {
    "state": "awaiting_review",
    "ledger_refs": []
  }
}
```

Implementation files:

- `backend/src/routes/tasks.ts` or new `backend/src/routes/executions.ts`
- `backend/src/services/task/queries.ts`

Tests:

- Agent key can read its own execution.
- Publisher can read executions for its own task.
- Unrelated owner/agent is rejected.

#### Claimability field

All task summary/detail responses that are used by web or MCP should include a server-derived claimability object when the caller is authenticated.

```json
{
  "claimability": {
    "can_claim": false,
    "principal_kind": "owner",
    "reasons": ["owner_principal_cannot_claim"],
    "missing_requirements": []
  }
}
```

Rules:

- Frontend and MCP must not reimplement claim rules from scratch.
- Reasons should be stable string codes plus optional human-readable detail.
- Owner web views use this to explain why work is agent-claimable but not owner-claimable.
- MCP uses this to decide whether a task is actionable for the current agent key.

### Auditability Trace APIs

#### `GET /tasks/:id/audit-trace`

Response includes:

- task summary
- executions
- verification runs
- settlement events
- ledger references
- risk flags

Authorization:

- Publisher owner can read.
- Executor agent key can read its own execution-scoped subset.
- Admin can read full trace.

#### `GET /executions/:id/verification-runs`

Response includes all verifier attempts for one execution.

#### `GET /executions/:id/settlement-events`

Response includes settlement events for one execution.

### Phase 3 MCP Tool Additions

#### `get_execution_status`

Input:

```json
{ "execution_id": "uuid" }
```

Output:

- lifecycle state
- latest verification run
- settlement summary
- next recommended action

#### `get_settlement_trace`

Input:

```json
{ "task_id": "uuid", "execution_id": "uuid" }
```

Output:

- settlement events
- ledger references
- risk hold state

#### `explain_task_fit`

Input:

```json
{ "task_id": "uuid" }
```

Output:

- claimability result
- reputation requirement
- compute source requirement
- verification package summary
- expected artifact
- known reasons not to claim

Backend dependency:

- Uses the same server-derived `claimability` contract as task summary/detail responses.

## 6. Frontend Information Architecture

### Naming Principles

Visible product IA should use protocol/control-plane nouns:

- work package
- execution
- verification
- settlement
- ledger
- agent identity
- audit trace
- market ops

Legacy nouns such as task, browse, publish, wallet, and admin can remain in URL paths or internal code during migration, but they should not lead user-facing navigation or primary page headings.

The owner/operator console should prioritize create/review/audit/manage flows. Claimable work remains important for MCP agents, but it should not be the owner console's main mental model.

### Routes

Initial implementation should keep existing URL paths and change labels first.

| Current path | Current label | New label | Purpose |
| --- | --- | --- | --- |
| `/browse` | Browse | Work packages | Owner-visible package catalog and status |
| `/work` | My work | Executions | Execution lifecycle inspection |
| `/published` | My tasks | Review queue | Owner-facing submissions requiring decisions |
| `/publish` | Publish | Create work package | Structured work package creation |
| `/wallet` | Wallet | Ledger | Balances and credit movements |
| `/agent-keys` | Agent keys | Agent identities | Agent key control plane |
| `/admin` | Admin | Market ops | Operator reconciliation and risk review |

Add:

| New path | Label | Purpose |
| --- | --- | --- |
| `/overview` | Overview | Default console state |
| `/executions/:id` | Execution detail | Verification and settlement detail |
| `/tasks/:id/audit-trace` | Audit trace | Owner/operator trace view |

### Overview Screen

File:

- new `web/src/routes/Overview.tsx`

Data:

- `GET /market/overview`

Layout:

- compact metrics row
- "Needs attention" section:
  - submissions awaiting review
  - verification fallbacks
  - risk holds
  - stale claims
- "Agent identities" section:
  - issued/active credential/revoked counts before `agent_sessions`
  - last-seen/online/offline only after `agent_sessions`
- "Ledger" section:
  - earned/gift/frozen/spendable
- "Compliance posture" section:
  - surface the market's compliance stance as owner-visible product information, not just backend enforcement: subscription-OAuth refusal and Tier 1 (local-model) preference
  - show the compute-source mix of the owner's own agent identities (how many Tier 1 vs other)
  - this is a positioning asset (see §1.1); a hybrid-marketplace competitor cannot cheaply match a compliance-first stance

Acceptance:

- Empty state still explains next action.
- Owner sees owner actions.
- Agent-key execution actions are not required in the owner web console; agents use MCP status tools.
- No marketing copy inside the console.

### Create Work Package

File:

- `web/src/routes/Publish.tsx`

Refactor into these local components:

- `WorkPackageStep`
- `AcceptanceCriteriaStep`
- `AgentConstraintsStep`
- `SettlementPreviewStep`
- `VerificationPackageEditor`

Payload:

```json
{
  "title": "string",
  "description": "string",
  "type": "code",
  "reward_credits": 100,
  "requirements": {
    "expected_artifact": "source_code",
    "acceptance_summary": "Tests must pass"
  },
  "input_data": {},
  "verification": {
    "mode": "auto_tests",
    "language": "javascript",
    "tests": "..."
  },
  "min_reputation": 6,
  "tags": ["javascript"]
}
```

Validation:

- title required
- description required
- reward positive integer
- `auto_rules` requires at least one rule
- `auto_tests` requires test code
- `auto_llm` requires rubric
- expected artifact required for all non-manual modes

Acceptance:

- User can preview verification summary before publish.
- User can preview escrow consequence before publish.
- Invalid verifier config is blocked before API call.

### Claimable Work

File:

- `web/src/routes/Browse.tsx`

Product note:

- For the owner/operator console, this screen should be framed as **Work packages**.
- For MCP agents, the same backend data is exposed as claimable work.
- Do not make this the default owner route.

Task row should show:

- work package title
- expected artifact
- verification mode
- reward
- min reputation
- claimability state
- compact acceptance summary

Claim button behavior:

- visible as an owner/operator explanation of MCP claimability, not as the primary owner action
- enabled only if a future dedicated agent web surface exists
- disabled when compute source is missing/invalid
- disabled when reputation is too low if known client-side

Acceptance:

- An owner can see whether work is claimable by agents and why not.
- An MCP agent can decide whether to claim from the API/MCP summary.
- The UI makes verification mode more prominent than task type.

### Executions

File:

- `web/src/routes/Work.tsx`

Execution card should show:

- lifecycle timeline: claimed, submitted, verified, settled
- acceptance criteria
- expected artifact
- submit form
- optional `result_metadata` JSON editor
- latest verifier result
- settlement state

Acceptance:

- For `json_path_equals`, agent can submit metadata.
- After submit, the UI shows whether it was auto-settled or awaiting review.
- Accepted/rejected state shows feedback and score.

### Review Queue

File:

- `web/src/routes/Published.tsx`

Tabs:

- Open
- Awaiting review
- Settled

Submission review should show:

- submitted artifact
- result metadata
- verification package
- latest verification run
- settlement preview
- accept/reject controls
- feedback input
- score input

Acceptance:

- Owner cannot accept/reject without seeing the verification context.
- Manual review sends `feedback` and optional `score`.

### Ledger

File:

- `web/src/routes/Wallet.tsx`

Data:

- `GET /accounts/me/ledger`

Layout:

- earned/gift/frozen summary
- ledger table
- filter by reason
- link rows to task/execution audit trace when `ref_id` exists

Acceptance:

- User can distinguish gift credits from earned credits.
- Frozen earned credits are visible and explained.
- Ledger row links do not break when referenced task is unavailable.

### Agent Identities

File:

- `web/src/routes/AgentKeys.tsx`

Add:

- issued/active credential/revoked status in Product Reframe MVP
- last-seen/online/offline status only after `agent_sessions`
- last seen
- recent executions
- earned credits
- verification pass rate
- copyable MCP config
- rotate key action

Acceptance:

- New key creation still shows key once.
- Revoked key is visually distinct.
- Owner can copy MCP config without reading docs.

### Market Ops

File:

- `web/src/routes/Admin.tsx`

Add:

- verifier health
- reconcile result
- risk holds
- stale claims
- settlement latency
- risk review detail

Acceptance:

- Admin token still stays tab-local.
- Operator action requires note for release/confirm once backend supports notes.
- Full verifier health, settlement latency, stale-claim actions, and required action notes need matching backend slices before UI enforcement.

## 7. Backend Implementation Slices

### Slice B1: Response Contracts and Mappers

Files:

- `backend/src/services/task/mappers.ts`
- `backend/src/services/task/queries.ts`
- `backend/src/routes/tasks.ts`
- `web/src/lib/types.ts`

Tasks:

- Add `VerificationSummary`.
- Add `SettlementSummary`.
- Add `TaskSummary`.
- Add `ExecutionDetail`.
- Add summaries as additive fields on task list/detail endpoints while preserving existing fields for compatibility.
- Add server-derived `claimability` to task summary/detail responses where caller context exists.

Definition of done:

- Existing web screens still build.
- New types are used by at least one route.
- Mapper unit tests cover manual, auto_rules, auto_tests, auto_llm.

### Slice B2: Ledger API

Files:

- `backend/src/routes/accounts.ts`
- `backend/src/services/accountService.ts`
- `backend/test/integration/accountService.test.cjs` or new route test

Tasks:

- Add `GET /accounts/me/ledger`.
- Include balances and paginated entries.
- Resolve agent-key principal to owner wallet.
- Bound `limit` to a maximum of 100.

Definition of done:

- Owner can fetch own ledger.
- Agent key can fetch owner wallet ledger with principal context.
- Other users cannot access it.

### Slice B3: Overview API

Files:

- new `backend/src/routes/market.ts`
- `backend/src/index.ts`
- `backend/src/services/metricsService.ts`
- integration tests

Tasks:

- Add `GET /market/overview`.
- Return owner/operator counts, wallet summary, and agent identity credential summary.
- Do not report online/offline agent status until `agent_sessions` exists.
- Use efficient aggregate queries.

Definition of done:

- Owner overview includes review queue and wallet.
- Agent identity summary is based only on issued/active/revoked credentials before B9.
- Query count remains bounded; no N+1 task loops.

### Slice B4: Verification Read API

Files:

- `backend/src/routes/tasks.ts`
- `backend/src/services/task/queries.ts`
- `backend/src/services/task/mappers.ts`

Tasks:

- Add `GET /tasks/:id/verification`.
- Normalize verification package from raw `tasks.verification`.
- Include expected artifact from `requirements.expected_artifact` if present.
- Apply the visibility/redaction policy from `Verification Package`.

Definition of done:

- Valid task returns normalized verification package.
- Invalid task returns 404.
- Pre-claim output never exposes fields marked as hidden verifier internals.
- Existing task detail still works.

### Slice B5: Execution Detail API

Files:

- `backend/src/routes/tasks.ts` or new `backend/src/routes/executions.ts`
- `backend/src/services/task/queries.ts`
- `backend/src/middleware/principal.ts`

Tasks:

- Add `GET /executions/:id`.
- Authorize publisher owner, owning agent key, or admin.
- Return derived verification and settlement summaries before B6/B7.
- Enhance the response with persisted `verification_runs` and `settlement_events` after B6/B7.

Execution order note:

- B5 has a Product Reframe version and an Auditability-enhanced version.
- The Product Reframe version must depend only on existing task, execution, verification payload, and ledger data.
- After B6 and B7 land, update the same response contract to prefer persisted `verification_runs` and `settlement_events` while keeping the derived fallback for old rows.

Definition of done:

- Agent key can read own execution.
- Publisher can read execution for own task.
- Unrelated user receives 403.
- Product Reframe MVP response does not claim persisted audit rows exist.

### Slice B6: Verification Runs

Files:

- new migration `backend/src/db/migrations/004_verification_runs.ts`
- `backend/src/db/types.ts`
- `backend/src/services/verificationRunService.ts`
- `backend/src/services/task/lifecycle.ts`
- tests

Tasks:

- Create table.
- Add service methods:
  - `startVerificationRun`
  - `completeVerificationRun`
  - `markVerificationFallback`
- Wrap `autoVerify` in lifecycle instrumentation.

Definition of done:

- auto_rules pass writes `passed`.
- auto_rules fail writes `failed`.
- auto_tests infra fallback writes `fallback_manual` or `infra_error`.
- verifier-passed but settlement-held records verification as `passed` plus settlement error detail rather than rewriting the verifier verdict.
- Manual mode does not create automatic run unless explicitly requested later.

### Slice B7: Settlement Events

Files:

- new migration `backend/src/db/migrations/005_settlement_events.ts`
- `backend/src/db/types.ts`
- `backend/src/services/settlementEventService.ts`
- `backend/src/services/task/settlement.ts`
- `backend/src/services/accountService.ts`
- `backend/src/services/riskFlagService.ts`
- tests

Tasks:

- Create table.
- Emit `escrowed` after publish escrow.
- Emit `paid` after accepted payout.
- Emit `refunded` after rejection refund.
- Emit `frozen` after risk freeze.
- Emit `released` or `confirmed` during risk flag resolution.
- Emit `superseded` when another execution wins.
- Emit `redeemed` when earned credits are redeemed.
- Use `settlement_group_id` to group multi-row ledger effects from one business action.
- Enforce idempotency with `idempotency_key`.

Definition of done:

- Reconcile still passes after seeded flows.
- Each money-moving settlement event linked to a ledger row matches that row's amount/class semantics.
- Multi-row gift/earned escrow and refund actions share one `settlement_group_id`.
- Redeem ledger rows are represented as `redeemed` events with `task_id = null`.
- Re-running event creation/backfill does not duplicate events.
- Event creation failure rolls back only when credit movement would become ambiguous.

### Slice B8: Audit Trace API

Files:

- new `backend/src/routes/audit.ts` or extend `tasks.ts`
- new `backend/src/services/auditTraceService.ts`
- tests

Tasks:

- Add `GET /tasks/:id/audit-trace`.
- Join task, executions, verification runs, settlement events, ledger refs, risk flags.
- Redact unrelated executor details based on principal.

Definition of done:

- Publisher gets full task trace.
- Executor agent gets own execution subset.
- Admin gets full trace.

### Slice B9: Agent Sessions

Files:

- new migration `backend/src/db/migrations/006_agent_sessions.ts`
- `backend/src/services/agentSessionService.ts`
- `backend/src/routes/accounts.ts` or `agentKeys.ts`
- `mcp-server/src/tools.ts`

Tasks:

- Upsert session on `who_am_i` or new heartbeat.
- Add `GET /agent-keys/:id/activity`.
- Add last seen and status to agent key responses.

Definition of done:

- MCP `who_am_i` updates last seen.
- UI can show online/offline state.
- Revoked key cannot heartbeat as online.

### Slice B10: Market Ops Backend

Files:

- `backend/src/routes/admin.ts`
- `backend/src/services/metricsService.ts`
- `backend/src/services/reconcileService.ts`
- `backend/src/services/riskFlagService.ts`
- new tests under `backend/test/integration/`

Tasks:

- Add verifier health metrics.
- Add settlement latency metrics.
- Add stale claim counts and later stale claim actions.
- Add risk review detail endpoint.
- Add operator notes for release/confirm only when persisted server-side.

Definition of done:

- Market Ops UI has real endpoints for every enforced action.
- Metrics endpoints are admin-token protected.
- Operator notes are persisted before the UI requires them.

## 8. Frontend Implementation Slices

### Slice F1: Shared Product Types

Files:

- `web/src/lib/types.ts`

Tasks:

- Add `VerificationSummary`.
- Add `SettlementSummary`.
- Add `TaskSummary`.
- Add `ExecutionDetail`.
- Add `MarketOverview`.
- Add `LedgerEntry`.

Definition of done:

- Existing routes compile.
- New API functions return typed payloads.

### Slice F2: Navigation and Overview

Files:

- `web/src/App.tsx`
- `web/src/components/Sidebar.tsx`
- new `web/src/routes/Overview.tsx`

Tasks:

- Add `/overview` route.
- Make overview the default authenticated route.
- Rename nav labels.
- Keep existing paths stable.

Definition of done:

- Sign-in redirects to overview.
- Sidebar labels match new product shape.
- Overview works with loading, error, empty states.

### Slice F3: Create Work Package Stepper

Files:

- `web/src/routes/Publish.tsx`
- optional `web/src/components/VerificationPackageEditor.tsx`

Tasks:

- Split form into steps.
- Add expected artifact field.
- Add validation per verification mode.
- Add settlement preview.

Definition of done:

- Invalid verifier config cannot submit.
- Generated payload matches backend schema.
- Manual and each auto mode can be published.

### Slice F4: Claimable Work Detail

Files:

- `web/src/routes/Browse.tsx`
- optional `web/src/components/WorkPackageDrawer.tsx`

Tasks:

- Show verification summary prominently.
- Add detail drawer.
- Add claimability states.
- Add disabled claim reasons.
- Present this as Work packages in owner console; use claimable-work semantics for MCP and server summaries.

Definition of done:

- Owner sees package status and agent claimability reasons.
- MCP agent receives claimable-work semantics through API/MCP.
- Verification mode is visible before action.

### Slice F5: Execution Detail

Files:

- `web/src/routes/Work.tsx`
- new `web/src/routes/ExecutionDetail.tsx`
- `web/src/App.tsx`

Tasks:

- Add execution detail route.
- Show lifecycle timeline.
- Add result metadata editor.
- Show verification and settlement summaries.

Definition of done:

- In-progress execution can submit.
- Submitted execution shows awaiting verification/review.
- Accepted/rejected execution shows score, feedback, settlement state.

### Slice F6: Review Queue

Files:

- `web/src/routes/Published.tsx`
- optional `web/src/components/SubmissionReviewPanel.tsx`

Tasks:

- Add status tabs.
- Show submitted artifact and verification package.
- Add feedback and score inputs.
- Add link to audit trace.

Definition of done:

- Owner can review submitted work with context.
- Accept/reject sends feedback/score.
- Settled tasks remain inspectable.

### Slice F7: Ledger

Files:

- `web/src/routes/Wallet.tsx`

Tasks:

- Rename UI to Ledger.
- Fetch ledger endpoint.
- Add filters and links.
- Show earned/gift/frozen separately.

Definition of done:

- Ledger rows render reason, class, delta, balance after.
- Frozen credits are clearly represented.
- Empty history has useful operational copy.

### Slice F8: Agent Identities

Files:

- `web/src/routes/AgentKeys.tsx`

Tasks:

- Rename UI to Agent identities.
- Add issued/active credential/revoked status first.
- Add last seen/online/offline only after B9.
- Add copyable MCP config.
- Add recent activity once API exists.

Definition of done:

- Existing issue/revoke still works.
- New MCP config is accurate for hosted endpoint and local npx flow.

### Slice F9: Market Ops

Files:

- `web/src/routes/Admin.tsx`

Tasks:

- Rename UI to Market ops.
- Add verifier health, stale claims, settlement latency.
- Add risk detail panel.
- Add required note for release/confirm after backend supports notes.

Definition of done:

- Existing reconcile and risk flag actions still work.
- New metrics degrade gracefully when unavailable.
- Any required note UX is disabled until B10 persists notes.

## 9. MCP Implementation Slices

### Slice M1: Response Copy and Summaries

Files:

- `mcp-server/src/tools.ts`
- `mcp-server/README.md`
- `skills/agent-worker/SKILL.md`
- `plugin/skills/agent-worker/SKILL.md`

Tasks:

- Update `fetch_tasks` output expectations to favor verification package summaries.
- Update `submit_result` text to distinguish accepted, rejected, awaiting review, and fallback.
- Update skill decision matrix to require artifact/verification fit before claim.

Definition of done:

- MCP build passes.
- Agent-worker skill tells agents to inspect acceptance criteria before claim.

### Slice M2: Execution Status Tool

Files:

- `mcp-server/src/tools.ts`

Tasks:

- Add `get_execution_status`.
- Call backend `GET /executions/:id`.
- Return compact JSON plus plain-language status line.

Definition of done:

- Agent can poll after submit.
- Tool reports verification and settlement state.

### Slice M3: Settlement Trace Tool

Files:

- `mcp-server/src/tools.ts`

Tasks:

- Add `get_settlement_trace`.
- Call backend audit/settlement trace endpoint.
- Return ledger refs when available.

Definition of done:

- Accepted work shows payout event.
- Rejected work shows refund or no-payout state.
- Risk-held work is distinguishable from paid work.

### Slice M4: Task Fit Explanation Tool

Files:

- `mcp-server/src/tools.ts`

Tasks:

- Add `explain_task_fit`.
- Call task detail/verification endpoint with server-derived `claimability`.
- Return claimability, reputation requirement, compute-source requirement, expected artifact, verification summary, and known reasons not to claim.

Definition of done:

- Tool uses backend claimability codes rather than local duplicated rules.
- Agent can decide not to claim without reading raw task JSON.
- Hidden verifier internals remain redacted according to the visibility policy.

## 10. Documentation Updates

Files:

- `README.md`
- `website/src/content/docs/concepts/overview.md`
- `website/src/content/docs/concepts/verification.md`
- `website/src/content/docs/concepts/credits.md`
- `website/src/content/docs/mcp/tools.md`
- `website/src/content/docs/mcp/worker-loop.md`
- `website/src/content/docs/start/quickstart.md`

Tasks:

- Introduce work package, verification run, execution, settlement event, agent identity.
- Update diagrams and examples after API contracts land.
- Add self-host operator flow: reconcile, risk holds, verifier health.
- Add a compliance-positioning section ("why we refuse subscription-OAuth credentials and prefer Tier 1 local models") as an outward-facing differentiator, not just registration-validation behavior.
- State the value-exit stance for earned credits (see §4.5): what redemption is, what gates its unlock, and that it is intentionally not part of the verifiability/auditability MVPs.

Definition of done:

- Docs describe the implemented object model.
- Quickstart shows owner account -> agent identity -> MCP -> claim -> submit -> settlement trace.

## 11. Execution Order

### Milestone 0: Contract Freeze

Goal:

Agree and encode additive response types without changing existing behavior.

Work:

- B1
- F1
- M1 copy-only updates

Exit criteria:

- Backend, web, MCP build.
- Existing tests pass.
- New types compile.
- Task/execution response changes are additive only.

### Milestone 1: Product Reframe MVP

Goal:

Make the owner/operator console feel like verifiable agent work while deriving summaries from existing task, execution, and ledger data. This milestone does **not** persist `verification_runs` or `settlement_events`.

Work:

- B2
- B3
- B4
- B5
- F2
- F3
- F4
- F5
- F6
- F7

Exit criteria:

- Owner can create work package with acceptance criteria.
- Owner can inspect work package claimability and verification summary.
- MCP agent can inspect claimability and verification summary through existing/additive responses.
- Execution detail can show derived verification/settlement summaries from current execution and ledger state.
- Owner can review with verification context.
- Ledger screen reflects real ledger rows.
- No new audit-persistence claim is made yet.

### Milestone 2: Verifiability MVP

Goal:

Persist automatic verifier attempts as `verification_runs`.

Work:

- B6
- F5 detail timeline upgrades for latest verification run
- M2

Exit criteria:

- Auto verification creates verification run rows.
- Verifier pass/fail/fallback/infra-error states are distinguishable.
- MCP agent can inspect execution verification status after submit.
- Existing settlement behavior is unchanged except for recorded verifier attempts.

### Milestone 3: Auditability MVP

Goal:

Persist settlement traces and expose audit trace.

Work:

- B7
- B8
- F6 audit trace links
- F7 ledger trace links
- M3

Exit criteria:

- Settlement creates settlement event rows.
- Audit trace endpoint explains task lifecycle.
- MCP agent can inspect settlement after submit.
- Reconcile still proves credit conservation after traced settlement flows.

### Milestone 4: Agent Identity Control Plane

Goal:

Make agent keys operationally observable.

Work:

- B9
- F8
- M2 improvements
- docs updates

Exit criteria:

- Agent identity page shows online/offline/revoked.
- MCP heartbeat updates last seen.
- Owner can copy config and inspect activity.

### Milestone 5: Market Ops

Goal:

Make the project self-hostable as an operator-controlled market.

Work:

- B10
- F9
- docs updates

Exit criteria:

- Operator can answer "what is stuck?"
- Operator can answer "are credits conserved?"
- Operator can inspect and resolve risk holds with notes.

## 12. Test Matrix

| Area | Test | Command |
| --- | --- | --- |
| Backend types/build | TypeScript compile | `cd backend && npm run build` |
| Backend unit | domain and verifier units | `cd backend && npm run test:unit` |
| Backend integration | escrow, settlement, auth, risk | `cd backend && npm run test:integration` |
| Web build | Vite build and static output | `cd web && npm run build` |
| Web unit | existing vitest tests | `cd web && npm test` |
| MCP build | MCP TypeScript compile | `cd mcp-server && npm run build` |
| Website build | docs compile | `cd website && npm run build` |
| Ledger conservation | reconcile script | `cd backend && npm run build && node dist/scripts/reconcile.js` if script is compiled, otherwise existing `npm run` script |

Minimum verification before merging each milestone:

- Backend build
- Backend relevant tests
- Web build
- Web tests
- MCP build when MCP changed
- Website build when docs changed

Business invariant tests to add:

| Invariant | Scenario | Suggested location |
| --- | --- | --- |
| Owner and agent-key auth separation | Owner cannot claim; agent key cannot publish owner-only work package unless API explicitly allows it | `backend/test/integration/agentKey.test.cjs` or new auth matrix test |
| Claimability consistency | Task summary and MCP fit explanation return same `claimability` reason codes | new backend route test plus MCP e2e |
| Verification redaction | Pre-claim response hides hidden verifier internals; claimed executor/publisher/admin see authorized detail | new backend integration test |
| Verification run pass | auto_rules pass writes `verification_runs.status = passed` without changing current settlement semantics | new `backend/test/integration/verificationRuns.test.cjs` |
| Verification run fallback | auto_tests infra failure writes fallback/infra status and does not penalize agent | new `backend/test/integration/verificationRuns.test.cjs` |
| Risk fail-closed after verifier pass | verifier verdict remains `passed`; settlement state records held/failed detail | new settlement integration test |
| Multi-ledger escrow trace | gift+earned escrow creates grouped settlement events matching ledger rows | new `backend/test/integration/settlementEvents.test.cjs` |
| Multi-ledger refund trace | rejected task refunds gift/earned split with grouped settlement events | new `backend/test/integration/settlementEvents.test.cjs` |
| Risk freeze trace | payout then freeze creates paid/frozen trace and reconcile still passes | existing risk tests plus settlement event assertions |
| Redeem trace | earned redeem creates `redeemed` event linked to redeem ledger row | new settlement event integration test |
| Event idempotency | repeated event projection/backfill does not duplicate events | new settlement event integration test |
| MCP flywheel | fetch/explain/claim/submit/status/settlement trace | `mcp-server/scripts/mcp-e2e.mjs` or new script |

Milestone-specific test gates:

### Milestone 0 Test Gate

- Mapper unit tests for manual, auto_rules, auto_tests, and auto_llm summaries.
- Contract integration test proves task list/detail fields are additive and existing payload shape remains compatible.
- Backend build + backend unit tests.
- Web build + existing web tests.
- MCP build.

### Milestone 1 Test Gate

- Ledger route tests: owner ledger, authorized agent-key/owner wallet context where applicable, unrelated principal rejection, `limit <= 100`.
- Overview route tests: owner wallet/review/credential counts; no online/offline/last_seen before `agent_sessions`.
- Verification read tests: pre-claim redaction, claimed executor detail, publisher/admin full detail, unknown task 404.
- Execution detail tests: publisher allowed, owning agent key allowed for MCP/API status, unrelated principal rejected.
- Claimability tests: owner cannot claim, unspecified compute source blocked, low reputation blocked, eligible agent can claim.
- Frontend validation tests for work package publishing helpers: auto_rules requires rule, auto_tests requires tests, auto_llm requires rubric, non-manual requires expected artifact.

### Milestone 2 Test Gate

- Migration test for `verification_runs` table and status constraints.
- Service tests for start/complete/fallback run transitions.
- Submit lifecycle tests for auto_rules pass, auto_rules fail, auto_tests fallback, unexpected verifier exception, and verifier-passed settlement-held.
- MCP `get_execution_status` test proves latest verification state and next action are returned.

### Milestone 3 Test Gate

- Migration test for `settlement_events`, `settlement_group_id`, and `idempotency_key`.
- Integration tests for escrow split, payout, rejection refund split, risk freeze, review-only sample, superseded, redeem, and idempotent replay.
- Audit trace authorization tests: publisher full trace, executor subset, unrelated rejected, admin full trace.
- Reconcile still passes after traced flows.
- MCP `get_settlement_trace` distinguishes paid, rejected/refunded, and risk-held.

### Milestone 4 Test Gate

- Migration and service tests for `agent_sessions`.
- Heartbeat/who_am_i updates `last_seen_at`.
- Revoked key cannot heartbeat online.
- Owner can inspect own agent activity; unrelated owner cannot.

### Milestone 5 Test Gate

- Admin metrics require token.
- Risk release/confirm notes persist once required by UI.
- Verifier health, stale claim count, settlement latency, and risk detail endpoints have route tests.
- Existing risk/reconcile tests continue to pass.

## 13. Risks

### Risk: Owner console and agent workbench get mixed

Mitigation:

- Treat web console as owner/operator control plane.
- Keep agent execution loop MCP-first.
- Plan a separate Agent Console only if it becomes a deliberate product surface.

### Risk: MVP claims overstate auditability

Mitigation:

- Product Reframe MVP may claim owner-console clarity and derived summaries.
- Verifiability claims require `verification_runs`.
- Auditable settlement claims require `settlement_events` and audit trace.

### Risk: Verification visibility leaks verifier answers

Mitigation:

- Apply the visibility policy before B4/F4/M1.
- Use redacted summaries before claim.
- Expose full criteria only to publisher/admin/authorized claimed executor unless marked hidden.

### Risk: Settlement events drift from credit ledger

Mitigation:

- Keep `credit_ledger` authoritative.
- Use one settlement event per ledger row and `settlement_group_id` for multi-row business actions.
- Add tests that compare settlement event amount/class with ledger row when linked.
- Make trace writes transactional with credit writes where ambiguity would be harmful.

### Risk: UI gets too complex for MVP

Mitigation:

- Keep Product Reframe URLs stable.
- Use detail drawers/routes instead of stuffing every field into list rows.
- Ship labels and summary types before migrations.

### Risk: Verification run persistence changes payout behavior

Mitigation:

- Add run persistence without changing verifier verdict semantics.
- Keep fallback behavior identical to current `submitResult` until tests cover the new path.
- Record verifier verdict and settlement-finalization errors separately.

### Risk: MCP tools become verbose

Mitigation:

- Keep `fetch_tasks` compact.
- Put detail behind `get_execution_status`, `get_settlement_trace`, and `explain_task_fit`.

### Risk: Agent sessions imply real-time guarantees

Mitigation:

- Present status as "last seen", not guaranteed online.
- Use conservative offline threshold.

## 14. Definition Of Done For The Repositioning

### Product Reframe MVP Done

The first publishable repositioning milestone is complete when:

- The console default route is Overview, not Browse.
- Navigation uses protocol/product terms: Work packages, Executions, Review queue, Create work package, Ledger, Agent identities, Market ops.
- Publish flow requires acceptance criteria appropriate to verification mode.
- Work package views expose verification mode, expected artifact, and server-derived claimability.
- Execution detail exposes derived verification and settlement summaries after submit.
- Ledger screen reads real ledger rows.

### Verifiability MVP Done

The machine-verifiability milestone is complete when:

- Auto verification writes `verification_runs`.
- Verification run states distinguish passed, failed, fallback_manual, and infra_error.
- MCP tools can inspect execution verification status.

### Auditability MVP Done

The auditable-settlement milestone is complete when:

- Money movement writes grouped `settlement_events` linked to ledger rows.
- Audit trace explains task, execution, verification, settlement, ledger refs, and risk state.
- MCP tools can inspect settlement trace.
- Reconcile still proves credit conservation.

### Full Operational Repositioning Done

The broader operational repositioning is complete when:

- Docs define work package, verification run, execution, settlement event, and agent identity.
- Agent identities expose last-seen/activity once `agent_sessions` ships.
- Market Ops exposes reconcile, risk holds, verifier health, stale claims, and settlement latency with real backend endpoints.

## 15. Suggested Implementation Staffing

Solo sequence:

1. B1 + F1
2. B2/B3/B4/B5
3. F2 through F7
4. B6 + M2
5. B7/B8 + M3
6. M4
7. B9/F8
8. B10/F9/docs

Parallel sequence:

- Backend lane: B1 through B8, with B10 later for Market Ops.
- Frontend lane: F1 through F7 after B1 response contracts.
- MCP lane: M1 immediately, M2 after execution status API, M3 after audit trace API, M4 after claimability contract.
- Docs lane: terminology now, endpoint examples after APIs land.
- Verification lane: backend integration tests and e2e MCP flywheel.

## 16. Open Product Decisions

These do not block Product Reframe MVP unless noted:

- Should expected artifact evolve from the Product Reframe enum to JSON schema for structured outputs?
- Should settlement events be exposed to agent keys fully or with publisher/account redaction?
- What offline threshold defines an inactive agent session?
- Should owner-created manual tasks require an acceptance checklist even when `mode = manual`?
- Value exit (see §4.5): should earned credits redeem only for in-ecosystem value (e.g., API/compute quota) or grow an external settlement rail analogous to the competitor's x402/USDC? What are the conservation, risk, and compliance gates on unlocking `REDEEM_ENABLED`?
- Public reputation: should agent-identity reputation become externally discoverable (a queryable public score, as dealwork.ai's Pact Score is) to extend the verifiability narrative beyond settlement? Consistent with the verifiable-work positioning, but not required for the owner→agent (non-A2A) model; out of MVP scope.

## 17. Multi-Expert Review Record

Review mode:

- Product/UX reviewer
- Architecture/API reviewer
- Test strategy reviewer
- Adversarial critic

Verdict:

- Original detailed plan required revision before implementation.
- Direction was approved: MCP-native verifiable agent work, owner/operator console, MCP-first agent execution, incremental read models over current `tasks`/`credit_ledger`/`agent_keys`.
- Execution was blocked until role boundary, milestone DoD, settlement-event mapping, verification-run status semantics, redaction, claimability, and test gates were made explicit.

Accepted revisions:

- Web Console is owner/operator control plane; agent keys execute primarily through MCP.
- Product Reframe MVP, Verifiability MVP, Auditability MVP, Agent Identity, and Market Ops are separate milestones with separate DoD.
- `settlement_events` are append-only projections, not a second ledger truth source.
- One money-moving settlement event maps to one ledger row; multi-row business actions share `settlement_group_id`.
- `idempotency_key` is required to prevent duplicate trace events.
- Existing redeem credit flow is included as `redeemed` settlement events with `task_id = null`.
- Verification package visibility/redaction is now a Product Reframe policy, not a later open decision.
- `verification_runs` state machine now distinguishes verifier verdict from settlement-finalization errors.
- Server-derived `claimability` is a first-class contract for UI and MCP.
- Milestone-specific blocking test gates were added.
- `explain_task_fit` is now an explicit MCP slice.
- Market Ops now has a backend slice before UI-required operator notes.

Rejected reviewer item:

- One architecture review claimed app frontend files should be under `website/src`. This is not applicable to this repository: the application console is under `web/src`, while `website/src` is the documentation site. The plan keeps `web/src` for console implementation slices and `website/src` for docs.
