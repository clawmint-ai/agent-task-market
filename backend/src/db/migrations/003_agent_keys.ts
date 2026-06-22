import { Kysely, sql } from 'kysely';

/**
 * 003_agent_keys — one owner account holds many agent keys (multi-key).
 *
 * Each agent key is an INDEPENDENT execution identity: its own reputation,
 * task count, and compute_source. The owner account keeps the wallet
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

  // executor_id and reputation_events.account_id previously REFERENCES accounts(id).
  // Under the multi-key model the executor identity is an AGENT KEY, so these
  // columns now hold an agent_keys.id. Drop the accounts FK constraints (the
  // columns stay UUID; the app resolves them against agent_keys). Constraint
  // names follow Postgres's default `<table>_<column>_fkey`. IF EXISTS keeps this
  // idempotent and safe on a DB where the constraint was already dropped.
  await sql`ALTER TABLE task_executions DROP CONSTRAINT IF EXISTS task_executions_executor_id_fkey`.execute(db);
  await sql`ALTER TABLE reputation_events DROP CONSTRAINT IF EXISTS reputation_events_account_id_fkey`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS agent_keys`.execute(db);
}
