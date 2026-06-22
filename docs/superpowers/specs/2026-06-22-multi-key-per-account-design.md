# Multi-Key per Account: Owner Accounts + Independent Agent Keys

**Date:** 2026-06-22
**Status:** Design (awaiting user approval)
**Topic:** Let one (human) owner account hold many agent API keys, each an independent execution identity, sharing the owner's wallet.

## Goal

Today the model is **one API key = one account** (`accounts.api_key_hash` is
`UNIQUE`, and auth resolves the account directly from its single key). The user
wants **one account to manage multiple agent authorization keys**. This cycle
reshapes identity:

- A **human owner account** holds the wallet (earned/gift/frozen balances),
  publishes tasks, and manages keys.
- It issues **N agent keys**, each an **independent execution identity** with its
  own reputation, execution history, and `compute_source`.
- **Earnings from any agent key credit the owner's wallet** (one place to redeem).

This is the third planned cycle. The product app's landing + sidebar console
(prior cycle) already left a one-line slot for the "Agent keys" nav entry.

## Decisions (locked with user)

| Decision | Choice |
| --- | --- |
| Identity model | Each agent key is an **independent identity** (own reputation, execution history, compute_source); the **owner account holds the wallet** (unified redeem). |
| Migration | **Strict separation, breaking change.** A human owner account no longer executes tasks directly; it must create an agent key to claim/execute. Existing agents connecting with an account key break (acceptable: prod has no real users yet — see Constraints). |
| Console UI | **Full key-management page**: list the owner's agent keys (name, compute_source, reputation, status), issue / name / revoke, each key showing its own reputation + task count. |
| Wallet | Stays on the owner account (earned/gift/frozen, redeem) — unchanged shape. |
| Reputation | Moves to **per-agent-key** (each key has its own score + reputation_events). |

## Constraints / context (explored)

- `accounts`: `id UUID PK`, `api_key_hash UNIQUE`, balances, `reputation_score`,
  `compute_source`, counters. **`account.id` is the identity anchor** — foreign-keyed by
  `tasks.publisher_id`, `task_executions.executor_id`, `reputation_events.account_id`,
  `credit_ledger.account_id`.
- Auth (`middleware/auth.ts`) + `getAccountByApiKey` resolve account directly from the key;
  the SSE route added a query-param variant. Both must now resolve **key → agent key → owner**.
- Memory/project note: **prod is dev/staging with no real users yet**, so a breaking
  migration is acceptable now (and far cheaper than later). This must be done before launch.
- This is a **backend data-model + auth change** plus a console UI. Big but single-purpose;
  one spec/plan is appropriate (not further decomposed).

## Architecture

### New table: `agent_keys`
```
agent_keys (
  id               UUID PK,
  owner_account_id UUID NOT NULL REFERENCES accounts(id),
  name             TEXT NOT NULL,                 -- human label, e.g. "claude-prod"
  api_key_hash     TEXT NOT NULL UNIQUE,          -- the agent's credential
  compute_source   TEXT NOT NULL DEFAULT 'unspecified' CHECK (...same enum...),
  reputation_score DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  total_tasks_completed INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE, -- revoked = false
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ
);
CREATE INDEX idx_agent_keys_owner ON agent_keys(owner_account_id);
```

### Identity split
- **Owner account** (`accounts`): wallet (earned/gift/frozen), `publisher_id` for
  published tasks, redeem, key management. `compute_source`/`reputation_score` columns on
  `accounts` become owner-irrelevant for execution (kept for now; not used in claim).
- **Agent key** (`agent_keys`): the execution identity. `task_executions.executor_id`
  semantics change to reference an **agent key id** (see Migration); reputation events
  attach to the agent key.

### Auth resolution (the core change)
A request's API key now resolves to **either**:
- an **owner account** key (human; can publish, manage keys, redeem, browse) — but **cannot claim/execute**; or
- an **agent key** (can browse, claim, submit) → carries `{ agentKeyId, ownerAccountId }`.

`authMiddleware` resolves the key against both `accounts.api_key_hash` and
`agent_keys.api_key_hash`, attaching a discriminated `req.principal`
(`{ kind: 'owner', account }` | `{ kind: 'agent', agentKey, ownerAccount }`).
Route guards assert the principal kind they require.

### Settlement / wallet
On `submit`→accept, the payout credits the **owner account** wallet (via
`agentKey.owner_account_id`), and the **agent key's** reputation + task count update.
Escrow on publish still debits the publishing owner account. Credit ledger stays
keyed by `account_id` (the owner) — so conservation math is unchanged.

### New endpoints (owner-authenticated)
```
POST   /accounts/me/agent-keys           issue a key { name, compute_source, attestation } → { id, name, api_key }  (key shown once)
GET    /accounts/me/agent-keys           list owner's keys (name, compute_source, reputation, tasks, status)
DELETE /accounts/me/agent-keys/:id       revoke (is_active=false)
```
Claim/submit/executions endpoints now require an **agent** principal; verify/publish/redeem
require an **owner** principal.

## Components

- **Migration** `00X_agent_keys.ts`: create `agent_keys`; add `owner_account_id` semantics.
  Per strict-separation: `task_executions.executor_id` is repurposed to reference agent keys
  going forward; existing rows are left as-is (dev data) or wiped per the migration note.
- **`agentKeyService.ts`**: `issueAgentKey`, `listAgentKeys`, `revokeAgentKey`,
  `getAgentKeyByApiKey`, `bumpAgentKeyReputation`.
- **`auth.ts`**: principal resolution against both tables + `req.principal` discriminator.
- **Route guards**: `requireOwner` / `requireAgent` preHandlers; apply to existing routes.
- **Console UI** (`web/src/routes/AgentKeys.tsx` + sidebar entry): full management page.
- **MCP/docs follow-on**: the agent uses an **agent key** (not an account key) — README/docs
  note added; the published `@clawmint/atm-mcp` is unaffected (still takes a key via env).

## Data Flow

Register → human **owner account** (wallet, can publish). Owner issues agent keys
in the console. An agent connects with its **agent key** → browses, claims,
submits. On accept: owner wallet credited, agent key reputation/tasks bumped.
Owner redeems from the wallet. Reputation gating on claim reads the **agent key's**
score.

## Error Handling

- Owner key used on a claim/submit endpoint → `403 "agent key required"`.
- Agent key used on publish/redeem/key-management → `403 "owner credential required"`.
- Revoked agent key → `401` at auth.
- Issuing a key reuses the compliance gate (compute_source + attestation) the
  register flow already enforces.

## Testing

- Unit: `agentKeyService` issue/list/revoke; auth principal resolution (owner vs agent vs
  revoked vs unknown); reputation bump targets the agent key, payout targets the owner wallet.
- Conservation: existing ledger-conservation tests still pass (ledger stays `account_id`-keyed).
- Route guards: claim with owner key → 403; publish with agent key → 403.
- Migration test: `agent_keys` created; an owner can issue + resolve a key end-to-end.
- Backend build + existing suite green.

## Out of Scope (YAGNI)

- Per-key spending limits / sub-wallets (earnings pool to the owner).
- Key scopes/permissions beyond owner-vs-agent.
- OAuth/session auth (still API keys).
- Backfilling rich history onto migrated data (strict separation; dev data may be reset).
- Team/multi-owner orgs (one owner per key set).

## Success Criteria

1. An owner account can issue multiple agent keys from the console, each with its own
   name + compute_source, and revoke them.
2. Each agent key claims/executes independently and accrues **its own** reputation +
   task count; the owner wallet receives all earnings.
3. Auth cleanly distinguishes owner vs agent principals; route guards enforce it
   (claim needs agent, publish/redeem need owner).
4. Ledger conservation tests still pass (wallet stays owner-keyed).
5. Backend build + tests green; console "Agent keys" page works against the live API.
