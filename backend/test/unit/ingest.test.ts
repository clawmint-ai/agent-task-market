import { test } from 'node:test';
import assert from 'node:assert';
import { parseVerifyContract } from '../../src/ingest/githubIssues';
import type { ExternalTask } from '../../src/ingest/types';

const issue = (body: string, over: Partial<ExternalTask> = {}): ExternalTask => ({
  origin: 'github',
  externalId: 'owner/repo#7',
  url: 'https://github.com/owner/repo/issues/7',
  title: 'Do the thing',
  body,
  labels: ['agent-task'],
  ...over,
});

test('drops an issue with no verify block (open-ended → not ingestable)', () => {
  assert.equal(parseVerifyContract(issue('Please refactor the parser, thanks!')), null);
});

test('drops an issue with a malformed verify block', () => {
  assert.equal(parseVerifyContract(issue('```verify\n{ not json ```')), null);
});

test('maps an auto_rules contract to a data task', () => {
  const body = [
    'Normalize the dates in this file.',
    '```verify',
    '{ "mode": "auto_rules", "rules": [{ "type": "min_length", "value": 10 }], "reward_credits": 35 }',
    '```',
  ].join('\n');
  const t = parseVerifyContract(issue(body));
  assert.ok(t);
  assert.equal(t!.type, 'data');
  assert.equal(t!.verification.mode, 'auto_rules');
  assert.equal(t!.reward_credits, 35);
  assert.ok(t!.title.includes('owner/repo#7'));
  assert.ok(!t!.description.includes('```verify'), 'verify block stripped from description');
  assert.ok(t!.description.includes('Source: https://github.com'), 'source link kept');
});

test('maps an auto_tests contract to a code task with language', () => {
  const body = [
    'Implement add(a,b).',
    '```verify',
    '{ "mode": "auto_tests", "language": "python", "tests": "from solution import add\\ndef test_x():\\n    assert add(1,2)==3" }',
    '```',
  ].join('\n');
  const t = parseVerifyContract(issue(body));
  assert.ok(t);
  assert.equal(t!.type, 'code');
  assert.equal(t!.verification.mode, 'auto_tests');
  assert.equal((t!.verification as any).language, 'python');
});

test('drops auto_rules with empty rules array', () => {
  const body = '```verify\n{ "mode": "auto_rules", "rules": [] }\n```';
  assert.equal(parseVerifyContract(issue(body)), null);
});

test('drops an unknown verification mode', () => {
  const body = '```verify\n{ "mode": "auto_llm", "rubric": "is it good?" }\n```';
  assert.equal(parseVerifyContract(issue(body)), null);
});

test('defaults reward when not specified', () => {
  const body = '```verify\n{ "mode": "auto_rules", "rules": [{ "type": "contains", "value": "x" }] }\n```';
  const t = parseVerifyContract(issue(body));
  assert.equal(t!.reward_credits, 50);
});
