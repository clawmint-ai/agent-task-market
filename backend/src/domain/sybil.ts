// Pure self-dealing / Sybil heuristics (CLAWMIN-23). Zero I/O: every input is
// passed in, so each decision is deterministic and unit-testable. The LocalRiskEngine
// (risk/local.ts) does the DB lookups and feeds the results here.
//
// SCOPE: this is the OPEN-CORE reference baseline — intentionally simple and
// readable. The production heuristics (collusion graph, fingerprint clustering,
// behavioural models) live in the CLOSED risk-engine behind RISK_ENGINE_URL and are
// NOT here. See architecture-split-design.md. Keeping the baseline open means the
// enforcement machinery it drives (freeze-on-review, audit log) is auditable.

/** A flagged-but-not-blocked decision: the action proceeds, the outcome is reviewed. */
export interface ReviewDecision {
  /** true → route this outcome to review (settlement pays then freezes). */
  review: boolean;
  /** machine-readable flags, e.g. ['self_dealing_suspected']. Empty when review=false. */
  flags: string[];
  /** human-readable explanation when flagged; undefined otherwise. */
  reason?: string;
}

const NO_REVIEW: ReviewDecision = { review: false, flags: [] };

/**
 * Same-origin self-dealing: a publisher paying an executor that registered from the
 * SAME IP is the classic money-pump shape (one operator, two accounts). We do NOT
 * block the settlement (an explicit deny would be brittle against false positives —
 * shared NAT, office networks); instead we flag it so the reward is paid then frozen
 * for review. Returns NO_REVIEW when either IP is unknown (null) or they differ.
 */
export function decideSelfDealing(params: {
  publisherIp: string | null;
  executorIp: string | null;
}): ReviewDecision {
  const { publisherIp, executorIp } = params;
  if (!publisherIp || !executorIp) return NO_REVIEW;
  if (publisherIp !== executorIp) return NO_REVIEW;
  return {
    review: true,
    flags: ['self_dealing_suspected'],
    reason: 'Publisher and executor registered from the same IP',
  };
}

/**
 * New-account publish cap: in an account's first `windowMs`, a single task's reward
 * may not exceed `maxReward`. Caps the blast radius of a freshly-minted account
 * funnelling its whole signup gift into one self-dealt bounty. This IS a hard gate
 * (returns allow=false) because it's a bound on the publisher's OWN escrow, not a
 * payout — failing it just asks them to publish a smaller bounty.
 */
export function decideNewAccountPublishCap(params: {
  accountCreatedAt: Date;
  now: Date;
  rewardCredits: number;
  maxReward: number;
  windowMs: number;
}): { allow: boolean; reason?: string } {
  const { accountCreatedAt, now, rewardCredits, maxReward, windowMs } = params;
  const ageMs = now.getTime() - accountCreatedAt.getTime();
  if (ageMs >= windowMs) return { allow: true };
  if (rewardCredits <= maxReward) return { allow: true };
  return {
    allow: false,
    reason: `New accounts (< ${Math.round(windowMs / 86_400_000)}d old) may publish at most ${maxReward} credits per task; got ${rewardCredits}`,
  };
}

/**
 * Registration throttle: when `priorCountInWindow` (signups already seen from this IP
 * within the throttle window) reaches `threshold`, the new registration is flagged
 * for review rather than blocked — a burst of same-IP signups is the Sybil-cluster
 * shape, but blocking outright would lock out legitimate shared-network users.
 */
export function decideRegistrationThrottle(params: {
  priorCountInWindow: number;
  threshold: number;
}): ReviewDecision {
  if (params.priorCountInWindow >= params.threshold) {
    return {
      review: true,
      flags: ['rapid_signup_cluster'],
      reason: `${params.priorCountInWindow + 1} registrations from this IP within the throttle window`,
    };
  }
  return NO_REVIEW;
}
