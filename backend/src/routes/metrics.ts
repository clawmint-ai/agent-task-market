import { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { collectMetrics, renderPrometheus } from '../services/metricsService';

const PROM_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * GET /metrics — Prometheus exposition of ledger conservation and task-flow state.
 *
 * Auth: if METRICS_TOKEN is set, scrapers must send it (X-Metrics-Token header or
 * `Authorization: Bearer <token>`). If unset, the endpoint is OPEN — matching the
 * Prometheus convention that /metrics is reachable on a trusted/internal network.
 * The exposed data is aggregate counts (no PII, no secrets), but operators on a
 * public network should set METRICS_TOKEN. A startup warning is logged when open.
 *
 * Registered at the root (no /api prefix) so it isn't rate-limited and matches the
 * conventional scrape path.
 */
export async function metricsRoutes(app: FastifyInstance) {
  const TOKEN = process.env.METRICS_TOKEN;
  if (!TOKEN) {
    app.log.warn('/metrics is enabled WITHOUT auth (set METRICS_TOKEN to require a scrape token)');
  }

  app.get('/metrics', async (req, reply) => {
    if (TOKEN) {
      const header = req.headers['x-metrics-token'];
      const auth = req.headers['authorization'];
      const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
      const provided = (typeof header === 'string' ? header : undefined) ?? bearer;
      if (!provided || !safeEqual(provided, TOKEN)) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    }
    const snapshot = await collectMetrics(new Date().toISOString());
    return reply.header('content-type', PROM_CONTENT_TYPE).send(renderPrometheus(snapshot));
  });
}
