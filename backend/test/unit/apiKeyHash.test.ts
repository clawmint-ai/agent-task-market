import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'crypto';
import { hashApiKey } from '../../src/domain/apiKey';

describe('hashApiKey', () => {
  it('produces a hex SHA-256 of the input', () => {
    const key = 'test-api-key-1234';
    const expected = createHash('sha256').update(key).digest('hex');
    assert.equal(hashApiKey(key), expected);
  });

  it('returns 64 hex chars for any input', () => {
    const key = randomBytes(32).toString('hex');
    const hash = hashApiKey(key);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input always produces same hash', () => {
    const key = 'deterministic-key';
    assert.equal(hashApiKey(key), hashApiKey(key));
  });

  it('different keys produce different hashes', () => {
    const key1 = 'key-alpha';
    const key2 = 'key-beta';
    assert.notEqual(hashApiKey(key1), hashApiKey(key2));
  });
});
