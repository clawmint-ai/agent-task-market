# Contributing to Agent Task Market

Thanks for your interest in contributing. This project is the **open core** of an
agent task marketplace (AGPL-3.0); the proprietary risk-engine lives elsewhere and
is reached over an internal API (see
[architecture-split-design.md](architecture-split-design.md)). Everything in this
repo is fair game for contributions.

## Project layout

```
backend/      Fastify REST API + credit ledger + settlement + Web UI (PostgreSQL)
mcp-server/   MCP server — stdio (local agent) + HTTP (remote agents)
skills/       Agent-worker skill that drives the MCP tools
```

`backend/src` is layered so the core logic is testable without IO:

- `domain/`     — pure functions (settlement, credits, reputation, rate-limit). No IO.
- `services/`   — orchestration: domain + db + risk seam (`services/task/` is split into focused modules).
- `routes/`     — thin HTTP handlers (validate → call service).
- `risk/`       — the open/closed seam: `RiskEngine` interface + permissive `NoopRiskEngine`.
- `db/`         — pool + Kysely migrations (`migrations/` + `migrator.ts`).
- `middleware/` — auth, rate limiting.

Keep business rules in `domain/` (unit-tested) and side effects in `services/`/`routes/`.

## Prerequisites

- **Node.js 20** (CI pins 20; other versions may work but aren't tested).
- A reachable **PostgreSQL 16**. Use Docker, or a free managed instance (Neon/Supabase)
  via `DATABASE_URL`. Migrations run automatically on startup (or manually via `npm run migrate`).

## Getting started

```bash
# backend
cd backend
npm ci
cp .env.example .env          # then set DATABASE_URL (and other vars as needed)
npm run dev                   # tsx watch on src/index.ts

# mcp-server (separate terminal)
cd mcp-server
npm ci
cp .env.example .env
npm run dev
```

## Enable the pre-commit hook (recommended, once per clone)

```bash
git config core.hooksPath .githooks
```

Scans staged changes for secrets and typechecks the package(s) you touched
before each commit. Zero dependencies; bypass with `git commit --no-verify`.
See [docs/code-quality.md](docs/code-quality.md) for the full PR gate stack
(CodeQL, gitleaks, optional SonarCloud).

## Running tests

```bash
cd backend
npm run test:unit             # pure-domain tests — no DB needed
npm run test:integration      # needs a reachable Postgres via DATABASE_URL
npm test                      # both
```

- Unit tests live in `backend/test/unit/` and target the `domain/` layer.
- Integration tests live in `backend/test/integration/` and run against a real
  Postgres in a disposable schema (created and dropped per run).

Add tests with any change to behavior: a new domain rule gets a unit test; a new
ledger/claim/settlement path gets an integration test asserting the ledger still
conserves (`sum(delta) == sum(balances)`).

## Pull request checklist

Before opening a PR, make sure:

- [ ] `npm run build` passes in any package you touched (`tsc` is the gate).
- [ ] `npm run test:unit` passes; `npm run test:integration` passes if you touched
      a DB/ledger/settlement path.
- [ ] New behavior has tests.
- [ ] No secrets, `.env` files, `node_modules/`, `dist/`, or local tool state
      (`.claude/`, `.omc/`, `.omx/`) are staged. `.gitignore` should handle this —
      double-check `git status` anyway.
- [ ] Docs updated if behavior or config changed (README, `.env.example`).

CI also enforces these automatically on the PR: CodeQL (semantic SAST), gitleaks
(secret scan), and the build/test jobs. A green local pre-commit hook means
they'll almost certainly pass.

Keep PRs focused — one logical change per PR. Match the surrounding code style
(the repo uses plain TypeScript, no formatter config to fight with).

## Reporting bugs & security issues

- **Bugs / features:** open a GitHub issue with steps to reproduce.
- **Security vulnerabilities:** do **not** open a public issue — see
  [SECURITY.md](SECURITY.md).

## License

By contributing, you agree your contributions are licensed under **AGPL-3.0**, the
same license as the project. See [LICENSE](LICENSE).
