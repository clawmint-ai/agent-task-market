import type {
  RiskEngine,
  RiskDecision,
  RegisterCtx,
  ClaimCtx,
  PublishCtx,
  FinalizeCtx,
} from './types';
import db from '../db/pool';
import { sql } from 'kysely';
import {
  decideSelfDealing,
  decideNewAccountPublishCap,
  decideRegistrationThrottle,
} from '../domain/sybil';

/**
 * OPEN-CORE reference risk engine (CLAWMIN-23). Opt-in via RISK_ENGINE_MODE=local.
 * Implements the BASELINE same-origin self-dealing / new-account / Sybil-burst
 * heuristics from domain/sybil.ts, backed by simple DB lookups. It does NOT replace
 * the closed risk-engine (RISK_ENGINE_URL) — that hosts the real collusion graph and
 * fingerprint models. This exists so a standalone deployment has working, auditable
 * fraud controls instead of the permissive Noop default. All thresholds are env-tunable.
 *
 * Posture: this engine FLAGS (review) rather than DENIES wherever a false positive
 * would hurt a legitimate user on a shared network — only the new-account publish cap
 * is a hard gate, and that bounds the publisher's own escrow, not a payout.
 */
export class LocalRiskEngine implements RiskEngine {
  private readonly newAccountWindowMs =
    Number(process.env.RISK_NEW_ACCOUNT_WINDOW_MS) || 7 * 24 * 60 * 60 * 1000; // 7d
  private readonly newAccountMaxReward = Number(process.env.RISK_NEW_ACCOUNT_MAX_REWARD) || 50;
  private readonly signupThrottleWindowMs =
    Number(process.env.RISK_SIGNUP_WINDOW_MS) || 30 * 60 * 1000; // 30m
  private readonly signupThrottleThreshold = Number(process.env.RISK_SIGNUP_THRESHOLD) || 3;

  async onRegister(ctx: RegisterCtx): Promise<RiskDecision> {
    // Count signups already seen from this IP within the throttle window. The new
    // account isn't created yet, so this counts strictly-prior registrations.
    if (!ctx.ip) return { allow: true, creditClass: 'gift' };
    const cutoff = new Date(Date.now() - this.signupThrottleWindowMs);
    const row = await db
      .selectFrom('accounts')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('signup_ip', '=', ctx.ip)
      .where(sql<boolean>`${sql.ref('created_at')} >= ${cutoff}`)
      .executeTakeFirst();
    const decision = decideRegistrationThrottle({
      priorCountInWindow: Number(row?.c ?? 0),
      threshold: this.signupThrottleThreshold,
    });
    // Always allow registration (flag-not-block); surface flags/review for the caller
    // to persist a risk_flags row. Credit class stays 'gift' (publish-only) regardless.
    return {
      allow: true,
      creditClass: 'gift',
      reviewSample: decision.review,
      flags: decision.flags,
      reason: decision.reason,
    };
  }

  async onClaim(_ctx: ClaimCtx): Promise<RiskDecision> {
    // Self-dealing is judged at FINALIZE (payout time): claiming alone moves no
    // credits, and judging at payout lets the freeze attach to the actual reward.
    return { allow: true };
  }

  async onPublish(ctx: PublishCtx): Promise<RiskDecision> {
    const acct = await db
      .selectFrom('accounts')
      .select(['created_at'])
      .where('id', '=', ctx.publisherId)
      .executeTakeFirst();
    if (!acct) return { allow: true }; // unknown publisher: let the core's own checks handle it
    const cap = decideNewAccountPublishCap({
      accountCreatedAt: new Date(acct.created_at as unknown as string),
      now: new Date(),
      rewardCredits: ctx.rewardCredits,
      maxReward: this.newAccountMaxReward,
      windowMs: this.newAccountWindowMs,
    });
    return cap.allow ? { allow: true } : { allow: false, reason: cap.reason };
  }

  async onFinalize(ctx: FinalizeCtx): Promise<RiskDecision> {
    // Only acceptances pay out, so only they can be self-dealt. A rejection moves no
    // credits to the executor → nothing to review.
    if (!ctx.accepted) return { allow: true, reviewSample: false };
    const rows = await db
      .selectFrom('accounts')
      .select(['id', 'signup_ip'])
      .where('id', 'in', [ctx.publisherId, ctx.executorId])
      .execute();
    const publisherIp = rows.find((r) => r.id === ctx.publisherId)?.signup_ip ?? null;
    const executorIp = rows.find((r) => r.id === ctx.executorId)?.signup_ip ?? null;
    const decision = decideSelfDealing({ publisherIp, executorIp });
    // allow:true always — we pay then freeze (reviewSample), never block the payout.
    return {
      allow: true,
      reviewSample: decision.review,
      flags: decision.flags,
      reason: decision.reason,
    };
  }
}
