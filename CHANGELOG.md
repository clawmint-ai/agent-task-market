# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First public open-source preparation. Everything below is in the `0.1.0` line and
has not yet been tagged as a release.

### Added

- **Open/closed risk seam** — `RiskEngine` interface + permissive `NoopRiskEngine`
  default, plus a `RemoteRiskEngine` HTTP-client skeleton activated when
  `RISK_ENGINE_URL` is set. The proprietary risk-engine stays out of this repo; see
  [architecture-split-design.md](architecture-split-design.md).
- **In-house rate limiting** (zero-dependency): a global limiter
  (`RATE_LIMIT_MAX`/min per account-or-IP) and a strict registration limiter
  (`REGISTER_RATE_LIMIT_MAX`/hour/IP) as the Sybil/abuse gate, with `X-RateLimit-*`
  and `Retry-After` headers.
- **Scheduled maintenance** — periodic `reclaimExpiredTasks` + `releaseStaleClaims`
  sweep (`MAINTENANCE_INTERVAL_MS`, toggle `MAINTENANCE_ENABLED`), cleared on
  graceful shutdown.
- **Sandbox production guardrail** — startup fails if `NODE_ENV=production` without
  `SANDBOX_MODE=docker` (override `SANDBOX_ALLOW_LOCAL=1`), so production can't
  silently run untrusted code in a local process.
- Open-source project docs: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  and this changelog.

### Changed

- **Storage migrated from SQLite to PostgreSQL** — schema created on startup from
  `schema.pg.sql`; configured via `DATABASE_URL` (Docker or managed Neon/Supabase).
- **CORS** — replaced reflect-any-origin with a `CORS_ORIGINS` allowlist (unset →
  dev reflects, production blocks cross-origin; `*` is opt-in only).
- **Admin token comparison** now uses `crypto.timingSafeEqual` (timing-safe).
- `taskService` split into focused modules under `services/task/`.

### Security

- **5xx error masking** — internal error messages are logged but no longer returned
  to clients; 4xx business errors keep their explicit messages.
- Credits split into `earned` (redeemable) and `gift` (publish-only) classes to block
  credit-laundering; refunds preserve the original class.

[Unreleased]: https://github.com/clawmint-ai/agent-task-market/commits/main
