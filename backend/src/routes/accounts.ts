import { FastifyInstance } from 'fastify';
import { createAccount, getAccountById, getCreditHistory, rotateApiKey, redeemEarned } from '../services/accountService';
import { getReputationHistory } from '../services/reputationService';
import { authMiddleware } from '../middleware/auth';
import { RateLimiter } from '../middleware/rateLimit';
import { getRiskEngine } from '../risk';
import { insertRiskFlag } from '../services/riskFlagService';
import db from '../db/pool';
import { evaluateRegistration, computeTier, parseAllowedTokenPlans } from '../domain/compliance';
import { decideRedeem, isRedeemEnabled } from '../domain/redeem';
import { z } from 'zod';

// compute_source is accepted as a free string and validated in the compliance
// module (domain/compliance.ts), NOT as a Zod enum. This is deliberate: the
// module distinguishes a forbidden subscription-OAuth declaration (→ 403 with a
// compliance explanation) from a missing/misspelled value (→ 400). A Zod enum
// would collapse both into one 400 and lose that signal (see CLAWMIN-20).
const RegisterSchema = z.object({
  type: z.enum(['human', 'agent']),
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  compute_source: z.string().max(64).optional(),
  // Compliance attestation: the operator confirms their credential permits
  // automated use. Required for agents. The platform cannot technically prove
  // the credential type, so this declaration + attestation is the compliance
  // basis, backed by the onRegister risk hook (fingerprint/Sybil in risk-engine).
  compute_attestation: z.boolean().optional(),
  // Names the specific plan when compute_source=token_plan_whitelist; must be on
  // the operator's ALLOWED_TOKEN_PLANS allow-list.
  token_plan: z.string().max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function accountRoutes(
  app: FastifyInstance,
  opts: { registerLimiter?: RateLimiter } = {}
) {
  // Register a new account (human or agent). Strict per-IP rate limit: this is
  // pre-auth and grants gift credits, so it's the prime Sybil/abuse target.
  app.post(
    '/accounts/register',
    opts.registerLimiter ? { preHandler: opts.registerLimiter.hook } : {},
    async (req, reply) => {
    const body = RegisterSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    // Compliance gate (接入层): distinguishes a forbidden subscription-OAuth
    // declaration (403) from a malformed/missing one (400). Humans are exempt.
    const check = evaluateRegistration({
      type: body.data.type,
      computeSource: body.data.compute_source,
      computeAttestation: body.data.compute_attestation,
      tokenPlan: body.data.token_plan,
      allowedTokenPlans: parseAllowedTokenPlans(process.env.ALLOWED_TOKEN_PLANS),
    });
    if (!check.allow) {
      return reply.status(check.status).send({ error: check.reason });
    }

    // Risk seam: closed risk-engine may reject (Sybil/fingerprint) or downgrade
    // the credit class. Open-source default (Noop) allows all, gift class. The
    // LocalRiskEngine may flag a same-IP signup burst (reviewSample) without blocking.
    //
    // FAIL-OPEN (architecture-split-design.md): registration is a non-settlement
    // action, so an unreachable/erroring engine must NOT block signups — that
    // would let a down closed-service take the whole market offline. A reachable
    // engine's explicit allow:false is still honored; only a transport failure
    // (timeout / 5xx / unparseable body, which RemoteRiskEngine throws on) is
    // allowed through. Mirrors the publish/claim handlers in task/lifecycle.ts.
    let decision;
    try {
      decision = await getRiskEngine().onRegister({
        type: body.data.type,
        name: body.data.name,
        email: body.data.email,
        computeSource: body.data.compute_source,
        ip: req.ip,
      });
    } catch (err) {
      req.log.warn({ err }, 'risk-engine onRegister failed — failing open (allowing registration)');
      decision = { allow: true }; // fail-open
    }
    if (!decision.allow) {
      return reply.status(403).send({ error: decision.reason || 'Registration rejected by risk policy' });
    }

    try {
      const account = await createAccount({
        type: body.data.type,
        name: body.data.name,
        email: body.data.email,
        computeSource: check.source,
        signupIp: req.ip,
        metadata: body.data.metadata,
      });
      // Record a review flag for a flagged-but-allowed signup (e.g. same-IP burst).
      // No credits to freeze at registration — amount 0; the flag is an audit signal
      // the admin can act on. Best-effort: never fail a successful registration on it.
      if (decision.reviewSample) {
        try {
          await insertRiskFlag(db, {
            accountId: account.id,
            kind: (decision.flags || [])[0] || 'review',
            amount: 0,
            detail: { flags: decision.flags || [], reason: decision.reason, ip: req.ip },
          });
        } catch (e) {
          req.log.warn({ err: e }, 'failed to record registration risk flag');
        }
      }
      return reply.status(201).send({
        id: account.id,
        type: account.type,
        name: account.name,
        email: account.email,
        compute_source: account.compute_source,
        compute_tier: computeTier(account.compute_source),
        api_key: account.api_key,
        gift_balance: account.gift_balance,
        earned_balance: account.earned_balance,
        credit_balance: account.gift_balance + account.earned_balance,
        created_at: account.created_at,
        message: 'Save your api_key — it will not be shown again',
      });
    } catch (e: any) {
      if (String(e.message).includes('duplicate') || String(e.message).includes('unique')) {
        return reply.status(409).send({ error: 'Email already registered' });
      }
      throw e;
    }
  });

  // Get own profile
  app.get('/accounts/me', { preHandler: authMiddleware }, async (req, reply) => {
    const a = req.account;
    return {
      id: a.id,
      type: a.type,
      name: a.name,
      email: a.email,
      compute_source: a.compute_source,
      compute_tier: computeTier(a.compute_source),
      gift_balance: a.gift_balance,
      earned_balance: a.earned_balance,
      frozen_earned: a.frozen_earned_balance,
      credit_balance: a.gift_balance + a.earned_balance,
      reputation_score: a.reputation_score,
      total_tasks_published: a.total_tasks_published,
      total_tasks_completed: a.total_tasks_completed,
      created_at: a.created_at,
    };
  });

  // Get credit ledger
  app.get('/accounts/me/credits', { preHandler: authMiddleware }, async (req, reply) => {
    return {
      balance: req.account.gift_balance + req.account.earned_balance,
      gift_balance: req.account.gift_balance,
      earned_balance: req.account.earned_balance,
      // Three-field view (CLAWMIN-19): earned = spendable+redeemable,
      // gift = publish-only, frozen_earned = held by risk review (neither).
      earned: req.account.earned_balance,
      gift: req.account.gift_balance,
      frozen_earned: req.account.frozen_earned_balance,
      history: await getCreditHistory(req.account.id),
    };
  });

  // Redeem earned credits for value (API quota / withdrawal). HARD-LOCKED behind
  // REDEEM_ENABLED until the exit is audited — returns 403 while disabled. Gift and
  // frozen credits never redeem (the money-pump guard). See domain/redeem.ts.
  const RedeemSchema = z.object({ amount: z.number().int().positive() });
  app.post('/accounts/me/redeem', { preHandler: authMiddleware }, async (req, reply) => {
    const body = RedeemSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const decision = decideRedeem({
      enabled: isRedeemEnabled(process.env.REDEEM_ENABLED),
      creditClass: 'earned',
      amount: body.data.amount,
      earnedBalance: req.account.earned_balance,
    });
    if (!decision.allow) return reply.status(decision.status).send({ error: decision.reason });

    const earned_balance = await redeemEarned(req.account.id, body.data.amount);
    return { redeemed: body.data.amount, earned_balance, message: 'Redeemed earned credits' };
  });

  // Rotate API key — invalidates the current key immediately and returns a new one.
  app.post('/accounts/me/rotate-key', { preHandler: authMiddleware }, async (req, reply) => {
    const newKey = await rotateApiKey(req.account.id);
    return {
      api_key: newKey,
      message: 'Key rotated. Save this new key — it will not be shown again. The previous key is now invalid.',
    };
  });

  // Get reputation history
  app.get('/accounts/me/reputation', { preHandler: authMiddleware }, async (req, reply) => {
    return { score: req.account.reputation_score, history: await getReputationHistory(req.account.id) };
  });

  // Get public profile
  app.get('/accounts/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const account = await getAccountById(id);
    if (!account) return reply.status(404).send({ error: 'Account not found' });
    return {
      id: account.id,
      type: account.type,
      name: account.name,
      reputation_score: account.reputation_score,
      total_tasks_published: account.total_tasks_published,
      total_tasks_completed: account.total_tasks_completed,
      created_at: account.created_at,
    };
  });
}
