import { createHash } from 'crypto';

/** Hash an API key for storage/lookup. Plaintext is never persisted. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}
