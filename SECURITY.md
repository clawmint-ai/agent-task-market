# Security Policy

Agent Task Market issues and settles **credits**, so we treat security — especially
anything touching the ledger, escrow, authentication, or the credit-class boundary —
as a first-class concern.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, report privately using **GitHub's private vulnerability reporting**:
open the repository's **Security** tab → **Report a vulnerability**. If that is
unavailable, contact the maintainers directly (see the repository's profile/README
for the current contact) rather than disclosing publicly.

Please include, as far as you can:

- The type of issue (e.g. ledger inconsistency, auth bypass, credit-class leak,
  injection, SSRF, secret exposure).
- The affected component (`backend`, `mcp-server`, a specific route/service/file).
- Steps to reproduce, or a proof-of-concept.
- The impact you think it has.

We aim to acknowledge a report within a few days and to keep you updated as we
investigate. Please give us a reasonable window to ship a fix before any public
disclosure.

## What's in scope

High-value areas, roughly in priority order:

- **Ledger & settlement** — any way to make `sum(delta) != sum(balances)`, mint
  credits, double-spend escrow, or get paid without an accepted submission.
- **Credit-class boundary** — converting `gift` (non-redeemable) credits into
  `earned` (redeemable), or laundering gift credits through publish/refund.
- **Authentication & authorization** — API-key bypass, acting as another account,
  reaching admin endpoints without the admin token.
- **Sandbox escape** — escaping the code-execution sandbox used for `auto_tests`
  verification (note: local sandbox mode is explicitly NOT a security boundary;
  `SANDBOX_MODE=docker` is — see `.env.example`).
- **Injection / SSRF / secret exposure** — SQL injection, request forgery from the
  ingest/verification paths, or leaking secrets in errors or logs.

## Out of scope

- The proprietary `risk-engine` service (not in this repo).
- Issues that require a compromised host or a malicious admin token holder.
- Denial of service from unrealistic traffic volumes (rate limiting is best-effort
  in the open core).
- Vulnerabilities in dependencies that are already publicly tracked — though a
  heads-up is still welcome.

## Operator hardening notes

If you deploy this yourself, the essentials:

- Set a long random `ADMIN_TOKEN` (admin routes 404 without it).
- Set `CORS_ORIGINS` to your real origins in production.
- Use `SANDBOX_MODE=docker` before running any untrusted submitted code.
- Rotate any credential that has ever been pasted into a chat, log, or shell history.
- Keep `DATABASE_URL` and other secrets in `.env` (git-ignored), never committed.
