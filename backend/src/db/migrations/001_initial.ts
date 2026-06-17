import { Kysely, sql } from 'kysely';

/**
 * 001_initial — the full baseline schema, migrated verbatim from the original
 * `schema.pg.sql` (the now-retired startup-DDL file).
 *
 * Every statement is IDEMPOTENT (`IF NOT EXISTS` on tables/indexes/columns).
 * This is deliberate: production databases were provisioned by the old
 * run-the-DDL-on-boot path and already hold these tables but have NO
 * `kysely_migration` row for this migration. When the migrator first runs
 * against such a DB it will try to apply 001; the IF NOT EXISTS guards make
 * that a safe no-op, after which the migration is recorded and never re-run.
 * On a truly empty DB it builds the whole schema from zero.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('human', 'agent')),
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      api_key_hash TEXT NOT NULL UNIQUE,
      compute_source TEXT NOT NULL DEFAULT 'unspecified'
        CHECK (compute_source IN ('unspecified', 'local_model', 'payg_api_key', 'platform_credit', 'token_plan_whitelist')),
      earned_balance INTEGER NOT NULL DEFAULT 0,
      gift_balance INTEGER NOT NULL DEFAULT 0,
      frozen_earned_balance INTEGER NOT NULL DEFAULT 0,
      reputation_score DOUBLE PRECISION NOT NULL DEFAULT 5.0,
      total_tasks_published INTEGER NOT NULL DEFAULT 0,
      total_tasks_completed INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY,
      publisher_id UUID NOT NULL REFERENCES accounts(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'general',
      reward_credits INTEGER NOT NULL CHECK (reward_credits > 0),
      escrow_gift INTEGER NOT NULL DEFAULT 0,
      escrow_earned INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'claimed', 'submitted', 'completed', 'failed', 'cancelled')),
      requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
      input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      deadline TIMESTAMPTZ,
      max_executors INTEGER NOT NULL DEFAULT 1,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      verification JSONB NOT NULL DEFAULT '{"mode":"manual"}'::jsonb,
      source JSONB,
      min_reputation DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      claimed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
  `.execute(db);

  await sql`
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
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id UUID PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES accounts(id),
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      credit_class TEXT NOT NULL DEFAULT 'earned' CHECK (credit_class IN ('earned', 'gift')),
      reason TEXT NOT NULL,
      ref_id UUID,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS reputation_events (
      id UUID PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES accounts(id),
      delta DOUBLE PRECISION NOT NULL,
      score_after DOUBLE PRECISION NOT NULL,
      reason TEXT NOT NULL,
      ref_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `.execute(db);

  // One statement per execute(): Kysely's PG driver passes a params array, which
  // puts node-postgres in the extended protocol — that rejects multiple commands
  // in a single query string. (The old raw pool.query used the simple protocol.)
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_publisher ON tasks(publisher_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_executions_task ON task_executions(task_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_executions_executor ON task_executions(executor_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_reputation_account ON reputation_events(account_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_ledger_account ON credit_ledger(account_id)`.execute(db);

  // Column backfills: on a fresh DB these columns already exist (above), but on
  // a DB first provisioned before they were added, `CREATE TABLE IF NOT EXISTS`
  // is a no-op — so re-assert them. ADD COLUMN IF NOT EXISTS is idempotent.
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source JSONB`.execute(db);
  await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS frozen_earned_balance INTEGER NOT NULL DEFAULT 0`.execute(db);
}

/**
 * Drop everything 001 created, in FK-safe order (children before parents).
 * Indexes fall with their tables. `down` exists so `migrate:down` and the CI
 * round-trip can prove the migration is reversible; it is destructive and is
 * never run automatically on boot.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS reputation_events`.execute(db);
  await sql`DROP TABLE IF EXISTS credit_ledger`.execute(db);
  await sql`DROP TABLE IF EXISTS task_executions`.execute(db);
  await sql`DROP TABLE IF EXISTS tasks`.execute(db);
  await sql`DROP TABLE IF EXISTS accounts`.execute(db);
}
