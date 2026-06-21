// Typed application errors (tech-debt H). Routes previously mapped failures to
// HTTP status codes by STRING-MATCHING service error messages
// (e.message === 'Insufficient credits', e.message.startsWith('Task not found')),
// which silently broke whenever a message was reworded. These classes carry the
// status (as `statusCode`, which Fastify's error handler reads natively) plus a
// stable machine `code`, so the existing setErrorHandler maps them and the
// per-route string matching goes away. Statuses preserved exactly as the routes
// returned them before, so this is behavior-preserving.

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 400 — a malformed/invalid request the client can fix (bad state transition,
 *  unclaimable task, etc.). */
export class BadRequestError extends AppError {
  readonly statusCode = 400;
  readonly code = 'bad_request';
}

/** 402 — the account lacks the credits the action requires. */
export class InsufficientCreditsError extends AppError {
  readonly statusCode = 402;
  readonly code = 'insufficient_credits';
  constructor(message = 'Insufficient credits') { super(message); }
}

/** 403 — authenticated but not permitted (e.g. acting on a task you don't own). */
export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = 'forbidden';
}

/** 404 — the addressed resource does not exist. */
export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'not_found';
}

/** 409 — the request conflicts with current state (duplicate email, a risk flag
 *  that's no longer open, etc.). */
export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'conflict';
}
