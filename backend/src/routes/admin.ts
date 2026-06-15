import { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { reconcile } from '../services/reconcileService';

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
 */
export async function adminRoutes(app: FastifyInstance) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

  app.get('/admin/reconcile', async (req, reply) => {
    if (!ADMIN_TOKEN) return reply.status(404).send({ error: 'Not found' });
    const provided = req.headers['x-admin-token'];
    if (typeof provided !== 'string' || !safeEqual(provided, ADMIN_TOKEN)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Caller passes the timestamp (the app clock); keeps reconcile pure/testable.
    const report = await reconcile(new Date().toISOString());
    // 200 when balanced, 409 when a discrepancy is detected (alerting can key on this).
    return reply.status(report.ok ? 200 : 409).send(report);
  });
}
