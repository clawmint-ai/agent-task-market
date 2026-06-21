import type { FastifyBaseLogger } from 'fastify';
import { reclaimExpiredTasks, releaseStaleClaims } from '../services/task';
import { MaintenanceMetrics } from '../domain/maintenanceMetrics';

/**
 * Periodic maintenance loop: reclaims past-deadline tasks (refund publisher,
 * close out executions) and releases stale/abandoned claims so max_executors=1
 * tasks can't be locked forever. Both are idempotent and row-locked, so running
 * them on a timer is safe even if a sweep overlaps a live request.
 *
 * Disabled by setting MAINTENANCE_ENABLED=0 (e.g. when an external scheduler
 * drives /admin endpoints instead). Interval via MAINTENANCE_INTERVAL_MS.
 */
export interface MaintenanceLoop {
  /** Run one sweep immediately (also used by tests). Never throws. */
  runOnce: (now?: Date) => Promise<void>;
  /** Stop the timer (graceful shutdown). Idempotent. */
  stop: () => void;
}

export function startMaintenanceLoop(log: FastifyBaseLogger, metrics?: MaintenanceMetrics): MaintenanceLoop | null {
  if (process.env.MAINTENANCE_ENABLED === '0') {
    log.info('maintenance loop disabled (MAINTENANCE_ENABLED=0)');
    return null;
  }

  const intervalMs = (() => {
    const v = Number(process.env.MAINTENANCE_INTERVAL_MS);
    return Number.isFinite(v) && v >= 1000 ? v : 60_000; // default 1 min, floor 1s
  })();

  let running = false; // guard against overlapping sweeps if one runs long

  const runOnce = async (now: Date = new Date()): Promise<void> => {
    if (running) return;
    running = true;
    try {
      // Run sequentially; each guards its own errors so one failing doesn't
      // skip the other or kill the loop. A failure is logged at ERROR AND counted
      // (atm_maintenance_runs_total{outcome="error"}) so the monitoring stack can
      // ALERT — an ERROR log alone isn't actionable (nobody tails it), and a stuck
      // sweep strands publisher refunds / locks max_executors=1 tasks forever.
      try {
        const r = await reclaimExpiredTasks(now);
        if (r.reclaimed > 0) log.info({ ...r }, 'maintenance: reclaimed expired tasks');
        metrics?.record('reclaim', 'ok');
      } catch (e) {
        log.error(e, 'maintenance: reclaimExpiredTasks failed');
        metrics?.record('reclaim', 'error');
      }
      try {
        const s = await releaseStaleClaims(now);
        if (s.released > 0) log.info({ ...s }, 'maintenance: released stale claims');
        metrics?.record('release', 'ok');
      } catch (e) {
        log.error(e, 'maintenance: releaseStaleClaims failed');
        metrics?.record('release', 'error');
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void runOnce(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref(); // don't keep process alive alone
  log.info({ intervalMs }, 'maintenance loop started');

  return { runOnce, stop: () => clearInterval(timer) };
}
