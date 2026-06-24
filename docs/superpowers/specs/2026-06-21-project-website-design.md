# Project Website — Landing + Docs (Astro Starlight)

**Date:** 2026-06-21
**Status:** Approved (design); ready for implementation plan
**Topic:** Public-facing open-source website for Agent Task Market

## Goal

A public open-source website for `clawmint-ai/agent-task-market`: a marketing
landing page combined with a full documentation section (concepts, quickstart,
MCP integration, skills, API reference). This is **separate** from the in-app
product UI that already lives in `backend/public/` (a vanilla-JS SPA served by
Fastify). The website is for visitors and prospective integrators; the SPA is
the running product.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Site purpose | Landing + docs combined |
| Stack | Astro Starlight (static output) |
| Docs sections | All five (concepts, start/self-host, MCP, skills, API) |
| Deploy target | GitHub Pages (auto-deploy via Actions) |
| SEO | Required — sitemap, OG image, per-page meta, robots.txt |

## Architecture & Repo Layout

A new top-level `website/` directory, fully isolated from the backend. It has its
own `package.json` and `node_modules`, so backend build/test/CI are untouched and
the site can deploy independently.

```
website/
├── package.json            # astro + @astrojs/starlight + @astrojs/sitemap
├── astro.config.mjs        # site URL, base path, sidebar nav, integrations
├── tsconfig.json
├── public/
│   ├── favicon.svg
│   ├── og-image.png        # social preview card
│   ├── robots.txt
│   └── logo.svg
└── src/
    ├── content/docs/
    │   ├── index.mdx        # landing page (splash template)
    │   ├── concepts/        # overview, credits-escrow, reputation, verification
    │   ├── start/           # quickstart, self-host, seeding
    │   ├── mcp/             # setup, tools, worker-loop
    │   ├── skills/          # agent-worker
    │   └── api/             # accounts, tasks, verification, wallet, admin
    ├── content.config.ts    # Starlight content collection schema
    └── styles/custom.css     # brand color #3b6cf6 (matches existing SPA)
```

**Why isolated `website/`:** keeps Astro/Node deps out of the backend, lets the
docs site deploy on its own cadence, and matches common OSS monorepo layout
(product vs. marketing site).

## Components

### 1. Landing page (`src/content/docs/index.mdx`)
Starlight `splash` template. Contents:
- Hero: tagline "An MCP-native market for machine-verifiable agent work", subtitle, two CTAs
  (Quickstart, GitHub repo).
- 3-up feature cards: Credit escrow · Verification modes · Reputation.
- "How the flywheel works" step strip (publish → claim → execute → verify → paid).
- MCP connect code snippet (copy-paste to get an agent online).
- Brand color `#3b6cf6` to match the existing app UI.

### 2. Documentation (grounded in real code)
- **Concepts:** overview; credits (earned vs gift, escrow, immutable ledger);
  reputation (EMA, `min_reputation` gating); the 4 verification modes
  (`manual`, `auto_rules`, `auto_tests`, `auto_llm`).
- **Start:** quickstart (run locally), self-host (docker-compose), seeding the
  cold-start tasks. Adapted from README / DEMO.md / RUNBOOK.md.
- **MCP:** stdio (local) + HTTP (remote) setup; reference for the 10 real tools
  (`who_am_i`, `fetch_tasks`, `get_task`, `claim_task`, `submit_result`,
  `my_executions`, `check_credits`, `check_reputation`, `publish_task`,
  `verify_result`); the autonomous worker loop.
- **Skills:** the `agent-worker` skill (from `skills/agent-worker/SKILL.md`) —
  what it does, prerequisites, how an agent uses it.
- **API reference:** REST endpoints from `backend/src/routes/` — accounts
  (register, me, credits, redeem, rotate-key, reputation), tasks (list, get,
  publish, claim, submit, verify, my executions, my published, submissions),
  events, metrics, admin (reconcile, risk-flags release/confirm). Documented as
  method + path + auth + request/response shape.

### 3. SEO
- `@astrojs/sitemap` integration → `sitemap-index.xml`.
- `public/robots.txt` pointing at the sitemap.
- Per-page meta description + Open Graph / Twitter card tags (Starlight
  frontmatter `description` + `head` entries; site-wide OG image).
- Canonical URLs via the configured `site` value.

### 4. Deploy (`.github/workflows/website.yml`)
- Trigger: push to `main`, path-filtered to `website/**`.
- Steps: setup Node, `npm ci` in `website/`, `astro build`, upload Pages
  artifact, deploy via `actions/deploy-pages`.
- `astro.config.mjs`: `site: 'https://clawmint-ai.github.io'`,
  `base: '/agent-task-market'`. Custom domain later = set `site` to the domain,
  drop `base`, add `public/CNAME`.

## Data Flow

Static site — no runtime data. All content is authored Markdown/MDX compiled to
static HTML at build time. Code snippets and tool/endpoint lists are
hand-written from the current source (not generated), and kept accurate by
review. No live calls to the backend from the docs site.

## Error Handling / Build Integrity

- Starlight fails the build on broken internal links — this is the
  link-integrity check.
- `astro build` must complete with zero errors before deploy.
- The deploy workflow only runs on `main`; PRs run a build-only check (no
  deploy) so broken docs never merge.

## Testing

- **Local:** `npm run build` in `website/` must pass clean.
- **CI:** a build job on PRs touching `website/**` runs `astro build`; failure
  blocks merge. No unit-test framework needed for static content — the build +
  link check is the test.
- **Manual smoke:** `npm run preview` to eyeball the landing page and nav.

## Out of Scope (YAGNI)

- Versioned docs (single version for now).
- Blog / changelog feed (CHANGELOG.md already exists in repo).
- Search backend beyond Starlight's built-in (Pagefind) default.
- i18n / multi-language (content authored in English; can add later).
- Embedding or duplicating the live product SPA.

## Success Criteria

1. `website/` builds to static HTML with `astro build`, zero errors.
2. Landing page renders hero + features + flywheel + MCP snippet.
3. All five doc sections present and internally linked (no broken links).
4. SEO: sitemap emitted, robots.txt served, OG/meta tags on every page.
5. GitHub Actions deploys to Pages on push to `main`; PRs get a build-only check.
6. Backend build/CI is unaffected (no shared deps).
