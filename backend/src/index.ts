import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import * as path from 'path';
import * as fs from 'fs';
import { runMigrations, closeDb } from './db/pool';
import { accountRoutes } from './routes/accounts';
import { agentKeyRoutes } from './routes/agentKeys';
import { taskRoutes } from './routes/tasks';
import { adminRoutes } from './routes/admin';
import { eventRoutes } from './routes/events';
import { metricsRoutes } from './routes/metrics';
import { createRateLimiter, keyByAccountOrIp, keyByIp, RateLimiter } from './middleware/rateLimit';
import { startMaintenanceLoop } from './runtime/maintenance';
import { HttpMetrics, normalizeRoute } from './domain/httpMetrics';
import { MaintenanceMetrics } from './domain/maintenanceMetrics';
import { trustProxy } from './config';

const numEnv = (name: string, def: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
};

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
export async function buildApp(opts: { logger?: boolean; maintenanceMetrics?: MaintenanceMetrics } = {}): Promise<FastifyInstance> {
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
  // Task-mutation limiter: money-moving routes (publish/claim/submit/verify) get
  // a dedicated, tighter-than-global budget keyed per account — defense-in-depth
  // for balance-mutating endpoints on top of the global limiter.
  const taskLimiter = createRateLimiter({
    name: 'task',
    windowMs: numEnv('TASK_RATE_LIMIT_WINDOW_MS', 60_000),
    max: numEnv('TASK_RATE_LIMIT_MAX', 60), // 60 mutations/min per account or IP
    keyGenerator: keyByAccountOrIp,
  });
  const limiters: RateLimiter[] = [globalLimiter, registerLimiter, adminLimiter, taskLimiter];
  app.decorate('rateLimiters', limiters);

  // ── HTTP RED metrics ─────────────────────────────────────────────────────
  // Shared accumulator: the onResponse hook records, the /metrics route renders.
  const httpMetrics = new HttpMetrics();
  const maintenanceMetrics = opts.maintenanceMetrics ?? new MaintenanceMetrics();

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

  // SPA deep-link fallback: a hard GET of /app/* (e.g. /app/wallet) must return
  // the console SPA shell so client-side routing can resolve it. The landing (/)
  // and assets are served by @fastify/static above; API/health/metrics are real
  // routes. Everything else under /app falls back to app.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && req.url.startsWith('/app')) {
      return reply
        .type('text/html')
        .send(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html')));
    }
    return reply.status(404).send({ error: 'Not found' });
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
      // Typed AppErrors carry a stable machine `code`; surface it so clients can
      // branch on the reason without parsing the human message.
      const code = (error as { code?: string }).code;
      reply.status(status).send(code ? { error: error.message, code } : { error: error.message || 'Request error' });
    }
  });

  // Routes
  await app.register(accountRoutes, { prefix: '/api/v1', registerLimiter });
  await app.register(agentKeyRoutes, { prefix: '/api/v1' });
  await app.register(taskRoutes, { prefix: '/api/v1', taskLimiter });
  await app.register(adminRoutes, { prefix: '/api/v1', adminLimiter });
  await app.register(eventRoutes, { prefix: '/api/v1' });
  // Observability: Prometheus scrape endpoint at the root (no /api prefix).
  await app.register(metricsRoutes, { httpMetrics, maintenanceMetrics });

  return app;
}

async function main() {
  // Run DB migrations then start. Fail-fast: a bad migration must not start a
  // dirty server.
  await runMigrations();

  const maintenanceMetrics = new MaintenanceMetrics();
  const app = await buildApp({ maintenanceMetrics });
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`🚀 Agent Task Market API running on http://0.0.0.0:${port}`);

  // Background maintenance: reclaim expired tasks + release stale claims.
  const maintenance = startMaintenanceLoop(app.log, maintenanceMetrics);

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
