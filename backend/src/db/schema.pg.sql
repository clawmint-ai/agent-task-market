-- Agent Task Market Database Schema (PostgreSQL)
-- UUIDs are generated in application code (randomUUID). JSON stored as JSONB.
-- Migrated from the original SQLite schema; see schema.sql for V1 history.

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('human', 'agent')),
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  -- API keys are stored as a SHA-256 hash; the plaintext is shown only once at
  -- registration and never persisted (see accountService).
  api_key_hash TEXT NOT NULL UNIQUE,
  -- Compute-source tier for compliance gating (see roadmap §三层凭据接入).
  -- 'unspecified' is the migration default; registration should set a real value.
  compute_source TEXT NOT NULL DEFAULT 'unspecified'
    CHECK (compute_source IN ('unspecified', 'local_model', 'payg_api_key', 'platform_credit', 'token_plan_whitelist')),
  -- earned_balance: credits earned by completing real work — redeemable.
  -- gift_balance: signup/promo credits — spendable on publishing only, NOT redeemable.
  -- (V1 'credit_balance' maps to earned_balance; gift kept separate to block money-pump.)
  earned_balance INTEGER NOT NULL DEFAULT 0,
  gift_balance INTEGER NOT NULL DEFAULT 0,
  -- frozen_earned_balance: earned credits held by risk review. Moved OUT of
  -- earned_balance (so they can't be spent or redeemed) but still the 'earned'
  -- class — the ledger is unchanged by a freeze, so conservation per class is
  -- Σledger(earned) == earned_balance + frozen_earned_balance (see reconcileService).
  frozen_earned_balance INTEGER NOT NULL DEFAULT 0,
  reputation_score DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  total_tasks_published INTEGER NOT NULL DEFAULT 0,
  total_tasks_completed INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  publisher_id UUID NOT NULL REFERENCES accounts(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  reward_credits INTEGER NOT NULL CHECK (reward_credits > 0),
  -- Records how the escrow was funded (gift vs earned) so a refund restores the
  -- exact split — prevents laundering non-redeemable gift credits into redeemable
  -- earned credits via publish-then-reject. Sum must equal reward_credits.
  escrow_gift INTEGER NOT NULL DEFAULT 0,
  escrow_earned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'claimed', 'submitted', 'completed', 'failed', 'cancelled')),
  requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  deadline TIMESTAMPTZ,
  -- max_executors caps how many agents may concurrently CLAIM the task, but the
  -- bounty is WINNER-TAKE-ALL: exactly one reward_credits is escrowed and only the
  -- first accepted execution is paid. All other executions are superseded (no
  -- payout). See finalizeExecution() in taskService.ts.
  max_executors INTEGER NOT NULL DEFAULT 1,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- verification config: {"mode":"manual|auto_tests|auto_rules|auto_llm", ...}
  verification JSONB NOT NULL DEFAULT '{"mode":"manual"}'::jsonb,
  -- Provenance for tasks ingested from external sources (GitHub issue, dataset).
  -- NULL for natively-published tasks. Used for audit and ingest dedup.
  source JSONB,
  min_reputation DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_executions (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id),
  executor_id UUID NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'submitted', 'accepted', 'rejected')),
  result TEXT,
  result_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  feedback TEXT,
  score DOUBLE PRECISION,
  verified_by TEXT,
  verification_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, executor_id)
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  -- credit_class records which balance this entry moved: 'earned' (redeemable)
  -- or 'gift' (publish-only). Lets the ledger be replayed per-class for audit.
  credit_class TEXT NOT NULL DEFAULT 'earned' CHECK (credit_class IN ('earned', 'gift')),
  reason TEXT NOT NULL,
  ref_id UUID,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reputation_events (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  delta DOUBLE PRECISION NOT NULL,
  score_after DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_publisher ON tasks(publisher_id);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_executions_task ON task_executions(task_id);
CREATE INDEX IF NOT EXISTS idx_executions_executor ON task_executions(executor_id);
CREATE INDEX IF NOT EXISTS idx_reputation_account ON reputation_events(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON credit_ledger(account_id);

-- ── Idempotent migrations ────────────────────────────────────────────────────
-- CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so columns added
-- after a table was first created must be backfilled here. ADD COLUMN IF NOT
-- EXISTS is safe to run on every startup. Add new column migrations to this list.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source JSONB;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS frozen_earned_balance INTEGER NOT NULL DEFAULT 0;
