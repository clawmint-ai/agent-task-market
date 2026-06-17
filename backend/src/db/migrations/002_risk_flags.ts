import { Kysely, sql } from 'kysely';

/**
 * 002_risk_flags — Sybil / self-dealing audit machinery (CLAWMIN-23).
 *
 * Re-homes the DDL that previously lived in the retired `schema.pg.sql`:
 *   - `risk_flags`: one row per flagged settlement. status lifecycle:
 *       'open'     — reward was paid then frozen (frozen_earned_balance), awaiting review
 *       'released' — admin cleared it: frozen credits moved back to earned_balance (spendable)
 *       'frozen'   — admin confirmed the flag: credits stay frozen (out of circulation)
 *     amount/account_id let the admin release path reverse the exact freeze. The
 *     freeze itself writes a delta=0 ledger row (class unchanged), so conservation
 *     is unaffected.
 *   - `accounts.signup_ip`: client IP captured at registration, used by the risk
 *     engine for same-origin self-dealing / Sybil-cluster detection. Nullable:
 *     legacy rows and trusted/seed accounts created server-side have no IP.
 *
 * Every statement is IDEMPOTENT (IF NOT EXISTS) — same contract as 001: safe on a
 * DB already provisioned by the old run-DDL-on-boot path, and builds from zero on
 * an empty one.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS signup_ip TEXT`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS risk_flags (
      id UUID PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES accounts(id),
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'released', 'frozen')),
      ref_id UUID,
      amount INTEGER NOT NULL DEFAULT 0,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ,
      resolved_by TEXT
    );
  `.execute(db);

  // One statement per execute(): Kysely's PG driver uses the extended protocol,
  // which rejects multiple commands in a single query string (see 001).
  await sql`CREATE INDEX IF NOT EXISTS idx_risk_flags_status ON risk_flags(status)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_risk_flags_account ON risk_flags(account_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_accounts_signup_ip ON accounts(signup_ip)`.execute(db);
}

/**
 * Reverse 002 in FK-safe order. `idx_accounts_signup_ip` falls with the column;
 * `risk_flags` indexes fall with the table. Exists so migrate:down and the CI
 * round-trip can prove reversibility; destructive, never run automatically.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS risk_flags`.execute(db);
  await sql`ALTER TABLE accounts DROP COLUMN IF EXISTS signup_ip`.execute(db);
}
