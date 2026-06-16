# Public Deployment Runbook — AWS Lightsail (Tokyo) + Docker Compose + Caddy

First public-beta deployment of the Agent Task Market: backend (Web UI + REST
API), the MCP HTTP endpoint, and a self-hosted Postgres, on a single **AWS
Lightsail** instance in **Tokyo (ap-northeast-1)**, behind Caddy for automatic
TLS. Implements [CLAWMIN-31].

The repo ships the deploy config (`docker-compose.prod.yml`, `deploy/Caddyfile`,
`.env.prod.example`, `.github/workflows/deploy.yml`). This is the **operator
runbook** for the steps that touch your AWS account, DNS, and SSH keys — they
are not, and should not be, automated away.

> Replace `clawmint.space` below if you use a different domain. Public entries:
> `market.clawmint.space` (backend), `mcp.clawmint.space` (MCP).

---

## Architecture

```
                 DNS: market/mcp.clawmint.space → Lightsail static IP
                                   │
                          ┌────────▼─────────┐  :80/:443 (only public ports)
                          │   Caddy (TLS)    │  auto Let's Encrypt
                          └───┬──────────┬───┘
              market.* │ reverse_proxy   │ mcp.* │ reverse_proxy
                          ▼              ▼
                  ┌──────────────┐  ┌──────────────┐
                  │   backend    │  │   mcp-http   │   compose network
                  │  Fastify     │◄─┤  Express     │   (no host ports)
                  │  :3000       │  │  :8080       │
                  └──────┬───────┘  └──────────────┘
                         ▼
                  ┌──────────────┐
                  │  postgres:16 │  self-hosted, named volume pgdata
                  └──────────────┘
   + autoheal: restarts any container Docker marks unhealthy (5s poll)
```

One Lightsail box runs the whole stack via `docker compose`. Only Caddy binds
public ports; backend/MCP/Postgres are reachable only on the internal compose
network. This is IaaS — we operate the box, unlike a managed PaaS.

---

## Prerequisites

- AWS account (registered ✓).
- A registered domain with DNS you can edit (`clawmint.space`).
- An SSH keypair for the instance (Lightsail can generate one).

---

## 1. Create the Lightsail instance

Lightsail console → Create instance:
- Region: **Tokyo (ap-northeast-1)** — lowest-latency AWS region balancing
  mainland-China best-effort and global reach. (Lightsail has no Hong Kong;
  Tokyo is the call. See "China access" for honest caveats.)
- Blueprint: **OS Only → Ubuntu 22.04 LTS**.
- Plan: the **$5–10/mo** tier (1–2 GB RAM) is enough for this beta. 2 GB is
  safer if you later enable docker-mode sandbox.
- Download/attach the SSH key.

Then:
- **Networking → attach a static IP** (so DNS doesn't break on reboot).
- **Firewall → allow TCP 80 and 443** (22 is open by default). Do NOT open
  3000/8080/5432 — they stay internal.

## 2. Install Docker + clone the repo

SSH in (`ssh -i key.pem ubuntu@<static-ip>`), then:

```bash
# Docker engine + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu    # log out/in so the group applies

# Clone to the path the deploy workflow expects
git clone https://github.com/clawmint-ai/agent-task-market.git
cd agent-task-market
```

## 3. Configure secrets (on the box, never committed)

```bash
cp .env.prod.example .env
# Edit .env: set a strong POSTGRES_PASSWORD (openssl rand -base64 24),
# confirm CORS_ORIGINS=https://market.clawmint.space
```

## 4. Point DNS at the box (required before TLS works)

In your DNS provider, create two **A records** → the Lightsail static IP:

```
market.clawmint.space  A  <static-ip>
mcp.clawmint.space     A  <static-ip>
```

Caddy gets certs via the HTTP-01 challenge on :80, so DNS must resolve to the
box **before** the first boot, or ACME validation fails. (If you front this with
Cloudflare later, use grey-cloud/DNS-only first so ACME can validate; see the
HSTS note below before enabling the orange-cloud proxy.)

## 5. First boot

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose ps          # all healthy?
docker compose logs caddy  # confirm certs issued for both names
```

The backend runs `runMigrations()` on boot (idempotent `CREATE TABLE IF NOT
EXISTS`), so the schema is applied on first boot and re-applied harmlessly after.

Verify:

```bash
curl -fsS https://market.clawmint.space/health   # {"status":"ok",...}
curl -fsS https://mcp.clawmint.space/health      # {"status":"ok","transport":"http"}
```

## 6. Auto-deploy from GitHub

Add these repo secrets (GitHub → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | Lightsail static IP |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_SSH_KEY` | private key whose public half is on the box |
| `DEPLOY_PATH` | `/home/ubuntu/agent-task-market` |

After that, `.github/workflows/deploy.yml` SSHes in on every push to `main`,
does `git reset --hard origin/main` + `docker compose up -d --build`. CI (ci.yml)
gates the merge, so main only moves after typecheck/tests/build pass.

---

## China access — honest caveats

Best-effort reachability, **not** a guarantee. Nothing here sits in mainland
China, so there's no ICP filing and no mainland PoP:

- **Tokyo is the lever we have.** Lightsail offers no Hong Kong region; Tokyo is
  the closest low-latency option. Cross-border latency and GFW throttling still
  apply and can't be configured away.
- A single box is **one origin** — no global anycast. For better worldwide
  reach later, front it with a CDN (CloudFront / Cloudflare).
- Reliable, fast *mainland* access is a different project: mainland hosting
  (Aliyun/Tencent or AWS China) + ICP filing + a China-side entity. Out of scope
  for this beta. Note `.space` may not be an ICP-eligible TLD.

## Untrusted-code sandbox — now actually possible

Unlike Fly, a Lightsail box **has a Docker daemon**, so the `docker` sandbox
([backend/src/runtime/sandbox.ts]) can run here. It is **off by default** (the
in-process runner is NOT a security boundary). Before accepting public,
untrusted submissions:

1. Set `SANDBOX_MODE=docker` in `.env`.
2. Uncomment the `/var/run/docker.sock` mount on `backend` in
   `docker-compose.prod.yml`.
3. Pre-pull the sandbox image (`docker pull node:20-bookworm-slim`).

Mounting the host socket gives the backend container significant host control —
acceptable for a single-tenant box you own, but understand the trade-off. The
demo's `SANDBOX_ALLOW_LOCAL=1` escape hatch is deliberately **not** carried into
prod.

---

## Acceptance criteria → how to verify

| Criterion | How to verify |
|---|---|
| `git push main` → new version live within 5 min | Push a trivial change; watch the **Deploy** Action. SSH pull + incremental `compose up --build` on a small image lands well under 5 min. |
| Public access at `https://market.clawmint.space` | `curl -fsS https://market.clawmint.space/health` after step 5. |
| Health-check failure → auto-restart within 30s | Backend/MCP healthchecks mark unhealthy in ~9s (3s×3); `autoheal` polls every 5s and restarts → well under 30s. Test: `docker compose exec backend sh -c 'kill 1'` or break the port, then watch `docker events` / `docker compose ps`. |
| Postgres connection stable, with pooling | Backend uses `pg.Pool` ([backend/src/db/pool.ts]) — always-on pooling. Confirm steady state via `docker compose logs backend` (no connection-churn errors). |

[CLAWMIN-31]: https://linear.app/clawmint/issue/CLAWMIN-31
[CLAWMIN-13]: https://linear.app/clawmint/issue/CLAWMIN-13
