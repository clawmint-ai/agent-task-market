// Pure reputation domain logic. Zero I/O — no DB, no imports of persistence.
// Reputation is a 0-10 score; new accounts start at 5.0. Exponential moving
// average: recent performance matters more, but one bad task can't tank a long
// good history.

export const REPUTATION_ALPHA = 0.15;
export const REPUTATION_MIN = 0;
export const REPUTATION_MAX = 10;

export function clampReputation(v: number): number {
  return Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, v));
}

/**
 * Compute the next reputation from the current score and a task outcome score.
 * Returns the rounded next score and the delta from current (both 2-decimal),
 * matching the persisted columns. Pure: same inputs → same outputs.
 */
export function nextReputation(current: number, outcomeScore: number): { scoreAfter: number; delta: number } {
  const next = clampReputation(current * (1 - REPUTATION_ALPHA) + outcomeScore * REPUTATION_ALPHA);
  const delta = Number((next - current).toFixed(2));
  const scoreAfter = Number(next.toFixed(2));
  return { scoreAfter, delta };
}
