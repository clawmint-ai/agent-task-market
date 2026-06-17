// Pure compute-source compliance logic. Zero I/O.
//
// TOS compliance is a P0 survival concern (see system-deep-analysis §9):
// Anthropic and OpenAI both forbid using a personal subscription (Claude
// Pro/Max, ChatGPT Plus) OAuth token to power third-party automation. A market
// that admits such credentials inherits "facilitation" liability. We cannot
// technically prove a credential's type, so the compliance basis is: a declared
// compute_source from a compliant tier + an explicit attestation, hard-rejecting
// any value that smells like a subscription-OAuth source. The closed risk-engine
// (onRegister) does the deeper Sybil/fingerprint work; this module is the
// declarative接入层 gate that runs even under the open-source Noop engine.

import type { ComputeSource } from '../db/types';

// The compliant compute sources an agent may declare. 'unspecified' exists as a
// DB default for legacy/seed rows but is NOT acceptable at agent registration.
export const COMPUTE_SOURCES: readonly ComputeSource[] = [
  'local_model',
  'payg_api_key',
  'platform_credit',
  'token_plan_whitelist',
] as const;

// Substrings that mark a declared source as a forbidden subscription-OAuth type.
// Matched case-insensitively against a normalized declaration so common spellings
// ("subscription_oauth", "claude-pro", "ChatGPT Plus", "max_oauth") all trip it.
const FORBIDDEN_PATTERNS = [
  'subscription_oauth',
  'subscription-oauth',
  'oauth',
  'claude_pro',
  'claude-pro',
  'claude_max',
  'claude-max',
  'chatgpt_plus',
  'chatgpt-plus',
  'plus_subscription',
] as const;

// Tier 1 (local_model) is the most clearly-compliant and gets surfaced first in
// agent-facing views. Tiers are advisory ranking, not an access gate — every
// value in COMPUTE_SOURCES is allowed.
export type ComputeTier = 1 | 2 | 3;

export function computeTier(source: ComputeSource): ComputeTier {
  switch (source) {
    case 'local_model':
      return 1;
    case 'payg_api_key':
    case 'token_plan_whitelist':
      return 2;
    default:
      return 3; // platform_credit / unspecified
  }
}

export type RegistrationCheck =
  | { allow: true; source: ComputeSource; tier: ComputeTier }
  | { allow: false; status: 400 | 403; reason: string };

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Decide whether an agent registration may proceed, purely from the declared
 * fields. Humans (publishers) are exempt — they declare no compute source.
 *
 * Status semantics the route maps straight to HTTP:
 *   - 403: declared a forbidden subscription-OAuth source, or token_plan not on
 *     the allow-list — a compliance refusal, with explanation.
 *   - 400: missing source, missing attestation, or an unknown/misspelled source
 *     — a malformed request.
 *
 * @param allowedTokenPlans plans permitted when source is token_plan_whitelist
 *   (from ALLOWED_TOKEN_PLANS). Empty ⇒ no plan is whitelisted yet.
 */
export function evaluateRegistration(params: {
  type: 'human' | 'agent';
  computeSource?: string;
  computeAttestation?: boolean;
  tokenPlan?: string;
  allowedTokenPlans?: readonly string[];
}): RegistrationCheck {
  if (params.type === 'human') {
    return { allow: true, source: 'unspecified', tier: computeTier('unspecified') };
  }

  const raw = params.computeSource;
  if (!raw || !raw.trim()) {
    return {
      allow: false,
      status: 400,
      reason:
        'Agents must declare compute_source (one of: ' +
        COMPUTE_SOURCES.join(', ') +
        '). Subscription OAuth (Claude Pro/Max, ChatGPT Plus) is not permitted.',
    };
  }

  const norm = normalize(raw);

  // Forbidden subscription-OAuth source → 403 with a compliance explanation.
  if (FORBIDDEN_PATTERNS.some((p) => norm.includes(p))) {
    return {
      allow: false,
      status: 403,
      reason:
        'Subscription OAuth credentials (Claude Pro/Max, ChatGPT Plus) are prohibited: ' +
        'their terms forbid third-party automated use. Declare a compliant compute_source ' +
        'instead (' +
        COMPUTE_SOURCES.join(', ') +
        ').',
    };
  }

  // Unknown/misspelled source → 400 malformed.
  if (!COMPUTE_SOURCES.includes(norm as ComputeSource)) {
    return {
      allow: false,
      status: 400,
      reason: `Unknown compute_source "${raw}". Must be one of: ${COMPUTE_SOURCES.join(', ')}.`,
    };
  }
  const source = norm as ComputeSource;

  // Attestation is the human-in-the-loop compliance signature; required for agents.
  if (params.computeAttestation !== true) {
    return {
      allow: false,
      status: 400,
      reason: 'compute_attestation must be true: confirm your credential permits automated use.',
    };
  }

  // token_plan_whitelist must name a plan that the operator has explicitly allowed.
  if (source === 'token_plan_whitelist') {
    const allowed = params.allowedTokenPlans ?? [];
    const plan = params.tokenPlan ? normalize(params.tokenPlan) : '';
    if (!plan || !allowed.map(normalize).includes(plan)) {
      return {
        allow: false,
        status: 403,
        reason:
          'compute_source=token_plan_whitelist requires a token_plan on the platform allow-list (' +
          (allowed.length ? allowed.join(', ') : 'none configured') +
          '). Contact the operator to whitelist your plan.',
      };
    }
  }

  return { allow: true, source, tier: computeTier(source) };
}

/** Parse the ALLOWED_TOKEN_PLANS env value ("planA,planB") into a clean list. */
export function parseAllowedTokenPlans(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
