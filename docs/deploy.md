# Public Deployment Runbook — Fly.io (hkg) + Cloudflare

This is the first public-beta deployment of the Agent Task Market: backend
(Web UI + REST API) and the MCP HTTP endpoint, on Fly.io in Hong Kong, fronted
by a custom domain. It implements [CLAWMIN-31].

The repo ships the deploy config (`backend/fly.toml`, `mcp-server/fly.toml`,
`.github/workflows/deploy.yml`). This document is the **operator runbook** for
the steps that touch your Fly account, DNS, and real money — they are not, and
should not be, automated away.

> Replace `<domain>` with the domain you registered (e.g. `clawmint.space`)
> everywhere below. Public entries: `market.<domain>` (backend), `mcp.<domain>` (MCP).

---

## Architecture

```
                    Cloudflare DNS (+ optional proxy)
                              │
          market.<domain>     │     mcp.<domain>
                ▼             │            ▼
   ┌────────────────────┐    │   ┌────────────────────┐
   │  clawmint-market    │   │   │   clawmint-mcp       │
   │  Fastify :3000      │◄──┼───│  Express :8080       │
   │  Web UI + REST API  │  6PN  │  MCP HTTP (stateless)│
   └─────────┬──────────┘ private└──────────────────────┘
             │  internal network (clawmint-market.internal)
             ▼
   ┌────────────────────┐
   │  Fly Postgres (hkg) │  connection string injected as DATABASE_URL secret
   └────────────────────┘
```

Two separate Fly apps (not Fly "process groups"): backend and mcp-server are
distinct npm packages with distinct Dockerfiles, so one image per app is cleaner.
The MCP app reaches the backend over Fly's private 6PN network
(`clawmint-market.internal`), so the market API never makes a public round-trip.

---

## Prerequisites

- A [Fly.io](https://fly.io) account with a payment method (beta footprint ~$5–15/mo:
  two `shared-cpu-1x` machines + a small Postgres).
- `flyctl` installed locally: `curl -L https://fly.io/install.sh | sh`, then `fly auth login`.
- The domain registered, with DNS managed by Cloudflare (see "Custom domain").

---

## 1. Provision Postgres (hkg)

```bash
fly postgres create --name clawmint-db --region hkg --vm-size shared-cpu-1x --volume-size 1
```

Note the cluster — you'll attach it next. (Alternative: a Neon connection string
set directly as the `DATABASE_URL` secret in step 3. If you go Neon, also set
`DATABASE_SSL=verify-full` since it's a public TLS endpoint. Fly Postgres over
6PN is plaintext-internal, so it needs no SSL.)

## 2. Create the apps (no deploy yet)

```bash
fly apps create clawmint-market
fly apps create clawmint-mcp
```

(`fly launch` would try to generate its own fly.toml — we already have them, so
`apps create` + an explicit `deploy --config` keeps our config authoritative.)

## 3. Wire secrets (never commit these)

Attach Postgres to the backend — this injects `DATABASE_URL` as a secret:

```bash
fly postgres attach clawmint-db --app clawmint-market
```

Anything else the backend needs goes through the Fly secret store, e.g.:

```bash
# CORS allowlist so the browser UI on the custom domain can call the API.
fly secrets set --app clawmint-market \
  CORS_ORIGINS="https://market.<domain>"
# Optional, only if you use them (see backend/.env.example):
#   ADMIN_TOKEN, LLM_API_KEY, RISK_ENGINE_URL/KEY, DATABASE_SSL
```

The MCP app is stateless — its only config (`MARKET_API_URL`, transport) is in
`mcp-server/fly.toml`. It needs no secrets unless you later add per-deployment auth.

## 4. First deploy (manual, to verify before automating)

```bash
fly deploy --remote-only --config backend/fly.toml    --dockerfile backend/Dockerfile    -a clawmint-market
fly deploy --remote-only --config mcp-server/fly.toml --dockerfile mcp-server/Dockerfile -a clawmint-mcp
```

The backend runs `runMigrations()` on boot (idempotent `CREATE TABLE IF NOT EXISTS`),
so the schema is applied on first deploy and re-applied harmlessly thereafter.

Verify on the Fly-provided hostnames before touching DNS:

```bash
curl -fsS https://clawmint-market.fly.dev/health   # {"status":"ok",...}
curl -fsS https://clawmint-mcp.fly.dev/health      # {"status":"ok","transport":"http"}
```

## 5. Custom domain + TLS

For each hostname, request a Fly certificate, then create the matching DNS record:

```bash
fly certs add market.<domain> -a clawmint-market
fly certs add mcp.<domain>    -a clawmint-mcp
fly certs show market.<domain> -a clawmint-market   # shows the exact records to add
```

In Cloudflare DNS, add a `CNAME` for each subdomain pointing at the app's
`.fly.dev` hostname (or the A/AAAA records `fly certs show` prints).

**Proxy mode — pick deliberately:**
- **DNS only (grey cloud):** Fly terminates TLS. Simplest; `fly certs` validates
  via the DNS record directly. Start here.
- **Proxied (orange cloud):** Cloudflare terminates TLS at its edge. You must set
  the Cloudflare SSL mode to **Full (strict)** so the edge→origin hop stays
  verified against Fly's cert. Adds DDoS protection and caching. Do this only
  after the grey-cloud path is confirmed working, and coordinate HSTS with
  [CLAWMIN-13] — `.space` is NOT on the HSTS preload list, so you keep the
  gradual-rollout option (unlike `.dev`/`.app`).

## 6. Auto-deploy from GitHub

One-time: mint a deploy token and store it as a repo secret.

```bash
fly tokens create deploy -a clawmint-market -x 8760h   # 1-year deploy token
# If the two apps are in the same Fly org, one org-scoped token can cover both;
# otherwise mint a second for clawmint-mcp and reconcile FLY_API_TOKEN usage.
```

GitHub → repo → Settings → Secrets and variables → Actions → New secret:
- Name: `FLY_API_TOKEN`
- Value: the token printed above

After that, `.github/workflows/deploy.yml` deploys on every push to `main`
(path-filtered per app). The workflow waits for Fly health checks to pass, so a
green run means the new version is actually serving.

---

## China access — honest caveats

This is **best-effort reachability, not a guarantee.** No part of this stack sits
in mainland China, so there is no ICP filing and no mainland PoP:

- **hkg is the real lever.** Hong Kong is the lowest-latency Fly region to the
  mainland; it's why we pin `primary_region = "hkg"`. Cross-border latency and
  GFW throttling still apply and can't be configured away.
- **Cloudflare's free/standard plan does NOT use mainland China PoPs** (that needs
  the Enterprise China Network add-on + an ICP licence). So a mainland visitor via
  Cloudflare still egresses to a nearby (e.g. Hong Kong) PoP. Cloudflare here buys
  DDoS protection, caching, and a stable anycast edge — **not** mainland acceleration.
- If reliable, fast mainland access becomes a hard requirement, that's a different
  project: mainland hosting (Aliyun/Tencent) + ICP filing + a China-side entity.
  Out of scope for this managed-container beta.

## Known limitation: untrusted-code sandbox

`backend/fly.toml` deliberately leaves `SANDBOX_MODE` unset. The `docker` sandbox
([backend/src/runtime/sandbox.ts]) needs a Docker daemon that a plain Fly app VM
does not provide; unset falls back to the in-process runner, which is **not a
security boundary**. That's acceptable only while the only tasks are trusted/seed
tasks. **Before accepting public, untrusted task submissions, resolve this**
(e.g. a Fly Machine with Docker, a separate sandbox service, or a different
isolation mechanism). Track it as its own issue — it is not in CLAWMIN-31's scope.

---

## Acceptance criteria → how to verify

| Criterion | How to verify |
|---|---|
| `git push main` → new version live within 5 min | Push a trivial backend change; watch the **Deploy** Action. flyctl remote build + health-gated rollout for a `shared-cpu-1x` image lands well under 5 min. |
| Public access at `https://market.<domain>` | `curl -fsS https://market.<domain>/health` returns `{"status":"ok",...}` after step 5. |
| Health-check failure → auto-restart within 30s | `[[http_service.checks]]` runs every 10s, 2s timeout. Force a failure (e.g. `fly ssh console` and kill the node process) and confirm `fly logs` shows a restart inside ~30s. |
| Postgres connection stable, with pooling | Backend uses `pg.Pool` ([backend/src/db/pool.ts]) — pooling is in-process and always on. Confirm steady-state with `fly logs` (no connection-churn errors) and `fly postgres ... ` health. |

[CLAWMIN-31]: https://linear.app/clawmint/issue/CLAWMIN-31
[CLAWMIN-13]: https://linear.app/clawmint/issue/CLAWMIN-13
