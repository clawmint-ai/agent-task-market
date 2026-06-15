import { FastifyInstance } from 'fastify';
import { createAccount, getAccountById, getCreditHistory } from '../services/accountService';
import { getReputationHistory } from '../services/reputationService';
import { authMiddleware } from '../middleware/auth';
import { RateLimiter } from '../middleware/rateLimit';
import { getRiskEngine } from '../risk';
import { z } from 'zod';

// Compliant compute sources an agent may declare. 'unspecified' is intentionally
// NOT acceptable at registration — every account must pick a real tier so the
// platform's narrative stays on local models / compliant credentials (see
// system-deep-analysis.md §9). Subscription OAuth is not an option at all.
const COMPUTE_SOURCES = ['local_model', 'payg_api_key', 'platform_credit', 'token_plan_whitelist'] as const;

const RegisterSchema = z.object({
  type: z.enum(['human', 'agent']),
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  // Agents MUST declare a compliant compute source. Humans (publishers only) may omit.
  compute_source: z.enum(COMPUTE_SOURCES).optional(),
  // Compliance attestation: the operator confirms their credential permits
  // automated use. Required for agents. The platform cannot technically prove
  // the credential type, so this declaration + attestation is the compliance
  // basis, backed by the onRegister risk hook (fingerprint/Sybil in risk-engine).
  compute_attestation: z.boolean().optional(),
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

    // Agents must declare a compliant compute source + attest to it. This is the
    // compliance gate that keeps subscription-OAuth abuse off the platform.
    if (body.data.type === 'agent') {
      if (!body.data.compute_source) {
        return reply.status(400).send({
          error:
            'Agents must declare compute_source (one of: ' +
            COMPUTE_SOURCES.join(', ') +
            '). Subscription OAuth (Claude Pro/Max, ChatGPT Plus) is not permitted.',
        });
      }
      if (body.data.compute_attestation !== true) {
        return reply.status(400).send({
          error: 'compute_attestation must be true: confirm your credential permits automated use.',
        });
      }
    }

    // Risk seam: closed risk-engine may reject (Sybil/fingerprint) or downgrade
    // the credit class. Open-source default (Noop) allows all, gift class.
    const decision = await getRiskEngine().onRegister({
      type: body.data.type,
      name: body.data.name,
      email: body.data.email,
      computeSource: body.data.compute_source,
      ip: req.ip,
    });
    if (!decision.allow) {
      return reply.status(403).send({ error: decision.reason || 'Registration rejected by risk policy' });
    }

    try {
      const account = await createAccount({
        type: body.data.type,
        name: body.data.name,
        email: body.data.email,
        computeSource: body.data.compute_source,
        metadata: body.data.metadata,
      });
      return reply.status(201).send({
        id: account.id,
        type: account.type,
        name: account.name,
        email: account.email,
        compute_source: account.compute_source,
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
      gift_balance: a.gift_balance,
      earned_balance: a.earned_balance,
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
      history: await getCreditHistory(req.account.id),
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
