import { FastifyRequest, FastifyReply } from 'fastify';
import { decideRateLimit, RateLimitConfig, RateLimitEntry } from '../domain/rateLimit';

declare module 'fastify' {
  interface FastifyInstance {
    rateLimiters: RateLimiter[];
  }
}

/**
 * In-memory fixed-window rate limiter built on the pure decideRateLimit logic.
 * One limiter = one independent budget (its own Map + config). The backend runs
 * single-instance (docker-compose.yml), so an in-process Map is the right scope;
 * a multi-instance deploy would swap the store for Redis behind the same seam.
 */
export interface RateLimiter {
  /** Fastify hook: enforces the limit, sets headers, replies 429 when blocked. */
  hook: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Drop expired entries so the Map doesn't grow unbounded. */
  cleanup: (nowMs?: number) => void;
  /** Stop the background cleanup timer (graceful shutdown / tests). */
  stop: () => void;
  /** Exposed for tests/observability. */
  size: () => number;
}

export interface RateLimiterOptions extends RateLimitConfig {
  /** How to derive the bucket key from a request. */
  keyGenerator: (req: FastifyRequest) => string;
  /** Namespace so different limiters never collide in logs/headers. */
  name: string;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const store = new Map<string, RateLimitEntry>();
  const cfg: RateLimitConfig = { windowMs: opts.windowMs, max: opts.max };

  // Sweep expired windows roughly once per window (bounded so very short windows
  // don't spin). Unref'd so it never keeps the process alive on its own.
  const sweepMs = Math.min(Math.max(opts.windowMs, 10_000), 60_000);
  const cleanup = (nowMs: number = Date.now()) => {
    for (const [key, entry] of store) {
      if (nowMs - entry.windowStartMs >= cfg.windowMs) store.delete(key);
    }
  };
  const timer = setInterval(() => cleanup(), sweepMs);
  if (typeof timer.unref === 'function') timer.unref();

  const hook = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key = opts.keyGenerator(req);
    const now = Date.now();
    const result = decideRateLimit(store.get(key), now, cfg);
    store.set(key, result.entry);

    reply.header('X-RateLimit-Limit', String(result.limit));
    reply.header('X-RateLimit-Remaining', String(result.remaining));
    reply.header('X-RateLimit-Reset', String(Math.ceil(result.resetMs / 1000)));

    if (!result.allowed) {
      reply.header('Retry-After', String(result.retryAfterSec));
      await reply.status(429).send({
        error: 'Too many requests. Please slow down.',
        retry_after_seconds: result.retryAfterSec,
      });
      // Replying inside an onRequest/preHandler hook short-circuits the route.
    }
  };

  return { hook, cleanup, stop: () => clearInterval(timer), size: () => store.size };
}

/** Key by authenticated account when present, else by client IP. */
export function keyByAccountOrIp(req: FastifyRequest): string {
  const acct = (req as FastifyRequest & { account?: { id: string } }).account;
  return acct?.id ? `acct:${acct.id}` : `ip:${req.ip}`;
}

/** Key strictly by client IP — used for pre-auth endpoints like registration. */
export function keyByIp(req: FastifyRequest): string {
  return `ip:${req.ip}`;
}
