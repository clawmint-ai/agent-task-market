import { describe, expect, it } from 'vitest';
import {
  buildCreateWorkPackagePayload,
  buildSubmitExecutionPayload,
  buildVerifyExecutionPayload,
  claimabilityLabel,
} from './workPackage';

describe('buildCreateWorkPackagePayload', () => {
  it('puts expected artifact in requirements and builds auto_rules verification', () => {
    expect(buildCreateWorkPackagePayload({
      title: '  Check artifact  ',
      description: '  Return markdown  ',
      type: 'content',
      reward: 25,
      minReputation: 2,
      expectedArtifact: 'markdown',
      mode: 'auto_rules',
      contains: '# Result',
      language: 'python',
      tests: '',
      rubric: '',
      threshold: 6,
    })).toEqual({
      title: 'Check artifact',
      description: 'Return markdown',
      type: 'content',
      reward_credits: 25,
      min_reputation: 2,
      requirements: { expected_artifact: 'markdown' },
      verification: {
        mode: 'auto_rules',
        rules: [{ type: 'contains', value: '# Result' }],
      },
    });
  });

  it('rejects auto verification without an expected artifact', () => {
    expect(() => buildCreateWorkPackagePayload({
      title: 'Task',
      description: 'Description',
      type: 'general',
      reward: 10,
      minReputation: 0,
      expectedArtifact: '',
      mode: 'auto_tests',
      contains: '',
      language: 'javascript',
      tests: 'assert.ok(true)',
      rubric: '',
      threshold: 6,
    })).toThrow('Expected artifact is required for automatic verification');
  });
});

describe('claimabilityLabel', () => {
  it('explains owner-only claim blocking without duplicating server rules', () => {
    expect(claimabilityLabel({
      can_claim: false,
      principal_kind: 'owner',
      reasons: ['owner_credentials_cannot_claim_work'],
      missing_requirements: [],
    })).toBe('Owner credentials cannot claim work');
  });

  it('lists missing server-derived requirements for agents', () => {
    expect(claimabilityLabel({
      can_claim: false,
      principal_kind: 'agent',
      reasons: [],
      missing_requirements: ['compute_source', 'min_reputation'],
    })).toBe('Missing compute source and minimum reputation');
  });
});

describe('buildVerifyExecutionPayload', () => {
  it('trims feedback and includes a bounded score when provided', () => {
    expect(buildVerifyExecutionPayload({
      executionId: 'exec-1',
      accepted: true,
      feedback: '  Good artifact.  ',
      score: '8.5',
    })).toEqual({
      execution_id: 'exec-1',
      accepted: true,
      feedback: 'Good artifact.',
      score: 8.5,
    });
  });

  it('rejects scores outside the API range', () => {
    expect(() => buildVerifyExecutionPayload({
      executionId: 'exec-1',
      accepted: false,
      feedback: '',
      score: '11',
    })).toThrow('Score must be between 0 and 10');
  });
});

describe('buildSubmitExecutionPayload', () => {
  it('trims the result and parses optional metadata JSON', () => {
    expect(buildSubmitExecutionPayload({
      result: '  done  ',
      resultMetadata: ' { "path": "answer.score", "score": 10 } ',
    })).toEqual({
      result: 'done',
      result_metadata: { path: 'answer.score', score: 10 },
    });
  });

  it('omits metadata when the editor is empty', () => {
    expect(buildSubmitExecutionPayload({
      result: 'done',
      resultMetadata: '   ',
    })).toEqual({ result: 'done' });
  });

  it('rejects empty results and non-object metadata', () => {
    expect(() => buildSubmitExecutionPayload({
      result: ' ',
      resultMetadata: '',
    })).toThrow('Enter your result');

    expect(() => buildSubmitExecutionPayload({
      result: 'done',
      resultMetadata: '[]',
    })).toThrow('Result metadata must be a JSON object');
  });
});
