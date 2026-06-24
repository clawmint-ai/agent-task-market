import { test } from 'node:test';
import assert from 'node:assert';
import {
  deriveClaimability,
  normalizeVerificationPackage,
  summarizeVerificationPackage,
  type Task,
} from '../../src/services/task/mappers';
import type { Principal } from '../../src/middleware/auth';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    publisher_id: 'owner-1',
    title: 'Verify a JSON artifact',
    description: 'Return a JSON object with the expected field.',
    type: 'data',
    reward_credits: 50,
    status: 'open',
    requirements: { expected_artifact: 'json' },
    input_data: {},
    deadline: null,
    max_executors: 1,
    tags: [],
    verification: {
      mode: 'auto_rules',
      rules: [{ type: 'regex', value: '^ok:', hidden: false }],
    },
    min_reputation: 4,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const ownerPrincipal: Principal = {
  kind: 'owner',
  account: {
    id: 'owner-1',
    type: 'human',
    name: 'Owner',
    email: null,
    compute_source: 'unspecified',
    signup_ip: null,
    earned_balance: 0,
    gift_balance: 100,
    frozen_earned_balance: 0,
    reputation_score: 0,
    total_tasks_published: 0,
    total_tasks_completed: 0,
    is_active: true,
    metadata: {},
    created_at: new Date(),
  },
};

function agentPrincipal(overrides: Partial<Principal & { kind: 'agent' }> = {}): Principal {
  return {
    kind: 'agent',
    ownerAccount: { ...ownerPrincipal.account, id: 'agent-owner-1' },
    agentKey: {
      id: 'agent-key-1',
      owner_account_id: 'agent-owner-1',
      name: 'Agent',
      compute_source: 'local_model',
      reputation_score: 5,
      total_tasks_completed: 0,
      is_active: true,
      created_at: new Date(),
    },
    ...overrides,
  } as Principal;
}

test('deriveClaimability keeps owner console separate from agent execution', () => {
  const result = deriveClaimability(task(), ownerPrincipal);
  assert.equal(result.can_claim, false);
  assert.equal(result.principal_kind, 'owner');
  assert.deepEqual(result.reasons, ['owner_credentials_cannot_claim_work']);
});

test('deriveClaimability is server-derived for agent reputation and compute requirements', () => {
  const result = deriveClaimability(
    task(),
    agentPrincipal({
      agentKey: {
        id: 'agent-key-1',
        owner_account_id: 'agent-owner-1',
        name: 'Agent',
        compute_source: 'unspecified',
        reputation_score: 2,
        total_tasks_completed: 0,
        is_active: true,
        created_at: new Date(),
      },
    })
  );
  assert.equal(result.can_claim, false);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.missing_requirements, ['compute_source', 'min_reputation']);
});

test('normalizeVerificationPackage redacts hidden pre-claim verifier internals', () => {
  const result = normalizeVerificationPackage(task(), 'pre_claim');
  assert.equal(result.mode, 'auto_rules');
  assert.equal(result.expected_artifact, 'json');
  assert.equal(result.rules?.[0].type, 'regex');
  assert.equal(result.rules?.[0].value_redacted, true);
  assert.deepEqual(result.redacted_fields, ['rules.value']);
});

test('summarizeVerificationPackage exposes compact MCP/UI list summary', () => {
  const result = summarizeVerificationPackage(task());
  assert.deepEqual(result, {
    mode: 'auto_rules',
    summary: 'auto_rules verification for json deliverable',
    expected_artifact: 'json',
    fallback_policy: 'manual_review_on_fallback',
  });
});
