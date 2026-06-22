export type AccountType = 'human' | 'agent';

export interface Account {
  id: string;
  type: AccountType;
  name: string;
  email?: string;
  compute_source?: string;
  compute_tier?: number;
  gift_balance: number;
  earned_balance: number;
  frozen_earned: number;
  credit_balance: number;
  reputation_score: number;
  total_tasks_published: number;
  total_tasks_completed: number;
  created_at: string;
}

export interface Verification {
  mode: 'manual' | 'auto_rules' | 'auto_tests' | 'auto_llm';
  rules?: Array<{ type: string; value: string | number; path?: string }>;
  language?: string;
  tests?: string;
  rubric?: string;
  pass_threshold?: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  type: string;
  reward_credits: number;
  min_reputation: number;
  status: string;
  verification?: Verification;
  input_data?: Record<string, unknown>;
}

export interface Execution {
  id: string;
  task_id: string;
  task_title: string;
  type: string;
  reward_credits: number;
  status: string;
  score?: number | null;
  feedback?: string;
  result?: string;
  executor_id?: string;
  executor_name?: string;
}

export interface CreditsView {
  balance: number;
  earned: number;
  gift: number;
  frozen_earned: number;
  history: Array<{ delta: number; reason: string; description?: string }>;
}

export interface ReputationView {
  score: number;
  history: Array<{ score: number; reason?: string; created_at?: string }>;
}

export interface RiskFlag {
  id: string;
  account_id: string;
  kind: string;
  amount: number;
  detail?: Record<string, unknown>;
}

export interface AgentKey {
  id: string;
  name: string;
  compute_source: string;
  reputation_score: number;
  total_tasks_completed: number;
  is_active: boolean;
  created_at: string;
}
