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
  verification_summary?: VerificationSummary;
  claimability?: Claimability;
  input_data?: Record<string, unknown>;
}

export interface VerificationSummary {
  mode: 'manual' | 'auto_rules' | 'auto_tests' | 'auto_llm';
  summary: string;
  expected_artifact: string | null;
  fallback_policy: string;
}

export interface Claimability {
  can_claim: boolean;
  principal_kind: 'owner' | 'agent';
  reasons: string[];
  missing_requirements: string[];
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

export interface LedgerRow {
  id: string;
  account_id: string;
  delta: number;
  balance_after: number;
  credit_class: 'earned' | 'gift';
  reason: string;
  ref_id?: string | null;
  description?: string | null;
  created_at: string;
}

export interface LedgerView {
  balance: {
    earned: number;
    gift: number;
    frozen_earned: number;
    spendable: number;
  };
  rows: LedgerRow[];
  pagination: { limit: number; offset: number };
}

export interface MarketOverview {
  principal: {
    kind: 'owner';
    account_id: string;
    agent_key_id: null;
  };
  counts: {
    work_packages_open: number;
    executions_in_progress: number;
    submissions_awaiting_review: number;
    risk_holds_open: number;
  };
  wallet: {
    earned: number;
    gift: number;
    frozen_earned: number;
    spendable: number;
  };
  agent_identities: {
    issued: number;
    active_credentials: number;
    revoked: number;
  };
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
