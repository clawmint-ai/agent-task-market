# Owner Email + Password Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace owner api_key paste-to-login with real email+password auth backed by instantly-revocable server-side sessions; agent-key auth stays unchanged.

**Architecture:** Owner and agent credentials fork into two paths — owner uses a session token (`ses_` prefix) resolved against a new `sessions` table; agent uses its api_key (`atm_` prefix) resolved against `agent_keys`. The `Principal` union type and all downstream authorization (`requireOwner`/`requireAgent`/`req.account`) are unchanged; only the auth entrypoint (`resolvePrincipal`) and the register/login/logout routes change. Passwords are bcryptjs-hashed; session tokens are stored as sha256 hashes.

**Tech Stack:** Fastify, Kysely (Postgres), zod, bcryptjs, React + Vite, node:test / tsx --test.

**Spec:** `docs/superpowers/specs/2026-06-23-owner-password-auth-design.md`

## Global Constraints

- Password hashing: `bcryptjs` (pure-JS, avoids native-build/sandbox EPERM issues). NEVER use the existing sha256 `hashApiKey` for passwords.
- Session token plaintext = `ses_` + `crypto.randomBytes(24).toString('hex')`; store sha256 of the FULL plaintext (incl. `ses_`) in `sessions.token_hash`. Plaintext returned once at login/register.
- Agent key auth is UNCHANGED: `atm_` prefix, `agent_keys`, `getAgentKeyByApiKey`, `Bearer`.
- `Principal` union type stays `{kind:'owner',account} | {kind:'agent',agentKey,ownerAccount}`. Do not change downstream authz.
- Destructive migration is acceptable: pre-launch, no real users. No dual-auth compatibility.
- Login failure returns 401 "Invalid email or password" (no account-enumeration distinction).
- Password min length: 8 (zod, backend-enforced; frontend mirrors).
- Migration naming continues the sequence: `004_*`, `005_*`. Migrations are idempotent (`IF NOT EXISTS`), with `up`/`down`.
- Integration tests require `DATABASE_URL`; they run against compiled `dist/` via `node --test` and `setupSchema()`.
- Branch from latest `main` (PR #80 already merged owner-only SignIn). Frequent commits.

## File Structure

**Backend — create:**
- `backend/src/db/migrations/004_owner_password.ts` — add `accounts.password_hash` (nullable).
- `backend/src/db/migrations/005_sessions.ts` — `sessions` table.
- `backend/src/domain/password.ts` — bcryptjs hash/verify (pure, no I/O).
- `backend/src/services/sessionService.ts` — create/resolve/revoke session.
- `backend/test/integration/ownerAuth.test.cjs` — register/login/logout/session/principal-fork.

**Backend — modify:**
- `backend/src/db/types.ts` — add `password_hash` to `AccountsTable`; add `SessionsTable` + `sessions` to `Database`.
- `backend/src/services/accountService.ts` — `createAccount` takes optional `password`; store hash. Keep api_key for agent-key/seed compatibility.
- `backend/src/middleware/auth.ts` — fork `resolvePrincipal` by token prefix; owner via session.
- `backend/src/routes/accounts.ts` — register requires email+password, returns session token (no api_key); add `POST /accounts/login`, `POST /accounts/logout`.
- `backend/test/integration/agentKey.test.cjs` — update the `resolvePrincipal(owner.api_key)` assertion (owner no longer auth's via api_key).

**Frontend — modify:**
- `web/src/lib/auth.tsx` — store session token (`atm.session`); expose `{token, login, logout}`.
- `web/src/lib/api.ts` — global 401 → clear session, redirect `/signin`.
- `web/src/routes/SignIn.tsx` — email+password login & register; remove api_key reveal card.
- `web/src/components/Sidebar.tsx` (or `ConsoleShell.tsx`) — logout button.

---

## Task 1: Install bcryptjs

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install bcryptjs + types**

Run:
```bash
cd backend && npm install bcryptjs@^2.4.3 && npm install -D @types/bcryptjs@^2.4.6
```
Expected: both added to `backend/package.json`; `node_modules/bcryptjs` exists.

- [ ] **Step 2: Verify it imports under tsx**

Run:
```bash
cd backend && npx tsx -e "const b=require('bcryptjs'); console.log(typeof b.hashSync)"
```
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore(backend): add bcryptjs for owner password hashing"
```

---

## Task 2: Migration 004 — accounts.password_hash

**Files:**
- Create: `backend/src/db/migrations/004_owner_password.ts`
- Modify: `backend/src/db/types.ts:20-38` (AccountsTable)

**Interfaces:**
- Produces: `accounts.password_hash` nullable TEXT column; `AccountsTable.password_hash: string | null`.

- [ ] **Step 1: Write the migration**

Create `backend/src/db/migrations/004_owner_password.ts`:
```typescript
import { Kysely, sql } from 'kysely';

/**
 * 004_owner_password — owners authenticate with email + password.
 *
 * Adds a nullable password_hash to accounts. Nullable (not NOT NULL) so system
 * accounts created by seed/ingest scripts — which never log into the web console
 * — remain valid without a password. The login route enforces password_hash IS
 * NOT NULL; a row without one simply cannot password-login. Owner api_key is
 * retired as a *login* credential (see middleware/auth.ts); the api_key_hash
 * column stays for agent-key/seed compatibility.
 *
 * Idempotent (IF NOT EXISTS) — same contract as 001/002/003.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_hash TEXT`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE accounts DROP COLUMN IF EXISTS password_hash`.execute(db);
}
```

- [ ] **Step 2: Add the column to the Kysely type**

In `backend/src/db/types.ts`, inside `AccountsTable` (after `api_key_hash: string;` around line 25), add:
```typescript
  password_hash: ColumnType<string | null, string | null | undefined, string | null>;
```

- [ ] **Step 3: Build to verify types compile**

Run: `cd backend && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/004_owner_password.ts backend/src/db/types.ts
git commit -m "feat(db): migration 004 — accounts.password_hash (nullable)"
```

---

## Task 3: Password domain helper

**Files:**
- Create: `backend/src/domain/password.ts`
- Test: `backend/test/unit/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/unit/password.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { hashPassword, verifyPassword } from '../../src/domain/password';

test('hashPassword produces a bcrypt hash that verifies', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple', 'never stores plaintext');
  assert.match(hash, /^\$2[aby]\$/, 'is a bcrypt hash');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
});

test('verifyPassword rejects a wrong password', async () => {
  const hash = await hashPassword('right-password');
  assert.equal(await verifyPassword('wrong-password', hash), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test test/unit/password.test.ts`
Expected: FAIL — cannot find module `../../src/domain/password`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/domain/password.ts`:
```typescript
import bcrypt from 'bcryptjs';

// Owner password hashing. bcryptjs is pure-JS (no native build) and self-salts.
// NEVER use the sha256 hashApiKey for passwords — it is a fast hash for key lookup.
const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx tsx --test test/unit/password.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/password.ts backend/test/unit/password.test.ts
git commit -m "feat(auth): bcryptjs password hash/verify domain helper"
```

---

## Task 4: Migration 005 — sessions table + Kysely type

**Files:**
- Create: `backend/src/db/migrations/005_sessions.ts`
- Modify: `backend/src/db/types.ts` (add `SessionsTable` + `sessions` to `Database`)

**Interfaces:**
- Produces: `sessions` table; `SessionsTable` interface; `Database.sessions`.

- [ ] **Step 1: Write the migration**

Create `backend/src/db/migrations/005_sessions.ts`:
```typescript
import { Kysely, sql } from 'kysely';

/**
 * 005_sessions — server-side owner sessions (instantly revocable).
 *
 * An owner logs in with email+password and receives a session token. We store
 * the sha256 of the full plaintext token (incl. its `ses_` prefix); plaintext is
 * returned once. A session is valid when revoked_at IS NULL AND expires_at > now().
 * Logout / revoke sets revoked_at. Agent keys are NOT sessions — they keep their
 * own api_key path (agent_keys).
 *
 * Idempotent (IF NOT EXISTS) — same contract as 001/002/003.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS sessions`.execute(db);
}
```

- [ ] **Step 2: Add the Kysely type**

In `backend/src/db/types.ts`, add this interface near the other `*Table` interfaces:
```typescript
export interface SessionsTable {
  id: string;
  account_id: string;
  token_hash: string;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
}
```
Then add to the `Database` interface (alongside `agent_keys: AgentKeysTable;`):
```typescript
  sessions: SessionsTable;
```

- [ ] **Step 3: Build to verify types compile**

Run: `cd backend && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/005_sessions.ts backend/src/db/types.ts
git commit -m "feat(db): migration 005 — server-side sessions table"
```

---

## Task 5: sessionService — create / resolve / revoke

**Files:**
- Create: `backend/src/services/sessionService.ts`
- Test: covered by Task 9 integration (`ownerAuth.test.cjs`)

**Interfaces:**
- Consumes: `db` pool (`backend/src/db/pool`), `SessionsTable` (Task 4).
- Produces:
  - `createSession(accountId: string, ttlDays?: number): Promise<{ token: string }>`
  - `resolveSessionAccountId(token: string): Promise<string | null>`
  - `revokeSession(token: string): Promise<void>`

- [ ] **Step 1: Write the service**

Create `backend/src/services/sessionService.ts`:
```typescript
import { randomUUID, randomBytes, createHash } from 'crypto';
import { sql } from 'kysely';
import db from '../db/pool';

// Owner session tokens. Plaintext = `ses_` + 24 random bytes hex (mirrors the
// agent-key `atm_` scheme). We persist only sha256(full plaintext); the plaintext
// is returned once. A session is valid while revoked_at IS NULL AND not expired.
const DEFAULT_TTL_DAYS = 30;

function newToken(): string {
  return 'ses_' + randomBytes(24).toString('hex');
}
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(accountId: string, ttlDays = DEFAULT_TTL_DAYS): Promise<{ token: string }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await db
    .insertInto('sessions')
    .values({
      id: randomUUID(),
      account_id: accountId,
      token_hash: hashToken(token),
      expires_at: expiresAt,
    })
    .execute();
  return { token };
}

/** Resolve a session token to its account id, or null if invalid/expired/revoked. */
export async function resolveSessionAccountId(token: string): Promise<string | null> {
  const row = await db
    .selectFrom('sessions')
    .select('account_id')
    .where('token_hash', '=', hashToken(token))
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', sql<Date>`now()`)
    .executeTakeFirst();
  return row?.account_id ?? null;
}

/** Instantly revoke a session (logout). Idempotent. */
export async function revokeSession(token: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date() })
    .where('token_hash', '=', hashToken(token))
    .where('revoked_at', 'is', null)
    .execute();
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd backend && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/sessionService.ts
git commit -m "feat(auth): sessionService — create/resolve/revoke owner sessions"
```

---

## Task 6: accountService.createAccount — accept optional password

**Files:**
- Modify: `backend/src/services/accountService.ts` (the `createAccount` function and its params type)
- Test: covered by Task 9 integration

**Interfaces:**
- Consumes: `hashPassword` (Task 3).
- Produces: `createAccount` params gains optional `password?: string`. When present, `password_hash` is stored. Return shape (incl. `api_key`) is otherwise UNCHANGED — agent-key issuance and seed scripts keep working.

- [ ] **Step 1: Read the current createAccount signature**

Run: `cd backend && sed -n '36,92p' src/services/accountService.ts`
Expected: see the `createAccount` params object and insert values. Note the exact param field names before editing.

- [ ] **Step 2: Add password to params + store the hash**

In `backend/src/services/accountService.ts`:
- Add `import { hashPassword } from '../domain/password';` near the other imports.
- In the `createAccount` params type, add `password?: string;`.
- Before the insert, compute: `const password_hash = params.password ? await hashPassword(params.password) : null;`
- Add `password_hash` to the `.values({ ... })` insert object.

The api_key generation and return value stay as-is (agent keys and seed scripts still rely on them).

- [ ] **Step 3: Build**

Run: `cd backend && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/accountService.ts
git commit -m "feat(auth): createAccount stores optional bcrypt password_hash"
```

---

## Task 7: Fork resolvePrincipal by token prefix

**Files:**
- Modify: `backend/src/middleware/auth.ts:22-31` (`resolvePrincipal`)
- Modify: `backend/test/integration/agentKey.test.cjs:44-55` (update owner-via-api_key assertion)

**Interfaces:**
- Consumes: `resolveSessionAccountId` (Task 5), `getAccountById` (existing), `getAgentKeyByApiKey` (existing).
- Produces: `resolvePrincipal(token)` now resolves `ses_` → owner via session, `atm_` (or anything else) → agent via api_key. `Principal` union UNCHANGED.

- [ ] **Step 1: Update resolvePrincipal**

In `backend/src/middleware/auth.ts`, replace the body of `resolvePrincipal` with prefix-forked logic:
```typescript
import { getAccountById, Account } from '../services/accountService';
import { getAgentKeyByApiKey, AgentKeyRow } from '../services/agentKeyService';
import { resolveSessionAccountId } from '../services/sessionService';

// ... Principal type and FastifyRequest augmentation stay unchanged ...

export async function resolvePrincipal(token: string): Promise<Principal | null> {
  // Owner: session token (ses_) → sessions table → owner account.
  if (token.startsWith('ses_')) {
    const accountId = await resolveSessionAccountId(token);
    if (!accountId) return null;
    const account = await getAccountById(accountId);
    return account ? { kind: 'owner', account } : null;
  }
  // Agent: api_key (atm_) → agent_keys → agent principal carrying its owner.
  const agentKey = await getAgentKeyByApiKey(token);
  if (agentKey) {
    const ownerAccount = await getAccountById(agentKey.owner_account_id);
    if (ownerAccount) return { kind: 'agent', agentKey, ownerAccount };
  }
  return null;
}
```
Note: `getAccountByApiKey` is no longer used here. Leave the function in `accountService` (seed/back-compat) but remove its import from `auth.ts` if now unused (the build will flag an unused import only if `noUnusedLocals` is on; remove it to be safe).

- [ ] **Step 2: Update the agentKey integration test**

In `backend/test/integration/agentKey.test.cjs`, the test `resolvePrincipal: owner key -> owner; ...` currently asserts an owner authenticates via `owner.api_key`. Owners no longer auth via api_key. Replace that portion to assert owner resolution via a session token:
```javascript
test('resolvePrincipal: session -> owner; agent key -> agent w/ owner; unknown -> null', async () => {
  const ses = require('../../dist/services/sessionService.js');
  const owner = await acct.createAccount({ type: 'human', name: 'owner-c', email: 'c@ex.com', password: 'password-12345' });
  const { token } = await ses.createSession(owner.id);
  const ownerP = await auth.resolvePrincipal(token);
  assert.equal(ownerP.kind, 'owner');
  assert.equal(ownerP.account.id, owner.id);

  const issued = await ak.issueAgentKey({ ownerAccountId: owner.id, name: 'k3', computeSource: 'local_model' });
  const agentP = await auth.resolvePrincipal(issued.api_key);
  assert.equal(agentP.kind, 'agent');
  assert.equal(agentP.ownerAccount.id, owner.id);

  assert.equal(await auth.resolvePrincipal('atm_nonexistent'), null);
  assert.equal(await auth.resolvePrincipal('ses_nonexistent'), null);
});
```
Also add `sessions` to the `beforeEach` TRUNCATE list:
```javascript
await sql`TRUNCATE TABLE sessions, credit_ledger, risk_flags, agent_keys, accounts RESTART IDENTITY CASCADE`.execute(db());
```

- [ ] **Step 3: Build + run the integration test (needs DATABASE_URL)**

Run: `cd backend && npm run test:integration`
Expected: `agentKey.test.cjs` passes with the new session-based owner assertion. (If no DB is available, at minimum `npm run build` must pass; note the DB gap.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/auth.ts backend/test/integration/agentKey.test.cjs
git commit -m "feat(auth): fork resolvePrincipal — owner via session, agent via api_key"
```

---

## Task 8: register / login / logout routes

**Files:**
- Modify: `backend/src/routes/accounts.ts` (change register, add login + logout)
- Test: covered by Task 9 integration

**Interfaces:**
- Consumes: `createAccount` (Task 6, now with password), `verifyPassword` (Task 3), `createSession`/`revokeSession` (Task 5), `getAccountByEmail` (add if missing — see Step 1).
- Produces: `POST /accounts/register` (email+password → `{ token, account }`, no api_key), `POST /accounts/login`, `POST /accounts/logout`.

- [ ] **Step 1: Add getAccountByEmail to accountService if absent**

Run: `cd backend && grep -n "getAccountByEmail" src/services/accountService.ts`
If absent, add:
```typescript
export async function getAccountByEmail(email: string): Promise<Account | null> {
  const row = await db.selectFrom('accounts').selectAll().where('email', '=', email).executeTakeFirst();
  return (row as unknown as Account) ?? null;
}
```

- [ ] **Step 2: Change register to require email+password and return a session**

In `backend/src/routes/accounts.ts`, update the register Zod schema and handler. The owner register path now requires `name`, `email`, `password` (min 8); it must NOT return `api_key`. After `createAccount({ type:'human', name, email, password })`, call `createSession(account.id)` and return `{ token, account: {…public fields…} }`. Keep the existing per-IP `registerLimiter` and compliance/risk gates intact.

- [ ] **Step 3: Add login + logout**

Add to `accountRoutes`:
```typescript
const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

app.post('/accounts/login', opts.registerLimiter ? { preHandler: opts.registerLimiter.hook } : {}, async (req, reply) => {
  const body = LoginSchema.safeParse(req.body);
  if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
  const account = await getAccountByEmail(body.data.email);
  // Uniform 401 — never reveal whether the email exists (anti-enumeration).
  if (!account || !account.password_hash || !(await verifyPassword(body.data.password, account.password_hash))) {
    return reply.status(401).send({ error: 'Invalid email or password' });
  }
  const { token } = await createSession(account.id);
  return { token, account: publicAccount(account) };
});

app.post('/accounts/logout', { preHandler: authMiddleware }, async (req, reply) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) await revokeSession(auth.slice(7));
  return { ok: true };
});
```
Add imports: `verifyPassword` from `../domain/password`; `createSession, revokeSession` from `../services/sessionService`; `getAccountByEmail` from `../services/accountService`. Reuse the existing public-account mapping (extract a `publicAccount(account)` helper if the register handler already inlines those fields).

- [ ] **Step 4: Build**

Run: `cd backend && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/accounts.ts backend/src/services/accountService.ts
git commit -m "feat(auth): register(email+password)→session, add login/logout routes"
```

---

## Task 9: Owner auth integration test

**Files:**
- Create: `backend/test/integration/ownerAuth.test.cjs`

**Interfaces:**
- Consumes: compiled `dist/` for accountService, sessionService, routes; `setupSchema` helper.

- [ ] **Step 1: Write the integration test**

Create `backend/test/integration/ownerAuth.test.cjs`:
```javascript
// Owner email+password auth: register→session, login success/fail, logout revoke,
// session expiry, credential separation. Requires DATABASE_URL. Run via:
//   npm run test:integration
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { setupSchema } = require('../helpers/db.cjs');

let acct, ses, auth, ctx;
const db = () => require('../../dist/db/pool.js').default;

before(async () => {
  ctx = await setupSchema();
  acct = require('../../dist/services/accountService.js');
  ses = require('../../dist/services/sessionService.js');
  auth = require('../../dist/middleware/auth.js');
});
after(async () => { await ctx.teardown(); });
beforeEach(async () => {
  const { sql } = require('kysely');
  await sql`TRUNCATE TABLE sessions, credit_ledger, risk_flags, agent_keys, accounts RESTART IDENTITY CASCADE`.execute(db());
});

test('createAccount with password stores a verifiable hash, not plaintext', async () => {
  const a = await acct.createAccount({ type: 'human', name: 'o1', email: 'o1@ex.com', password: 'password-12345' });
  const row = await db().selectFrom('accounts').select('password_hash').where('id', '=', a.id).executeTakeFirst();
  assert.ok(row.password_hash, 'hash stored');
  assert.notEqual(row.password_hash, 'password-12345');
  assert.match(row.password_hash, /^\$2[aby]\$/);
});

test('session resolves to owner; revoke makes it 401-equivalent (null)', async () => {
  const a = await acct.createAccount({ type: 'human', name: 'o2', email: 'o2@ex.com', password: 'password-12345' });
  const { token } = await ses.createSession(a.id);
  const p = await auth.resolvePrincipal(token);
  assert.equal(p.kind, 'owner');
  assert.equal(p.account.id, a.id);
  await ses.revokeSession(token);
  assert.equal(await auth.resolvePrincipal(token), null, 'revoked session no longer resolves');
});

test('expired session does not resolve', async () => {
  const a = await acct.createAccount({ type: 'human', name: 'o3', email: 'o3@ex.com', password: 'password-12345' });
  const { token } = await ses.createSession(a.id, -1); // already expired
  assert.equal(await auth.resolvePrincipal(token), null);
});
```

- [ ] **Step 2: Build + run integration tests (needs DATABASE_URL)**

Run: `cd backend && npm run test:integration`
Expected: `ownerAuth.test.cjs` passes (3 tests) and existing suites still pass. If no DB is available in this environment, run `npm run build` and note the DB gap explicitly; do not claim the integration tests passed.

- [ ] **Step 3: Commit**

```bash
git add backend/test/integration/ownerAuth.test.cjs
git commit -m "test(auth): owner register/session/revoke/expiry integration"
```

---

## Task 10: Frontend auth store + global 401

**Files:**
- Modify: `web/src/lib/auth.tsx`
- Modify: `web/src/lib/api.ts`

**Interfaces:**
- Produces: `useAuth()` returns `{ token, login, logout }` (replaces `{ apiKey, setApiKey }`). Storage key `atm.session`.
- Consumes (api.ts): on 401, clear `atm.session` and redirect to `/signin`.

- [ ] **Step 1: Rewrite auth.tsx to store a session token**

Replace `web/src/lib/auth.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const TOKEN_STORAGE = 'atm.session';

interface AuthCtx {
  token: string | null;
  login: (t: string) => void;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({ token: null, login: () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE));
  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_STORAGE, token);
    else localStorage.removeItem(TOKEN_STORAGE);
  }, [token]);

  function login(t: string) { setToken(t); }
  function logout() {
    // Best-effort server revoke; clear locally regardless.
    const t = localStorage.getItem(TOKEN_STORAGE);
    if (t) fetch('/api/v1/accounts/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => {});
    setToken(null);
  }
  return <Ctx.Provider value={{ token, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
```

- [ ] **Step 2: Global 401 handling in api.ts**

In `web/src/lib/api.ts`, inside `request`, after `if (!res.ok)` and before throwing, add:
```typescript
    if (res.status === 401) {
      localStorage.removeItem('atm.session');
      if (location.pathname !== '/app/signin') location.assign('/app/signin');
    }
```
(Keep the existing `throw new ApiError(...)`.)

- [ ] **Step 3: Find every consumer of the old auth shape**

Run: `cd web && grep -rn "useAuth()\|apiKey\|setApiKey" src/`
Expected: a list of routes/components (Browse, Publish, Work, Wallet, Account, AgentKeys, Admin, Published, ConsoleShell, Sidebar). Each `const { apiKey } = useAuth()` becomes `const { token } = useAuth()` and each `key: apiKey` passed to `request(...)` becomes `key: token`. Update them all so the app compiles.

- [ ] **Step 4: Build to surface every missed reference**

Run: `cd web && npm run build`
Expected: TypeScript errors point to any remaining `apiKey`/`setApiKey` usage. Fix until build is clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/auth.tsx web/src/lib/api.ts web/src/routes web/src/components
git commit -m "feat(web): session-token auth store + global 401 redirect"
```

---

## Task 11: SignIn email+password + logout button

**Files:**
- Modify: `web/src/routes/SignIn.tsx`
- Modify: `web/src/components/Sidebar.tsx` (logout button; fall back to `ConsoleShell.tsx` if Sidebar has no footer slot)

**Interfaces:**
- Consumes: `useAuth().login` (Task 10), `POST /accounts/login`, `POST /accounts/register`.

- [ ] **Step 1: Rewrite the SignIn sign-in + register handlers**

In `web/src/routes/SignIn.tsx`:
- Sign-in panel: replace the single API-key input with `email` + `password` inputs. `signIn()` calls `POST /accounts/login` with `{ email, password }`, then `login(resp.token)`, then `nav('/browse')`.
- Register panel: keep Name + Email, ADD `password` (and a confirm field). `register()` calls `POST /accounts/register` with `{ name, email, password }`; on success `login(resp.token)` and `nav('/agent-keys')`.
- DELETE the `created` state and the entire "Account created — save your API key" reveal card (owners have no api_key now).
- Keep the existing "How it works" 3-step strip.

Validation (mirror backend): password min length 8; confirm must match; show a toast on mismatch/short.

- [ ] **Step 2: Add a logout button**

In `web/src/components/Sidebar.tsx`, add a logout control that calls `useAuth().logout()`. (If Sidebar has no suitable footer, add it in `ConsoleShell.tsx` header instead.)

- [ ] **Step 3: Build**

Run: `cd web && npm run build`
Expected: clean build, no `apiKey`/`created` references remain.

- [ ] **Step 4: Commit**

```bash
git add web/src/routes/SignIn.tsx web/src/components/Sidebar.tsx
git commit -m "feat(web): email+password sign-in/register, remove api_key reveal, add logout"
```

---

## Final Verification

- [ ] **Backend:** `cd backend && npm run build && npm run test:unit` (and `npm run test:integration` if `DATABASE_URL` is set).
- [ ] **Web:** `cd web && npm run build && npm test`.
- [ ] **MCP unchanged:** `cd mcp-server && npm run build` — agent-key path untouched; confirm no edits leaked into mcp-server.
- [ ] **Manual smoke (if running locally):** register owner → land on /agent-keys; logout → redirected to signin; login → /browse; issue an agent key and confirm MCP `who_am_i` with that key still works.

## Self-Review Record

- **Spec coverage:** §3 data model → Tasks 2,4. §4 middleware/routes → Tasks 5,6,7,8. §5 frontend → Tasks 10,11. §6 tests → Tasks 3,7,9. §8 YAGNI (no reset/OAuth/email-verify/owner-token) → respected (none added).
- **Placeholder scan:** Tasks 6 & 8 intentionally describe edits to large existing files (createAccount, accounts.ts) as precise instructions with the key code shown, plus a `sed`/`grep` read step first; no "TODO/handle edge cases" placeholders.
- **Type consistency:** `createSession(accountId, ttlDays?)`, `resolveSessionAccountId(token)`, `revokeSession(token)`, `hashPassword`/`verifyPassword`, `getAccountByEmail` used consistently across Tasks 5–9. `Principal` union unchanged. Storage key `atm.session` consistent across Tasks 10–11.
