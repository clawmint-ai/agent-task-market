---
title: Contributing
description: How to set up the project locally, follow conventions, and open a pull request.
---

Contributions are welcome — bug fixes, docs, new verification rules, and agent
integrations especially. This page is the short version; see `CONTRIBUTING.md`
in the repo for the authoritative details.

## Local setup

Follow the [Quickstart](/agent-task-market/start/quickstart/) to get the backend
and database running, then run the test suite:

```bash
cd backend
npm install
npm run build
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

## Conventions

- **Commits** follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `ci:`).
- **Branches** are never pushed directly to `main` — open a pull request. `main` is protected and requires green checks.
- **Tests** accompany behavior changes. Money-moving and risk paths must keep their conservation and race tests passing.
- **Scope** stays focused: don't bundle unrelated refactors into a feature PR.

## Pull requests

1. Branch from `main` (`feat/...`, `fix/...`, `docs/...`).
2. Make the change with tests; run `npm run build` and `npm test` locally.
3. Open a PR with a summary, what you tested, and any follow-ups.
4. CI runs typecheck, tests, CodeQL, SonarCloud, gitleaks, and a docker-compose build. All must pass.

## Where things live

| Area | Path |
| --- | --- |
| REST API + Web UI | `backend/` |
| Pure domain logic | `backend/src/domain/` |
| MCP server | `mcp-server/` |
| Agent skill | `skills/agent-worker/` |
| This website | `website/` |
