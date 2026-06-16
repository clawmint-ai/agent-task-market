// Minimal dependency-free structured logger for the service/domain layer.
//
// Fastify already logs HTTP requests via pino, but pino is only a TRANSITIVE
// dependency (through fastify) and the request logger isn't reachable from the
// service layer without threading it through every call. This logger fills that
// gap for domain events that matter for ops/audit — above all money movements in
// settlement — emitting one JSON object per line (greppable, aggregator-friendly).
//
// Level is controlled by LOG_LEVEL (debug|info|warn|error|silent), default info.
// info/debug → stdout, warn/error → stderr.

export type LogFields = Record<string, unknown>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = { debug: 20, info: 30, warn: 40, error: 50, silent: 100 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL || '').toLowerCase() as LogLevel;
  return LEVELS[raw] ?? LEVELS.info;
}

/**
 * Render a log record to a single JSON line. Pure (time is injected) so it can be
 * unit-tested without touching the clock or stdout.
 */
export function formatLine(level: Exclude<LogLevel, 'silent'>, time: string, msg: string, fields: LogFields): string {
  // Spread fields first so reserved keys (level/time/msg) can't be clobbered.
  return JSON.stringify({ ...fields, level, time, msg });
}

function emit(level: Exclude<LogLevel, 'silent'>, msg: string, fields: LogFields): void {
  if (LEVELS[level] < threshold()) return;
  const line = formatLine(level, new Date().toISOString(), msg, fields) + '\n';
  if (level === 'warn' || level === 'error') process.stderr.write(line);
  else process.stdout.write(line);
}

export const logger = {
  debug: (msg: string, fields: LogFields = {}) => emit('debug', msg, fields),
  info: (msg: string, fields: LogFields = {}) => emit('info', msg, fields),
  warn: (msg: string, fields: LogFields = {}) => emit('warn', msg, fields),
  error: (msg: string, fields: LogFields = {}) => emit('error', msg, fields),
};
