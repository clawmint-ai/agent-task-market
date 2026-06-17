// Kysely table interfaces for the Agent Task Market schema (see schema.pg.sql).
// These describe DB row shapes; JSONB columns are typed as their parsed shape.

import type { ColumnType, Generated } from 'kysely';

type Json = Record<string, unknown>;
type JsonArray = unknown[];

// Timestamps are written by the DB (now()) and read as Date.
type Timestamp = ColumnType<Date, string | Date | undefined, string | Date>;

// compute_source enum reused by the accounts table and service layer.
export type ComputeSource =
  | 'unspecified'
  | 'local_model'
  | 'payg_api_key'
  | 'platform_credit'
  | 'token_plan_whitelist';

export interface AccountsTable {
  id: string;
  type: 'human' | 'agent';
  name: string;
  email: string | null;
  api_key_hash: string;
  compute_source: ComputeSource;
  earned_balance: Generated<number>;
  gift_balance: Generated<number>;
  frozen_earned_balance: Generated<number>;
  reputation_score: Generated<number>;
  total_tasks_published: Generated<number>;
  total_tasks_completed: Generated<number>;
  is_active: Generated<boolean>;
  metadata: ColumnType<Json, string | Json | undefined, string | Json>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface TasksTable {
  id: string;
  publisher_id: string;
  title: string;
  description: string;
  type: Generated<string>;
  reward_credits: number;
  escrow_gift: Generated<number>;
  escrow_earned: Generated<number>;
  status: Generated<'open' | 'claimed' | 'submitted' | 'completed' | 'failed' | 'cancelled'>;
  requirements: ColumnType<Json, string | Json | undefined, string | Json>;
  input_data: ColumnType<Json, string | Json | undefined, string | Json>;
  deadline: Timestamp | null;
  max_executors: Generated<number>;
  tags: ColumnType<JsonArray, string | JsonArray | undefined, string | JsonArray>;
  verification: ColumnType<Json, string | Json | undefined, string | Json>;
  source: ColumnType<Json | null, string | Json | null | undefined, string | Json | null>;
  min_reputation: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  claimed_at: Timestamp | null;
  completed_at: Timestamp | null;
}

export interface TaskExecutionsTable {
  id: string;
  task_id: string;
  executor_id: string;
  status: Generated<'in_progress' | 'submitted' | 'accepted' | 'rejected'>;
  result: string | null;
  result_metadata: ColumnType<Json, string | Json | undefined, string | Json>;
  feedback: string | null;
  score: number | null;
  verified_by: string | null;
  verification_detail: ColumnType<Json, string | Json | undefined, string | Json>;
  submitted_at: Timestamp | null;
  verified_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface CreditLedgerTable {
  id: string;
  account_id: string;
  delta: number;
  balance_after: number;
  credit_class: Generated<'earned' | 'gift'>;
  reason: string;
  ref_id: string | null;
  description: string | null;
  created_at: Generated<Timestamp>;
}

export interface ReputationEventsTable {
  id: string;
  account_id: string;
  delta: number;
  score_after: number;
  reason: string;
  ref_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface Database {
  accounts: AccountsTable;
  tasks: TasksTable;
  task_executions: TaskExecutionsTable;
  credit_ledger: CreditLedgerTable;
  reputation_events: ReputationEventsTable;
}
