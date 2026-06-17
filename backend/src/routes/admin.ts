import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { reconcile } from '../services/reconcileService';
import { listRiskFlags, releaseRiskFlag, confirmRiskFlag } from '../services/riskFlagService';
import type { RateLimiter } from '../middleware/rateLimit';

/** Constant-time string compare to avoid leaking the token via timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Admin/ops endpoints. Protected by a shared ADMIN_TOKEN (env). If ADMIN_TOKEN
 * is unset, admin routes are disabled (404) — they must never be open.
 *
 * Every route is additionally rate-limited by `adminLimiter` (a dedicated, strict
 * per-IP budget) via a plugin-scoped onRequest hook: these handlers do expensive
 * work (ledger reconcile, balance-mutating freeze/release), so they get a tighter
 * limit than the lenient global one — defense-in-depth if ADMIN_TOKEN leaks.
 */
export async function adminRoutes(
  app: FastifyInstance,
  opts: { adminLimiter?: RateLimiter }
) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  const adminLimiter = opts.adminLimiter;

  // Plugin-scoped: applies to every route registered in this plugin, and nothing
  // else (Fastify encapsulation). Runs before the route handler; replying inside
  // the hook (429 when over budget) short-circuits the request.
  if (adminLimiter) {
    app.addHook('onRequest', adminLimiter.hook);
  }

  // Gate shared by every admin route: 404 when disabled (no token configured),
  // 401 on a missing/wrong token. Returns true when the request may proceed.
  function authed(req: FastifyRequest, reply: FastifyReply): boolean {
    if (!ADMIN_TOKEN) {
      reply.status(404).send({ error: 'Not found' });
      return false;
    }
    const provided = req.headers['x-admin-token'];
    if (typeof provided !== 'string' || !safeEqual(provided, ADMIN_TOKEN)) {
      reply.status(401).send({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  app.get('/admin/reconcile', async (req, reply) => {
    if (!authed(req, reply)) return reply;
    // Caller passes the timestamp (the app clock); keeps reconcile pure/testable.
    const report = await reconcile(new Date().toISOString());
    // 200 when balanced, 409 when a discrepancy is detected (alerting can key on this).
    return reply.status(report.ok ? 200 : 409).send(report);
  });

  // ── Risk flags (CLAWMIN-23) ────────────────────────────────────────────────
  // List flagged outcomes (default: open). Lets an operator review held rewards.
  app.get('/admin/risk-flags', async (req, reply) => {
    if (!authed(req, reply)) return reply;
    const { status } = (req.query as { status?: string }) || {};
    if (status && !['open', 'released', 'frozen'].includes(status)) {
      return reply.status(400).send({ error: 'status must be open|released|frozen' });
    }
    const flags = await listRiskFlags(status as 'open' | 'released' | 'frozen' | undefined);
    return reply.send({ flags });
  });

  // Release a held flag: unfreeze the credits back into the executor's earned balance.
  app.post('/admin/risk-flags/:id/release', async (req, reply) => {
    if (!authed(req, reply)) return reply;
    const { id } = req.params as { id: string };
    try {
      await releaseRiskFlag(id, 'admin');
      return reply.send({ id, status: 'released' });
    } catch (e: any) {
      return reply.status(409).send({ error: String(e.message || e) });
    }
  });

  // Confirm a held flag: uphold the freeze (credits stay out of circulation).
  app.post('/admin/risk-flags/:id/confirm', async (req, reply) => {
    if (!authed(req, reply)) return reply;
    const { id } = req.params as { id: string };
    try {
      await confirmRiskFlag(id, 'admin');
      return reply.send({ id, status: 'frozen' });
    } catch (e: any) {
      return reply.status(409).send({ error: String(e.message || e) });
    }
  });
}
