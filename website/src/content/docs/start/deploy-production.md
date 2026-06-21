---
title: Deploy to production
description: Run the stack publicly on a single host with Docker Compose and Caddy for automatic TLS.
---

The repo ships a production stack: backend (Web UI + REST API), the MCP HTTP
endpoint, self-hosted Postgres, and Caddy for automatic TLS — all via
`docker-compose.prod.yml`. The authoritative, step-by-step operator runbook is
`docs/deploy.md` in the repo; this page is the overview.

## Architecture

A single host (e.g. an AWS EC2 instance) runs the whole stack with Docker
Compose. Only Caddy binds public ports (`:80`/`:443`); the backend, MCP, and
Postgres are reachable only on the internal compose network.

```
  DNS: market/mcp.<your-domain> → host IP
                │
          ┌─────▼─────┐  :80/:443 only public ports
          │   Caddy   │  automatic Let's Encrypt TLS
          └──┬─────┬──┘
   market.*  │     │  mcp.*   (reverse_proxy)
             ▼     ▼
      ┌──────────┐ ┌──────────┐
      │ backend  │ │ mcp-http │   internal compose network
      │ :3000    │ │ :8080    │   (no host ports)
      └────┬─────┘ └──────────┘
           ▼
      ┌──────────┐
      │ postgres │  named volume pgdata
      └──────────┘
  + autoheal restarts any container Docker marks unhealthy
```

## Shipped deploy config

| File | Purpose |
| --- | --- |
| `docker-compose.prod.yml` | The production service stack |
| `deploy/Caddyfile` | Reverse proxy + automatic TLS for `market.*` and `mcp.*` |
| `.env.prod.example` | Template for production environment variables |
| `.github/workflows/deploy.yml` | Auto-deploy on push to `main` |

## What you operate yourself

These touch your cloud account, DNS, and SSH keys, and are intentionally not
automated — see `docs/deploy.md` for the exact commands:

1. **Provision a host** (e.g. EC2 Amazon Linux 2023) and install Docker + Compose.
2. **Point DNS** — `market.<domain>` and `mcp.<domain>` to the host's static IP.
3. **Set production env** — copy `.env.prod.example` to `.env.prod` and fill in
   `DATABASE_URL`, `ADMIN_TOKEN`, `METRICS_TOKEN`, and (if used) `RISK_ENGINE_*`.
   Compose only injects **named** env vars — make sure each is listed in the
   backend service's `environment` block, not just present in the file.
4. **Bring it up** — `docker compose -f docker-compose.prod.yml up -d --build`.

## Production safety

- **Sandbox:** accepting untrusted submissions requires `SANDBOX_MODE=docker`.
  The local-process sandbox is not a security boundary.
- **Secrets:** never commit `.env.prod`. Rotate any credential that has been
  exposed before opening to real traffic.
- **Migrations** run automatically on backend startup; the first deploy against
  an existing database should be baseline-migrated (see `docs/deploy.md`).
