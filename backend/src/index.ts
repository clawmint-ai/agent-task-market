import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import * as path from 'path';
import { runMigrations, closeDb } from './db/pool';
import { accountRoutes } from './routes/accounts';
import { taskRoutes } from './routes/tasks';
import { adminRoutes } from './routes/admin';
import { eventRoutes } from './routes/events';
import { metricsRoutes } from './routes/metrics';
import { createRateLimiter, keyByAccountOrIp, keyByIp, RateLimiter } from './middleware/rateLimit';
import { startMaintenanceLoop } from './runtime/maintenance';
import { HttpMetrics, normalizeRoute } from './domain/httpMetrics';

const numEnv = (name: string, def: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
};

/**
 * Reverse-proxy trust policy. In production the API sits behind Caddy
 * (Caddyfile), so without this Fastify reads req.ip as the proxy's container IP
 * — collapsing every IP-keyed rate-limit bucket into one and stamping every
 * signup_ip identically (which trips the same-IP self-dealing heuristic and
 * freezes all earned rewards). TRUST_PROXY is the number of proxy hops to trust:
 *   0 / unset → trust nothing (req.ip is the socket peer; correct with no proxy)
 *   N (>=1)   → trust the last N hops; req.ip is taken from X-Forwarded-For.
 * A non-numeric value is passed through to proxy-addr verbatim (IP/CIDR list),
 * for deployments that prefer to pin the trusted hop by address.
 */
export function trustProxy(): boolean | number | string {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return false;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n === 0 ? false : n;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw; // proxy-addr accepts an IP / CIDR / comma list
}

/**
 * CORS origin policy. CORS_ORIGINS is a comma-separated allowlist (e.g.
 * "https://app.example.com,https://admin.example.com"). When unset:
 *   - production  → no cross-origin browser access (false). Set CORS_ORIGINS
 *     explicitly to allow a frontend; never ship a wildcard in prod.
 *   - development → reflect any origin (true) for local convenience.
 * "*" is honored only if you set it deliberately.
 */
function corsOrigin(): boolean | string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (raw) {
    if (raw === '*') return true;
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return process.env.NODE_ENV === 'production' ? false : true;
}

/** Build the Fastify app (routes, plugins, error handler) without listening.
 *  Exported so tests can use app.inject() without binding a port. */
export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: trustProxy() });

  await app.register(cors, { origin: corsOrigin() });

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // Global limiter: lenient, keyed by account (post-auth) or IP. Registration
  // limiter: strict, keyed by IP — registration is pre-auth and mints gift
  // credits, so it's the prime abuse target. Both in-memory (single instance).
  const globalLimiter = createRateLimiter({
    name: 'global',
    windowMs: numEnv('RATE_LIMIT_WINDOW_MS', 60_000),
    max: numEnv('RATE_LIMIT_MAX', 120), // 120 req/min per account or IP
    keyGenerator: keyByAccountOrIp,
  });
  const registerLimiter = createRateLimiter({
    name: 'register',
    windowMs: numEnv('REGISTER_RATE_LIMIT_WINDOW_MS', 60 * 60_000), // 1 hour
    max: numEnv('REGISTER_RATE_LIMIT_MAX', 10), // 10 new accounts/hour/IP
    keyGenerator: keyByIp,
  });
  // Admin limiter: strict, keyed by IP. Admin endpoints are token-gated but
  // perform expensive work (reconcile scans the ledger; release/confirm mutate
  // balances), so they get a tighter budget than the lenient global limiter —
  // defense-in-depth against a leaked ADMIN_TOKEN being used to hammer them.
  const adminLimiter = createRateLimiter({
    name: 'admin',
    windowMs: numEnv('ADMIN_RATE_LIMIT_WINDOW_MS', 60_000),
    max: numEnv('ADMIN_RATE_LIMIT_MAX', 20), // 20 req/min/IP
    keyGenerator: keyByIp,
  });
  const limiters: RateLimiter[] = [globalLimiter, registerLimiter, adminLimiter];
  app.decorate('rateLimiters', limiters);

  // ── HTTP RED metrics ─────────────────────────────────────────────────────
  // Shared accumulator: the onResponse hook records, the /metrics route renders.
  const httpMetrics = new HttpMetrics();

  // onResponse fires after the reply is sent, so reply.elapsedTime is final.
  // Skip the scrape path itself (/metrics) so polling doesn't self-pollute the
  // request/latency series.
  app.addHook('onResponse', async (req, reply) => {
    if (req.url === '/metrics') return;
    const route = normalizeRoute(req.routeOptions?.url);
    httpMetrics.observe({
      method: req.method,
      route,
      status: reply.statusCode,
      durationSeconds: reply.elapsedTime / 1000, // elapsedTime is ms
    });
  });

  // Global hook runs on every request except the static UI and health probe
  // (those must stay cheap and always reachable).
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health' || !req.url.startsWith('/api/')) return;
    await globalLimiter.hook(req, reply);
  });

  // Serve the web UI
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  // Global error handler. Must be set BEFORE registering route plugins so the
  // encapsulated (prefixed) child contexts inherit it; setting it afterward
  // leaves already-registered children on Fastify's default handler, which
  // serializes the raw error (message, code) back to the client.
  // 4xx carry deliberate, client-safe messages (validation, business rules) and
  // pass through. 5xx are unexpected — log the full error server-side but return
  // a generic message so internals (stack traces, DB errors, paths) never leak.
  app.setErrorHandler((error, req, reply) => {
    const status = error.statusCode || 500;
    if (status >= 500) {
      app.log.error(error);
      reply.status(status).send({ error: 'Internal Server Error' });
    } else {
      reply.status(status).send({ error: error.message || 'Request error' });
    }
  });

  // Routes
  await app.register(accountRoutes, { prefix: '/api/v1', registerLimiter });
  await app.register(taskRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1', adminLimiter });
  await app.register(eventRoutes, { prefix: '/api/v1' });
  // Observability: Prometheus scrape endpoint at the root (no /api prefix).
  await app.register(metricsRoutes, { httpMetrics });

  return app;
}

async function main() {
  // Run DB migrations then start. Fail-fast: a bad migration must not start a
  // dirty server.
  await runMigrations();

  const app = await buildApp();
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`🚀 Agent Task Market API running on http://0.0.0.0:${port}`);

  // Background maintenance: reclaim expired tasks + release stale claims.
  const maintenance = startMaintenanceLoop(app.log);

  // ── Graceful shutdown ────────────────────────────────────────────────────
  // On SIGTERM/SIGINT: stop timers, drain in-flight requests (app.close), then
  // close the DB pool. Guarded so a second signal doesn't double-run.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received — shutting down gracefully`);
    try {
      maintenance?.stop();
      for (const l of app.rateLimiters) l.stop();
      await app.close(); // stops accepting new conns, waits for in-flight
      await closeDb();
      app.log.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// Only auto-start when run directly (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
