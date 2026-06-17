import type { VerificationConfig } from '../verificationService';

export interface Task {
  id: string;
  publisher_id: string;
  title: string;
  description: string;
  type: string;
  reward_credits: number;
  status: 'open' | 'claimed' | 'submitted' | 'completed' | 'failed' | 'cancelled';
  requirements: Record<string, unknown>;
  input_data: Record<string, unknown>;
  deadline?: string | Date | null;
  max_executors: number;
  tags: string[];
  verification: VerificationConfig;
  min_reputation: number;
  created_at: string | Date;
  updated_at: string | Date;
  claimed_at?: string | Date | null;
  completed_at?: string | Date | null;
  publisher_name?: string;
}

export interface TaskExecution {
  id: string;
  task_id: string;
  executor_id: string;
  status: 'in_progress' | 'submitted' | 'accepted' | 'rejected';
  result?: string | null;
  result_metadata: Record<string, unknown>;
  feedback?: string | null;
  score?: number | null;
  verified_by?: string | null;
  verification_detail?: Record<string, unknown>;
  submitted_at?: string | Date | null;
  verified_at?: string | Date | null;
  created_at: string | Date;
  // Present on publisher-facing submission listings (getTaskSubmissions): who
  // submitted, and the ranking signals used to surface Tier 1 executors first.
  executor_name?: string;
  executor_compute_tier?: number;
  executor_reputation_score?: number;
}

// JSONB columns come back parsed from pg, but tests/SQLite-era rows may carry
// strings — tolerate both.
const asObj = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>;
const asArr = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as string[];

export function parseTask(row: any): Task {
  if (!row) return row;
  return {
    ...row,
    requirements: asObj(row.requirements ?? {}),
    input_data: asObj(row.input_data ?? {}),
    tags: asArr(row.tags ?? []),
    verification: asObj(row.verification ?? { mode: 'manual' }) as unknown as VerificationConfig,
  };
}

export function parseExecution(row: any): TaskExecution {
  if (!row) return row;
  return {
    ...row,
    result_metadata: asObj(row.result_metadata ?? {}),
    verification_detail: asObj(row.verification_detail ?? {}),
  };
}
