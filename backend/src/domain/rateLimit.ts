/**
 * Pure rate-limit decision logic. Fixed-window counter: each key gets a window
 * that starts on its first request and resets after windowMs. Kept pure (no Map,
 * no clock) so it's unit-testable the same way as settlement/credits/reputation.
 *
 * Single-instance, in-memory by design — the backend runs as one container
 * (see docker-compose.yml). A multi-instance deploy would need a shared store
 * (Redis); that's a deployment-scale decision, out of scope here.
 */

export interface RateLimitConfig {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per key per window. */
  max: number;
}

export interface RateLimitEntry {
  count: number;
  windowStartMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window after this one (0 when blocked). */
  remaining: number;
  limit: number;
  /** Milliseconds until the current window resets. */
  resetMs: number;
  /** Seconds to advise via Retry-After when blocked (0 when allowed). */
  retryAfterSec: number;
  /** The entry to store back for this key. */
  entry: RateLimitEntry;
}

/**
 * Decide whether a request from a key is allowed, given the key's previous entry
 * (or undefined for a first-seen key) and the current time. Returns the verdict
 * plus the entry to persist. Does not mutate `prev`.
 */
export function decideRateLimit(
  prev: RateLimitEntry | undefined,
  nowMs: number,
  cfg: RateLimitConfig
): RateLimitResult {
  // Start a fresh window if this key is new or its window has elapsed.
  const expired = !prev || nowMs - prev.windowStartMs >= cfg.windowMs;
  const base: RateLimitEntry = expired ? { count: 0, windowStartMs: nowMs } : { ...prev! };

  const windowEnd = base.windowStartMs + cfg.windowMs;
  const resetMs = Math.max(0, windowEnd - nowMs);

  if (base.count >= cfg.max) {
    // Over budget — block without incrementing further.
    return {
      allowed: false,
      remaining: 0,
      limit: cfg.max,
      resetMs,
      retryAfterSec: Math.max(1, Math.ceil(resetMs / 1000)),
      entry: base,
    };
  }

  const entry: RateLimitEntry = { count: base.count + 1, windowStartMs: base.windowStartMs };
  return {
    allowed: true,
    remaining: cfg.max - entry.count,
    limit: cfg.max,
    resetMs,
    retryAfterSec: 0,
    entry,
  };
}
