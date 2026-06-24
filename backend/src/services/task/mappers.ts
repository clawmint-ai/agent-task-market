import type { VerificationConfig } from '../verificationService';
import type { Principal } from '../../middleware/auth';

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

export type VerificationVisibility = 'pre_claim' | 'after_claim' | 'publisher';

export interface VerificationPackage {
  task_id: string;
  mode: VerificationConfig['mode'];
  summary: string;
  expected_artifact: string | null;
  fallback_policy: string;
  timeout_ms: number | null;
  language?: string;
  rules?: Array<Record<string, unknown>>;
  tests?: string | null;
  rubric?: string | null;
  pass_threshold?: number | null;
  redacted_fields: string[];
}

export interface VerificationSummary {
  mode: VerificationConfig['mode'];
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

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function expectedArtifact(task: Task): string | null {
  return (
    readString(task.requirements?.expected_artifact) ||
    readString((task.verification as unknown as Record<string, unknown>)?.expected_artifact)
  );
}

function fallbackPolicy(mode: VerificationConfig['mode']): string {
  return mode === 'manual' ? 'manual_review' : 'manual_review_on_fallback';
}

function packageSummary(task: Task): string {
  const verification = task.verification as unknown as Record<string, unknown>;
  const explicit = readString(verification.summary);
  if (explicit) return explicit;
  const artifact = expectedArtifact(task);
  const mode = task.verification?.mode || 'manual';
  if (artifact) return `${mode} verification for ${artifact} deliverable`;
  return `${mode} verification`;
}

function redactRule(rule: Record<string, unknown>, visibility: VerificationVisibility): Record<string, unknown> {
  if (visibility !== 'pre_claim') return rule;
  if (rule.hidden === true) return { type: rule.type, hidden: true };
  if (rule.type === 'regex' || rule.type === 'json_path_equals') {
    return { type: rule.type, path: rule.path, value_redacted: true };
  }
  return rule;
}

export function normalizeVerificationPackage(task: Task, visibility: VerificationVisibility): VerificationPackage {
  const verification = (task.verification || { mode: 'manual' }) as VerificationConfig & Record<string, unknown>;
  const mode = verification.mode || 'manual';
  const redactedFields: string[] = [];
  const pkg: VerificationPackage = {
    task_id: task.id,
    mode,
    summary: packageSummary(task),
    expected_artifact: expectedArtifact(task),
    fallback_policy: readString(verification.fallback_policy) || fallbackPolicy(mode),
    timeout_ms: typeof verification.timeout_ms === 'number' ? verification.timeout_ms : null,
    redacted_fields: redactedFields,
  };

  if (mode === 'auto_rules' && Array.isArray(verification.rules)) {
    pkg.rules = verification.rules.map((rule) => redactRule(rule as unknown as Record<string, unknown>, visibility));
    if (visibility === 'pre_claim') {
      const redacted = pkg.rules.some((rule) => rule.hidden === true || rule.value_redacted === true);
      if (redacted) redactedFields.push('rules.value');
    }
  }

  if (mode === 'auto_tests') {
    pkg.language = readString(verification.language) || undefined;
    if (visibility === 'pre_claim' && verification.hidden_tests === true) {
      pkg.tests = null;
      redactedFields.push('tests');
    } else {
      pkg.tests = readString(verification.tests);
    }
  }

  if (mode === 'auto_llm') {
    if (visibility === 'pre_claim' && verification.hidden_rubric === true) {
      pkg.rubric = null;
      redactedFields.push('rubric');
    } else {
      pkg.rubric = readString(verification.rubric);
    }
    pkg.pass_threshold = typeof verification.pass_threshold === 'number' ? verification.pass_threshold : null;
  }

  return pkg;
}

export function summarizeVerificationPackage(task: Task): VerificationSummary {
  const mode = task.verification?.mode || 'manual';
  return {
    mode,
    summary: packageSummary(task),
    expected_artifact: expectedArtifact(task),
    fallback_policy: fallbackPolicy(mode),
  };
}

export function deriveClaimability(task: Task, principal: Principal): Claimability {
  const reasons: string[] = [];
  const missingRequirements: string[] = [];
  if (principal.kind === 'owner') {
    reasons.push('owner_credentials_cannot_claim_work');
    return { can_claim: false, principal_kind: 'owner', reasons, missing_requirements: missingRequirements };
  }

  if (task.status !== 'open') reasons.push(`task_status_${task.status}`);
  if (task.publisher_id === principal.ownerAccount.id) reasons.push('cannot_claim_own_work_package');
  if (!principal.agentKey.is_active) reasons.push('agent_key_revoked');
  if (principal.agentKey.compute_source === 'unspecified') missingRequirements.push('compute_source');
  if ((principal.agentKey.reputation_score ?? 0) < task.min_reputation) missingRequirements.push('min_reputation');

  return {
    can_claim: reasons.length === 0 && missingRequirements.length === 0,
    principal_kind: 'agent',
    reasons,
    missing_requirements: missingRequirements,
  };
}
