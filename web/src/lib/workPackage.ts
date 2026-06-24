import type { Verification } from './types';
import type { Claimability } from './types';

export type ExpectedArtifact = 'plain_text' | 'markdown' | 'json' | 'source_code' | 'url' | 'file_bundle' | 'other' | '';

export interface CreateWorkPackageForm {
  title: string;
  description: string;
  type: string;
  reward: number;
  minReputation: number;
  expectedArtifact: ExpectedArtifact;
  mode: Verification['mode'];
  contains: string;
  language: string;
  tests: string;
  rubric: string;
  threshold: number;
}

export interface VerifyExecutionForm {
  executionId: string;
  accepted: boolean;
  feedback: string;
  score: string;
}

export interface SubmitExecutionForm {
  result: string;
  resultMetadata: string;
}

export function buildCreateWorkPackagePayload(form: CreateWorkPackageForm) {
  const expected = form.expectedArtifact.trim();
  if (form.mode !== 'manual' && !expected) {
    throw new Error('Expected artifact is required for automatic verification');
  }

  const verification: Verification = { mode: form.mode };
  if (form.mode === 'auto_rules') {
    verification.rules = form.contains.trim() ? [{ type: 'contains', value: form.contains.trim() }] : [];
  } else if (form.mode === 'auto_tests') {
    verification.language = form.language;
    verification.tests = form.tests;
  } else if (form.mode === 'auto_llm') {
    verification.rubric = form.rubric;
    verification.pass_threshold = form.threshold;
  }

  return {
    title: form.title.trim(),
    description: form.description.trim(),
    type: form.type,
    reward_credits: Number(form.reward),
    min_reputation: Number(form.minReputation),
    requirements: expected ? { expected_artifact: expected } : {},
    verification,
  };
}

export function buildVerifyExecutionPayload(form: VerifyExecutionForm) {
  const payload: {
    execution_id: string;
    accepted: boolean;
    feedback?: string;
    score?: number;
  } = {
    execution_id: form.executionId,
    accepted: form.accepted,
  };

  const feedback = form.feedback.trim();
  if (feedback) payload.feedback = feedback;

  const scoreText = form.score.trim();
  if (scoreText) {
    const score = Number(scoreText);
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      throw new Error('Score must be between 0 and 10');
    }
    payload.score = score;
  }

  return payload;
}

export function buildSubmitExecutionPayload(form: SubmitExecutionForm) {
  const result = form.result.trim();
  if (!result) throw new Error('Enter your result');

  const payload: {
    result: string;
    result_metadata?: Record<string, unknown>;
  } = { result };

  const metadataText = form.resultMetadata.trim();
  if (metadataText) {
    let metadata: unknown;
    try {
      metadata = JSON.parse(metadataText);
    } catch {
      throw new Error('Result metadata must be valid JSON');
    }
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') {
      throw new Error('Result metadata must be a JSON object');
    }
    payload.result_metadata = metadata as Record<string, unknown>;
  }

  return payload;
}

const reasonLabels: Record<string, string> = {
  owner_credentials_cannot_claim_work: 'Owner credentials cannot claim work',
  cannot_claim_own_work_package: 'Cannot claim your own work package',
  agent_key_revoked: 'Agent key is revoked',
};

const requirementLabels: Record<string, string> = {
  compute_source: 'compute source',
  min_reputation: 'minimum reputation',
};

function joinReadable(items: string[]) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function claimabilityLabel(claimability?: Claimability): string {
  if (!claimability) return 'Claimability unavailable';
  if (claimability.can_claim) return 'Claimable';
  if (claimability.missing_requirements.length) {
    const requirements = claimability.missing_requirements.map((r) => requirementLabels[r] ?? r.replaceAll('_', ' '));
    return `Missing ${joinReadable(requirements)}`;
  }
  const reason = claimability.reasons[0];
  if (!reason) return 'Not claimable';
  if (reason.startsWith('task_status_')) return `Task is ${reason.replace('task_status_', '').replaceAll('_', ' ')}`;
  return reasonLabels[reason] ?? reason.replaceAll('_', ' ');
}
