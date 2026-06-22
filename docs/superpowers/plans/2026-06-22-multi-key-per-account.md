# Multi-Key per Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one human owner account hold many agent API keys — each an independent execution identity (own reputation + task history) — while all earnings pool into the owner's wallet; with a console page to issue/name/revoke keys.

**Architecture:** New `agent_keys` table (owner_account_id, name, api_key_hash, compute_source, reputation, status). Auth resolves a key to a discriminated principal — `owner` (publish/redeem/manage keys) or `agent` (browse/claim/submit) — via `requireOwner`/`requireAgent` guards. Settlement credits the owner wallet; reputation/task-count bump the agent key. Credit ledger stays `account_id`-keyed (conservation unchanged). A console "Agent keys" page manages them. Strict separation: owner accounts no longer execute directly (breaking; prod has no real users yet).

**Tech Stack:** Fastify + Kysely (Postgres), TypeScript; Vite + React console. Migrations via Kysely `FileMigrationProvider` (auto-discovered by filename). `hashApiKey` = sha256.

**Spec:** `docs/superpowers/specs/2026-06-22-multi-key-per-account-design.md`

---

## File Structure

```
backend/src/db/migrations/003_agent_keys.ts   # CREATE — agent_keys table (idempotent)
backend/src/db/types.ts                        # MODIFY — add AgentKeysTable to DB interface
backend/src/services/agentKeyService.ts        # CREATE — issue/list/revoke/resolve/bumpReputation
backend/src/middleware/auth.ts                 # MODIFY — resolve key → discriminated principal
backend/src/middleware/principal.ts            # CREATE — requireOwner / requireAgent guards
backend/src/routes/agentKeys.ts                # CREATE — POST/GET/DELETE /accounts/me/agent-keys
backend/src/routes/accounts.ts                 # MODIFY — register agentKeys routes / owner guards
backend/src/routes/tasks.ts                    # MODIFY — claim/submit require agent; publish/verify require owner
backend/src/routes/events.ts                   # MODIFY — agent-key principal for the SSE stream
backend/src/services/task.ts                   # MODIFY — execution + settlement use agentKey id + owner wallet
backend/test/agentKey.test.ts                  # CREATE — service + auth principal tests
web/src/routes/AgentKeys.tsx                   # CREATE — console key-management page
web/src/components/Sidebar.tsx                 # MODIFY — add "Agent keys" nav entry
web/src/App.tsx                                # MODIFY — /agent-keys route
web/src/lib/types.ts                           # MODIFY — AgentKey type
```

> **Principal model (used throughout):** `auth.ts` attaches `req.principal`:
> `{ kind: 'owner', account }` or `{ kind: 'agent', agentKey, ownerAccount }`.
> `req.account` is kept populated (= the owner account in both cases) so existing
> wallet/publish code that reads `req.account` keeps working; execution code reads
> `req.principal` to get the agent key.

---

## Task 1: `agent_keys` migration + DB types

**Files:**
- Create: `backend/src/db/migrations/003_agent_keys.ts`
- Modify: `backend/src/db/types.ts`

- [ ] **Step 1: Create `backend/src/db/migrations/003_agent_keys.ts`** (idempotent, same style as 002)

```ts
import { Kysely, sql } from 'kysely';

/**
 * 003_agent_keys — one owner account holds many agent keys (CLAWMIN multi-key).
 *
 * Each agent key is an INDEPENDENT execution identity: its own reputation and
 * task count and compute_source. The owner account keeps the wallet
 * (earned/gift/frozen) and publishes tasks; earnings from any agent key pool to
 * the owner. Auth resolves a credential to either an owner account or an agent
 * key (see middleware/auth.ts).
 *
 * Idempotent (IF NOT EXISTS) — same contract as 001/002.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS agent_keys (
      id UUID PRIMARY KEY,
      owner_account_id UUID NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL,
      api_key_hash TEXT NOT NULL UNIQUE,
      compute_source TEXT NOT NULL DEFAULT 'unspecified'
        CHECK (compute_source IN ('unspecified', 'local_model', 'payg_api_key', 'platform_credit', 'token_plan_whitelist')),
      reputation_score DOUBLE PRECISION NOT NULL DEFAULT 5.0,
      total_tasks_completed INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_keys_owner ON agent_keys(owner_account_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS agent_keys`.execute(db);
}
```

- [ ] **Step 2: Add the table to the DB interface in `backend/src/db/types.ts`.** Read the file; find the `Database`/`DB` interface listing tables. Add:

```ts
export interface AgentKeysTable {
  id: string;
  owner_account_id: string;
  name: string;
  api_key_hash: string;
  compute_source: string;
  reputation_score: number;
  total_tasks_completed: number;
  is_active: boolean;
  created_at: Date;
  revoked_at: Date | null;
}
```

And add `agent_keys: AgentKeysTable;` to the database interface alongside the
existing table entries (match the existing naming — e.g. if it's `interface DB { accounts: AccountsTable; ... }`).

- [ ] **Step 3: Run the migration against a test DB**

Run: `cd backend && DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run migrate`
Expected: applies `003_agent_keys`; no error. Verify: `psql "$DATABASE_URL" -c "\d agent_keys"` shows the table.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/003_agent_keys.ts backend/src/db/types.ts
git commit -m "feat(db): agent_keys table — owner holds many independent agent keys"
```

---

## Task 2: agentKeyService

**Files:**
- Create: `backend/src/services/agentKeyService.ts`
- Test: `backend/test/agentKey.test.ts`

- [ ] **Step 1: Write the failing test `backend/test/agentKey.test.ts`** (uses the project's existing test runner — check an existing test in `backend/test/` for the harness; these mirror its DB-backed style).

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import db from '../src/db/pool';
import { createAccount } from '../src/services/accountService';
import {
  issueAgentKey, listAgentKeys, revokeAgentKey, getAgentKeyByApiKey,
} from '../src/services/agentKeyService';

let ownerId: string;
beforeAll(async () => {
  const acc = await createAccount({ id: randomUUID(), type: 'human', name: 'owner-' + randomUUID().slice(0, 8) });
  ownerId = acc.id;
});

describe('agentKeyService', () => {
  it('issues a key, returns plaintext once, and resolves it back to the owner', async () => {
    const issued = await issueAgentKey({ ownerAccountId: ownerId, name: 'k1', computeSource: 'local_model' });
    expect(issued.api_key).toBeTruthy();
    const resolved = await getAgentKeyByApiKey(issued.api_key);
    expect(resolved?.owner_account_id).toBe(ownerId);
    expect(resolved?.name).toBe('k1');
  });

  it('lists the owner keys and revoke makes the key unresolvable', async () => {
    const issued = await issueAgentKey({ ownerAccountId: ownerId, name: 'k2', computeSource: 'local_model' });
    const list = await listAgentKeys(ownerId);
    expect(list.some((k) => k.name === 'k2')).toBe(true);
    await revokeAgentKey(ownerId, issued.id);
    const after = await getAgentKeyByApiKey(issued.api_key);
    expect(after).toBeNull(); // revoked keys do not resolve
  });
});
```

- [ ] **Step 2: Run it — fails (service not implemented)**

Run: `cd backend && DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run test/agentKey.test.ts`
Expected: FAIL — cannot import `agentKeyService`.

- [ ] **Step 3: Implement `backend/src/services/agentKeyService.ts`**

```ts
import { randomUUID, randomBytes } from 'crypto';
import db from '../db/pool';
import { hashApiKey } from '../domain/apiKey';

function newKey(): string {
  return 'atm_' + randomBytes(24).toString('hex');
}

export interface AgentKeyRow {
  id: string;
  owner_account_id: string;
  name: string;
  compute_source: string;
  reputation_score: number;
  total_tasks_completed: number;
  is_active: boolean;
  created_at: Date;
}

export async function issueAgentKey(params: {
  ownerAccountId: string;
  name: string;
  computeSource?: string;
}): Promise<AgentKeyRow & { api_key: string }> {
  const apiKey = newKey();
  const row = await db
    .insertInto('agent_keys')
    .values({
      id: randomUUID(),
      owner_account_id: params.ownerAccountId,
      name: params.name,
      api_key_hash: hashApiKey(apiKey),
      compute_source: params.computeSource ?? 'unspecified',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { ...(row as unknown as AgentKeyRow), api_key: apiKey };
}

export async function listAgentKeys(ownerAccountId: string): Promise<AgentKeyRow[]> {
  return (await db
    .selectFrom('agent_keys')
    .selectAll()
    .where('owner_account_id', '=', ownerAccountId)
    .orderBy('created_at', 'desc')
    .execute()) as unknown as AgentKeyRow[];
}

export async function revokeAgentKey(ownerAccountId: string, keyId: string): Promise<void> {
  await db
    .updateTable('agent_keys')
    .set({ is_active: false, revoked_at: new Date() })
    .where('id', '=', keyId)
    .where('owner_account_id', '=', ownerAccountId)
    .execute();
}

export async function getAgentKeyByApiKey(apiKey: string): Promise<AgentKeyRow | null> {
  const row = await db
    .selectFrom('agent_keys')
    .selectAll()
    .where('api_key_hash', '=', hashApiKey(apiKey))
    .where('is_active', '=', true)
    .executeTakeFirst();
  return (row as unknown as AgentKeyRow) ?? null;
}

export async function bumpAgentKeyReputation(keyId: string, newScore: number): Promise<void> {
  await db
    .updateTable('agent_keys')
    .set({ reputation_score: newScore, total_tasks_completed: (eb) => eb('total_tasks_completed', '+', 1) as any })
    .where('id', '=', keyId)
    .execute();
}
```

> Note: match the Kysely query style already used in `accountService.ts` (the
> `.set()` callback form for `+1` may differ — if the project uses `sql\`...\``
> increments, mirror that). The implementer adapts to the existing idiom.

- [ ] **Step 4: Run the test — passes**

Run: `cd backend && DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run test/agentKey.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/agentKeyService.ts backend/test/agentKey.test.ts
git commit -m "feat(account): agentKeyService — issue/list/revoke/resolve agent keys (tested)"
```

---

## Task 3: Auth principal resolution + guards

**Files:**
- Modify: `backend/src/middleware/auth.ts`
- Create: `backend/src/middleware/principal.ts`

- [ ] **Step 1: Read `backend/src/middleware/auth.ts`** (current: reads Bearer, `getAccountByApiKey`, sets `req.account`).

- [ ] **Step 2: Rewrite `backend/src/middleware/auth.ts`** to resolve the key against BOTH tables and attach a discriminated principal. Keep `req.account` = the owner account in both cases (so existing wallet/publish code is unaffected).

```ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { getAccountByApiKey, getAccountById, Account } from '../services/accountService';
import { getAgentKeyByApiKey, AgentKeyRow } from '../services/agentKeyService';

export type Principal =
  | { kind: 'owner'; account: Account }
  | { kind: 'agent'; agentKey: AgentKeyRow; ownerAccount: Account };

declare module 'fastify' {
  interface FastifyRequest {
    account: Account;        // always the owner account (kept for existing code)
    principal: Principal;
  }
}

/** Resolve a raw API key to a principal, or null. Exported for the SSE route. */
export async function resolvePrincipal(apiKey: string): Promise<Principal | null> {
  const account = await getAccountByApiKey(apiKey);
  if (account) return { kind: 'owner', account };
  const agentKey = await getAgentKeyByApiKey(apiKey);
  if (agentKey) {
    const ownerAccount = await getAccountById(agentKey.owner_account_id);
    if (ownerAccount) return { kind: 'agent', agentKey, ownerAccount };
  }
  return null;
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
  }
  const principal = await resolvePrincipal(authHeader.slice(7));
  if (!principal) return reply.status(401).send({ error: 'Invalid API key' });
  req.principal = principal;
  req.account = principal.kind === 'owner' ? principal.account : principal.ownerAccount;
}
```

- [ ] **Step 3: Create `backend/src/middleware/principal.ts`** — guards that assert the principal kind.

```ts
import { FastifyRequest, FastifyReply } from 'fastify';

/** Require an owner credential (publish, redeem, manage keys). */
export async function requireOwner(req: FastifyRequest, reply: FastifyReply) {
  if (req.principal?.kind !== 'owner') {
    return reply.status(403).send({ error: 'Owner credential required (this action is not available to agent keys)' });
  }
}

/** Require an agent-key credential (claim, submit, executions). */
export async function requireAgent(req: FastifyRequest, reply: FastifyReply) {
  if (req.principal?.kind !== 'agent') {
    return reply.status(403).send({ error: 'Agent key required (create one in the console to claim and execute tasks)' });
  }
}
```

- [ ] **Step 4: Add auth principal tests to `backend/test/agentKey.test.ts`** (append)

```ts
import { resolvePrincipal } from '../src/middleware/auth';

describe('resolvePrincipal', () => {
  it('resolves an owner account key to kind=owner', async () => {
    // createAccount returns api_key; issue under a fresh owner
    const { createAccount } = await import('../src/services/accountService');
    const acc = await createAccount({ id: randomUUID(), type: 'human', name: 'o-' + randomUUID().slice(0, 6) });
    const p = await resolvePrincipal(acc.api_key);
    expect(p?.kind).toBe('owner');
  });

  it('resolves an agent key to kind=agent with the owner attached', async () => {
    const issued = await issueAgentKey({ ownerAccountId: ownerId, name: 'k-auth', computeSource: 'local_model' });
    const p = await resolvePrincipal(issued.api_key);
    expect(p?.kind).toBe('agent');
    if (p?.kind === 'agent') expect(p.ownerAccount.id).toBe(ownerId);
  });

  it('returns null for an unknown key', async () => {
    expect(await resolvePrincipal('atm_nonexistent')).toBeNull();
  });
});
```

- [ ] **Step 5: Run the tests + backend typecheck**

Run: `cd backend && DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run test/agentKey.test.ts && npx tsc --noEmit`
Expected: tests PASS; typecheck clean. (`createAccount` must accept being called without agent fields for a human owner — confirm its signature; if `api_key` is returned as `api_key`, the test matches.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/middleware/auth.ts backend/src/middleware/principal.ts backend/test/agentKey.test.ts
git commit -m "feat(auth): resolve key to owner|agent principal + requireOwner/requireAgent guards"
```

---

## Task 4: Agent-keys endpoints

**Files:**
- Create: `backend/src/routes/agentKeys.ts`
- Modify: `backend/src/routes/accounts.ts` (register the routes) or `backend/src/index.ts` (wherever route plugins register)

- [ ] **Step 1: Create `backend/src/routes/agentKeys.ts`**

```ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { requireOwner } from '../middleware/principal';
import { issueAgentKey, listAgentKeys, revokeAgentKey } from '../services/agentKeyService';

const IssueSchema = z.object({
  name: z.string().min(1).max(120),
  compute_source: z.string().max(64).optional(),
});

export async function agentKeyRoutes(app: FastifyInstance) {
  // Issue a new agent key (shown once).
  app.post('/accounts/me/agent-keys', { preHandler: [authMiddleware, requireOwner] }, async (req, reply) => {
    const body = IssueSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const issued = await issueAgentKey({
      ownerAccountId: req.account.id,
      name: body.data.name,
      computeSource: body.data.compute_source,
    });
    return reply.status(201).send({
      id: issued.id,
      name: issued.name,
      compute_source: issued.compute_source,
      api_key: issued.api_key, // shown once
      message: 'Save this agent key — it will not be shown again.',
    });
  });

  // List the owner's agent keys (no secrets).
  app.get('/accounts/me/agent-keys', { preHandler: [authMiddleware, requireOwner] }, async (req, reply) => {
    const keys = await listAgentKeys(req.account.id);
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      compute_source: k.compute_source,
      reputation_score: k.reputation_score,
      total_tasks_completed: k.total_tasks_completed,
      is_active: k.is_active,
      created_at: k.created_at,
    }));
  });

  // Revoke an agent key.
  app.delete('/accounts/me/agent-keys/:id', { preHandler: [authMiddleware, requireOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await revokeAgentKey(req.account.id, id);
    return { revoked: id };
  });
}
```

- [ ] **Step 2: Register the routes.** Read `backend/src/index.ts` for the `app.register(...Routes, { prefix: '/api/v1' })` block and add:

```ts
import { agentKeyRoutes } from './routes/agentKeys';
// ...
await app.register(agentKeyRoutes, { prefix: '/api/v1' });
```

- [ ] **Step 3: Typecheck + build**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/agentKeys.ts backend/src/index.ts
git commit -m "feat(api): POST/GET/DELETE /accounts/me/agent-keys (owner-guarded)"
```

---

## Task 5: Execution & settlement use agent-key identity

**Files:**
- Modify: `backend/src/routes/tasks.ts` (claim/submit require agent; publish/verify require owner)
- Modify: `backend/src/routes/events.ts` (SSE accepts agent principal)
- Modify: `backend/src/services/task.ts` (execution row + reputation use the agent key; payout → owner wallet)

- [ ] **Step 1: Read `backend/src/routes/tasks.ts`** to see each route's current preHandler array and how it passes `req.account.id` into the service calls.

- [ ] **Step 2: Apply principal guards in `backend/src/routes/tasks.ts`.** Add `requireAgent` to claim/submit/my-executions; add `requireOwner` to publish/verify. Example — claim:

```ts
import { requireAgent, requireOwner } from '../middleware/principal';

// claim: agent identity required
app.post('/tasks/:id/claim', { preHandler: [authMiddleware, rateLimit, requireAgent] }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const principal = req.principal; // kind: 'agent'
  if (principal.kind !== 'agent') return reply.status(403).send({ error: 'Agent key required' });
  const execution = await claimTask(id, principal.agentKey.id); // executor = agent key id
  return reply.status(201).send(execution);
});
```

Apply the same pattern: `submit` and `my/executions` use `principal.agentKey.id` as
the executor; `publish` and `verify` add `requireOwner` and keep using
`req.account.id` (the owner). The reputation gate on claim reads
`principal.agentKey.reputation_score`.

- [ ] **Step 3: Update `backend/src/services/task.ts`.** Read it; change the execution/settlement functions so:
  - `claimTask(taskId, executorAgentKeyId)` and `submitResult(...)` store the
    **agent key id** in `task_executions.executor_id`.
  - On accept (`verifyResult`/auto-verify), the payout credits the **owner wallet**:
    resolve `ownerAccountId` from the agent key (`agent_keys.owner_account_id`) and
    credit that account; bump the **agent key's** reputation + `total_tasks_completed`
    via `bumpAgentKeyReputation` (and write a `reputation_events` row keyed to the
    agent key — extend `reputation_events` usage accordingly, or store agent key id
    in its `account_id` column per the strict-separation note).
  - Escrow on publish still debits the publishing **owner account** (unchanged).
  - The credit ledger row stays keyed by the owner `account_id` → conservation math
    unchanged.

> The implementer adapts the exact function signatures to what `task.ts` already
> exports. The invariant: **executor identity = agent key; money = owner account.**
> If `task_executions.executor_id` has a FK to `accounts(id)`, add a migration step
> to repoint it (or drop the FK) — note it and keep the migration idempotent.

- [ ] **Step 4: Update `backend/src/routes/events.ts`** — the SSE stream is an agent
  activity; allow an agent principal. Its existing `?api_key=` fallback should call
  `resolvePrincipal` and accept `kind: 'agent'` (or owner). Filter the stream by the
  resolved principal as today.

- [ ] **Step 5: Backend typecheck + full test suite**

Run: `cd backend && npx tsc --noEmit && DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test`
Expected: typecheck clean; the existing conservation/settlement tests still pass
(ledger stays owner-keyed); agentKey tests pass. Fix any signature mismatches.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/tasks.ts backend/src/routes/events.ts backend/src/services/task.ts
git commit -m "feat(tasks): executor identity = agent key, payout = owner wallet; principal guards"
```

---

## Task 6: Console "Agent keys" page

**Files:**
- Create: `web/src/routes/AgentKeys.tsx`
- Modify: `web/src/components/Sidebar.tsx` (nav entry), `web/src/App.tsx` (route), `web/src/lib/types.ts` (AgentKey type)

- [ ] **Step 1: Add the `AgentKey` type to `web/src/lib/types.ts`**

```ts
export interface AgentKey {
  id: string;
  name: string;
  compute_source: string;
  reputation_score: number;
  total_tasks_completed: number;
  is_active: boolean;
  created_at: string;
}
```

- [ ] **Step 2: Create `web/src/routes/AgentKeys.tsx`** — list + issue + revoke.

```tsx
import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Badge, Field, inputCls } from '../components/ui';
import type { AgentKey } from '../lib/types';

export function AgentKeys() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [name, setName] = useState('');
  const [source, setSource] = useState('local_model');
  const [issued, setIssued] = useState<string | null>(null);

  const load = () => request<AgentKey[]>('GET', '/accounts/me/agent-keys', { key: apiKey }).then(setKeys).catch(() => {});
  useEffect(() => { load(); }, [apiKey]);

  async function issue() {
    if (!name.trim()) return toast('Name the key', 'err');
    try {
      const r = await request<{ api_key: string }>('POST', '/accounts/me/agent-keys', { key: apiKey, body: { name: name.trim(), compute_source: source } });
      setIssued(r.api_key); setName(''); load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Issue failed', 'err'); }
  }
  async function revoke(id: string) {
    if (!confirm('Revoke this agent key? It stops working immediately.')) return;
    try { await request('DELETE', `/accounts/me/agent-keys/${id}`, { key: apiKey }); toast('Revoked'); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Revoke failed', 'err'); }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-h1">Agent keys</h1>
      <p className="text-sm text-ink-500">Each agent key is an independent worker — its own reputation and task history. Earnings from all your agents pool into your wallet.</p>

      <Card>
        <h2 className="text-sm font-semibold text-ink-800 mb-3">Issue a new agent key</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. claude-prod" /></Field>
          <Field label="Compute source">
            <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="local_model">Local open model (Tier 1)</option>
              <option value="payg_api_key">Pay-as-you-go API key</option>
              <option value="token_plan_whitelist">Whitelisted token plan</option>
              <option value="platform_credit">Platform-provided credit</option>
            </select>
          </Field>
        </div>
        <Button onClick={issue}>Issue key</Button>
        {issued && (
          <div className="mt-3">
            <p className="text-xs text-ink-500 mb-1">Save this key — shown once:</p>
            <div className="tabular text-xs bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 break-all">{issued}</div>
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="px-5 py-3.5 border-b border-ink-100"><h2 class="text-sm font-semibold text-ink-800">Your agent keys</h2></div>
        <div className="divide-y divide-ink-100">
          {keys.length ? keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between px-5 py-3">
              <div className="min-w-0">
                <span className="text-sm font-medium text-ink-900">{k.name}</span>
                <span className="ml-2"><Badge tone={k.compute_source === 'local_model' ? 'ok' : 'neutral'}>{k.compute_source}</Badge></span>
                {!k.is_active && <span className="ml-2"><Badge tone="muted">revoked</Badge></span>}
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className="tabular text-xs text-ink-500">rep {Number(k.reputation_score).toFixed(1)} · {k.total_tasks_completed} done</span>
                {k.is_active && <Button variant="danger" className="text-xs px-2.5 py-1" onClick={() => revoke(k.id)}>Revoke</Button>}
              </div>
            </div>
          )) : <p className="text-sm text-ink-400 px-5 py-6 text-center">No agent keys yet. Issue one above to start earning.</p>}
        </div>
      </Card>
    </div>
  );
}
```

> Fix the one intentional typo before building: the list-card header uses
> `class=` — change to `className=`. (Left here so the implementer verifies the
> build catches it.)

- [ ] **Step 3: Add the nav entry in `web/src/components/Sidebar.tsx`** — add to the
  `navGroups` "Account" group (the data-driven slot the prior cycle prepared):

```ts
import { KeyRound } from 'lucide-react';
// in the 'Account' group items array, add:
{ to: '/agent-keys', label: 'Agent keys', Icon: KeyRound },
```

- [ ] **Step 4: Add the route in `web/src/App.tsx`**

```tsx
import { AgentKeys } from './routes/AgentKeys';
// inside the <Route element={<ConsoleShell />}> block:
<Route path="/agent-keys" element={<AgentKeys />} />
```

- [ ] **Step 5: Build the web app**

Run: `cd web && npm run build`
Expected: PASS (the `class=` typo from Step 2 must be fixed to `className=` or the build/JSX errors — fix it). `app.html` emitted.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/AgentKeys.tsx web/src/components/Sidebar.tsx web/src/App.tsx web/src/lib/types.ts backend/public
git commit -m "feat(web): Agent keys console page (issue/list/revoke, per-key reputation)"
```

---

## Task 7: Final verification

- [ ] **Step 1: Migration + backend suite from clean**

Run: `cd backend && DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run migrate && npx tsc --noEmit && DATABASE_URL=... npm test`
Expected: `003_agent_keys` applied; typecheck clean; all tests pass (conservation + agentKey + principal).

- [ ] **Step 2: End-to-end principal behavior (curl, backend running)**

```
# owner registers, gets owner key
# issue an agent key:
curl -s -X POST localhost:3000/api/v1/accounts/me/agent-keys -H "Authorization: Bearer <OWNER_KEY>" -H 'content-type: application/json' -d '{"name":"k1","compute_source":"local_model"}'   # 201 + api_key
# owner key cannot claim:
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/v1/tasks/<id>/claim -H "Authorization: Bearer <OWNER_KEY>"   # 403
# agent key can browse/claim:
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/v1/tasks -H "Authorization: Bearer <AGENT_KEY>"   # 200
# agent key cannot manage keys:
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/v1/accounts/me/agent-keys -H "Authorization: Bearer <AGENT_KEY>"   # 403
```
Expected: owner-only and agent-only guards behave as above.

- [ ] **Step 3: Web build green**

Run: `cd web && npm run build && ls ../backend/public/app.html`
Expected: PASS.

- [ ] **Step 4: Designer review** of `AgentKeys.tsx` (read-only → polish), matching the console aesthetic. Rebuild + commit.

---

## Self-Review (against the spec)

**Spec coverage:**
- `agent_keys` table (independent identity) → Task 1. ✓
- agentKeyService issue/list/revoke/resolve/bumpReputation → Task 2. ✓
- Auth resolves owner|agent principal + guards → Task 3. ✓
- Endpoints `POST/GET/DELETE /accounts/me/agent-keys` (owner-guarded) → Task 4. ✓
- Execution identity = agent key; payout = owner wallet; reputation per-key; claim/submit need agent, publish/verify need owner → Task 5. ✓
- Ledger stays owner-keyed (conservation) → Task 5 Step 3 invariant + Task 7 Step 1 (suite). ✓
- Console full key-management page + sidebar slot → Task 6. ✓
- Strict separation (owner can't execute) → Task 5 guards + Task 7 Step 2 (403 checks). ✓

**Placeholder scan:** No TBD/TODO. Two deliberate implementer-verification notes (the Kysely `+1` idiom in Task 2; the planted `class=`→`className=` typo in Task 6) are explicit checks with the exact fix, not open placeholders. Task 5 Step 3 intentionally defers exact signatures to "adapt to what `task.ts` exports" — flagged as the one area needing the implementer to read existing code, with the hard invariant stated (executor = agent key, money = owner).

**Consistency:** `resolvePrincipal`/`req.principal`/`Principal` (Task 3) used in Tasks 4–5; `req.account` = owner everywhere; `agentKeyService` names (`issueAgentKey`, `listAgentKeys`, `revokeAgentKey`, `getAgentKeyByApiKey`, `bumpAgentKeyReputation`) consistent across Tasks 2–6; endpoint paths `/accounts/me/agent-keys` identical in Task 4 (backend) and Task 6 (frontend); `AgentKey` type fields match the GET response shape in Task 4.

**One risk flagged:** Task 5 Step 3 — if `task_executions.executor_id` has a FK `REFERENCES accounts(id)`, storing an agent key id violates it. The task notes adding an idempotent migration step to repoint/drop that FK. The implementer must check `001_initial.ts` (it does: `executor_id UUID NOT NULL REFERENCES accounts(id)`) and include that migration, or the claim insert will fail. **This is the highest-risk step; review it first.**

