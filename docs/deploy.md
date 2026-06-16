# Public Deployment Runbook — AWS EC2 (Amazon Linux 2023) + Docker Compose + Caddy

First public-beta deployment of the Agent Task Market: backend (Web UI + REST
API), the MCP HTTP endpoint, and a self-hosted Postgres, on a single **AWS EC2**
instance running **Amazon Linux 2023**, behind Caddy for automatic TLS.
Implements [CLAWMIN-31].

Reference instance (the one provisioned): `t3.micro`, Amazon Linux 2023, region
**ap-southeast-1 (Singapore)**, SSH user `ec2-user`, keypair `clawmint`.

The repo ships the deploy config (`docker-compose.prod.yml`, `deploy/Caddyfile`,
`.env.prod.example`, `.github/workflows/deploy.yml`). This is the **operator
runbook** for the steps that touch your AWS account, DNS, and SSH keys — they
are not, and should not be, automated away.

> Replace `clawmint.space` below if you use a different domain. Public entries:
> `market.clawmint.space` (backend), `mcp.clawmint.space` (MCP).

> **Region note:** Singapore is fine for global/SEA reach but is *further* from
> mainland China than Tokyo or Hong Kong. If China best-effort latency matters,
> relaunch in `ap-northeast-1` (Tokyo). Everything below is region-agnostic.

---

## Architecture

```
                 DNS: market/mcp.clawmint.space → EC2 Elastic IP
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

One EC2 box runs the whole stack via `docker compose`. Only Caddy binds public
ports; backend/MCP/Postgres are reachable only on the internal compose network.
This is IaaS — we operate the box, unlike a managed PaaS.

---

## Prerequisites

- AWS account (registered ✓) with a running EC2 instance (Amazon Linux 2023).
- A registered domain with DNS you can edit (`clawmint.space`).
- The launch SSH keypair (`clawmint`) `.pem` file on your machine.

---

## 1. Network: Elastic IP + Security Group (do this first)

The auto-assigned public IP (e.g. `47.129.118.10`) **changes on every
stop/start** — that would break DNS and the deploy secret. Pin it:

- **EC2 → Elastic IPs → Allocate**, then **Associate** it with the instance.
  Use *this* IP everywhere below.
- **EC2 → the instance → Security → its Security Group → Inbound rules → Edit**.
  Ensure:
  - TCP **22** from your IP (SSH) — usually already there.
  - TCP **80** from `0.0.0.0/0` (ACME challenge + http→https redirect).
  - TCP **443** from `0.0.0.0/0` (HTTPS).
  - Do **NOT** open 3000 / 8080 / 5432 — they stay internal to the compose network.

## 2. Install Docker + add swap, then clone

SSH in: `ssh -i clawmint.pem ec2-user@<elastic-ip>`

```bash
# Docker engine (Amazon Linux 2023 — use dnf, NOT get.docker.com which doesn't
# support AL2023 cleanly).
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user      # log out/in so the group applies

# Compose v2 plugin (not packaged on AL2023 — install the plugin binary).
DOCKER_CONFIG=/usr/local/lib/docker
sudo mkdir -p $DOCKER_CONFIG/cli-plugins
sudo curl -fsSL \
  https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o $DOCKER_CONFIG/cli-plugins/docker-compose
sudo chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose
docker compose version                 # verify

# buildx plugin — `docker compose build` delegates to buildx, which AL2023's
# docker package does NOT include. Without it the build hangs with
# "compose build requires buildx 0.17.0 or later". Install the plugin binary
# (its release assets embed the version in the filename, so fetch the tag first).
BUILDX_VER=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest \
  | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
sudo curl -fsSL \
  "https://github.com/docker/buildx/releases/download/${BUILDX_VER}/buildx-${BUILDX_VER}.linux-amd64" \
  -o $DOCKER_CONFIG/cli-plugins/docker-buildx
sudo chmod +x $DOCKER_CONFIG/cli-plugins/docker-buildx
docker buildx version                  # verify >= 0.17.0

# t3.micro has only 1 GB RAM; the on-box `--build` (tsc compile) + 5 containers
# can OOM. Add 2 GB swap.
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Clone to the path the deploy workflow expects.
sudo dnf install -y git
git clone https://github.com/clawmint-ai/agent-task-market.git
cd agent-task-market
```

## 3. Configure secrets (on the box, never committed)

```bash
cp .env.prod.example .env
# Edit .env: set a strong POSTGRES_PASSWORD (openssl rand -hex 24 — use hex,
# NOT base64: base64's / + = chars break the postgres:// DATABASE_URL),
# confirm CORS_ORIGINS=https://market.clawmint.space
```

## 4. Point DNS at the box (required before TLS works)

In your DNS provider, create two **A records** → the EC2 Elastic IP:

```
market.clawmint.space  A  <elastic-ip>
mcp.clawmint.space     A  <elastic-ip>
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
| `DEPLOY_HOST` | EC2 Elastic IP |
| `DEPLOY_USER` | `ec2-user` |
| `DEPLOY_SSH_KEY` | private key whose public half is on the box (the `clawmint` keypair) |
| `DEPLOY_PATH` | `/home/ec2-user/agent-task-market` |

After that, `.github/workflows/deploy.yml` SSHes in on every push to `main`,
does `git reset --hard origin/main` + `docker compose up -d --build`. CI (ci.yml)
gates the merge, so main only moves after typecheck/tests/build pass.

---

## China access — honest caveats

Best-effort reachability, **not** a guarantee. Nothing here sits in mainland
China, so there's no ICP filing and no mainland PoP:

- **Region is the lever we have.** The reference instance is in Singapore;
  Tokyo (`ap-northeast-1`) is closer to the mainland if you relaunch. Either
  way, cross-border latency and GFW throttling still apply and can't be
  configured away. AWS has no general-purpose Hong Kong EC2 without enabling
  that region explicitly.
- A single box is **one origin** — no global anycast. For better worldwide
  reach later, front it with a CDN (CloudFront / Cloudflare).
- Reliable, fast *mainland* access is a different project: mainland hosting
  (Aliyun/Tencent or AWS China) + ICP filing + a China-side entity. Out of scope
  for this beta. Note `.space` may not be an ICP-eligible TLD.

## Untrusted-code sandbox — now actually possible

An EC2 box **has a Docker daemon**, so the `docker` sandbox
([backend/src/runtime/sandbox.ts]) can run here. It is **off by default** (the
in-process runner is NOT a security boundary — it's only safe for trusted/
self-authored seed tasks).

**Order matters.** Once docker-mode is selected, the production guard in
`sandbox.ts` makes the **first submission verification throw** in any in-process
config (the backend boots fine and serves `/health` — only verification
hard-fails, which is easy to miss). So do the box-side prep BEFORE the deploy
that flips it on, so the first real verification works:

1. **Resize the instance to >= 2 GB RAM** (t3.small). On t3.micro (1 GB),
   spawning sandbox containers on top of the 5-container stack OOMs even with
   swap. (AWS console: stop → change instance type → start. Elastic IP persists.)
2. **Create the shared work dir:** `sudo mkdir -p /srv/verify`. This is
   bind-mounted into the backend at the same path. Required because the backend
   runs in a container but spawns the sandbox on the *host* daemon (via the
   socket), so the per-submission dir must resolve to the same path on both
   sides. `VERIFY_TMP=/srv/verify` (set in compose) points the code at it.
3. **Set in `.env`:** `SANDBOX_MODE=docker`,
   `SANDBOX_IMAGE=clawmint-sandbox:latest`, and `DOCKER_GID=<host docker gid>`.
   The backend image runs as the unprivileged `node` user, so to reach the
   root:docker-owned socket it must join the host's docker group:
   `getent group docker | cut -d: -f3` → put that number in `DOCKER_GID`.
4. **Build the sandbox image:**
   `docker build -t clawmint-sandbox:latest deploy/sandbox` (the deploy workflow
   also does this every run; build it by hand once now so the first post-flip
   boot has it). The image bakes in **both** Node and Python+pytest — the stock
   `node:20-bookworm-slim` has no Python, and the sandbox runs `--network=none`
   so it can't `pip install` at run time.

The backend runtime image ships the **docker CLI client** (static binary, no
daemon) so it can drive the host daemon over the socket; the socket mount alone
isn't enough without the client.

Then deploy (merge to main / `compose up`). The overlay already mounts the
socket and `/srv/verify`, joins `DOCKER_GID`, and re-arms the guard.

> **Why the guard must be re-armed (a real bug we hit):** base `docker-compose.yml`
> sets `SANDBOX_ALLOW_LOCAL=1` for the trusted demo. Compose **merges** `environment:`
> maps across `-f` files, so simply *omitting* the key in the prod overlay does
> NOT remove it — the guard stays disabled and prod silently runs untrusted code
> in-process. The overlay now uses `SANDBOX_ALLOW_LOCAL: !reset null` to actually
> drop it. Regression-locked by `test/unit/sandbox.test.ts`.

> **Socket = host-root-equivalent.** Mounting `/var/run/docker.sock` lets a
> compromised backend control the host daemon. The sandbox still isolates the
> submitted code itself (no network, dropped caps, ro rootfs, mem/cpu/pids
> limits), so this is an accepted **beta** trade-off; gVisor/Firecracker is the
> long-term boundary (tracked separately).

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
