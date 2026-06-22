# Web UI Rebuild — Next.js Static Export, Modern-SaaS Aesthetic + Feature Parity

**Date:** 2026-06-22
**Status:** Design (awaiting user approval)
**Topic:** Rebuild the in-app product UI (`backend/public/`) with a real design language and full backend feature coverage

## Goal

Replace the current single-file vanilla-JS UI (528-line `app.js` + Tailwind CDN)
with a Next.js app that (a) looks designed, not AI-generated — a restrained
modern-SaaS aesthetic (Linear/Stripe sensibility, gold `#f5c542` as accent), and
(b) exposes backend capabilities the current UI omits. Built with Next.js but
**statically exported** (`output: 'export'`) so it deploys as plain static files
served by the existing Fastify `@fastify/static` mount — zero new runtime, zero
extra load on the t3.micro.

## Decisions (locked with user)

| Decision | Choice |
| --- | --- |
| Focus | Aesthetics rebuild **and** feature parity |
| Visual style | Modern SaaS — bright, generous whitespace, strong type hierarchy, gold accent, **no emoji icons**, real iconography |
| Stack | Next.js (App Router, React, TypeScript) with `output: 'export'` (static) |
| Hosting | Static files served by Fastify from `backend/public/` (current mount); no SSR, no Node runtime |
| Features to add | Wallet (redeem + earned/gift/frozen 3-state), Account (rotate-key + compute_source/tier), real-time task stream (SSE `/events`), Admin panel (reconcile + risk-flags) |
| Out of scope | SEO for the app (it's behind login; landing-page SEO stays with the Astro docs site) |

## Current State (explored)

- `backend/public/`: `index.html` (55 lines, Tailwind CDN config with the gold
  `brand` palette) + `app.js` (528 lines, vanilla). 5 tabs: browse, publish,
  mywork, published, wallet. In-memory API key (no persistence). Emoji icons
  throughout (🔍 ➕ 🛠️ 💰 ⭐), uniform rounded cards — the "AI look".
- Served by Fastify: `app.register(fastifyStatic, { root: path.join(__dirname, '..', 'public') })` (`backend/src/index.ts:111`).
- **Backend endpoints the current UI does NOT surface:** `/accounts/me/redeem`,
  `/accounts/me/rotate-key`, `compute_source`/`compute_tier` (returned by
  `/accounts/me` but not shown), `frozen_earned` (returned but not shown),
  `/events` SSE stream, `/admin/reconcile`, `/admin/risk-flags` (+ release/confirm).
- API: REST under `/api/v1`, Bearer API-key auth. SSE at `/api/v1/events`
  (auth via key, `?type=` filter, emits `task.new`).

## Architecture

A new top-level **`web/`** directory holding the Next.js app (kept out of
`backend/` so the backend's TS build is untouched). It builds to static HTML/JS
and the output is emitted into `backend/public/` (replacing the current
`index.html` + `app.js`), which Fastify already serves. So at runtime nothing
changes — still static files behind the same mount.

```
web/                              # Next.js app (new; its own package.json)
├── package.json                  # next, react, tailwindcss, lucide-react (icons)
├── next.config.mjs               # output: 'export', distDir or outDir → ../backend/public
├── tailwind.config.ts            # design tokens: gold brand ramp, spacing, type scale
├── tsconfig.json
├── src/
│   ├── app/
│   │   ├── layout.tsx            # shell: header, nav, toasts, auth gate
│   │   ├── page.tsx              # sign-in / register (landing of the app)
│   │   ├── browse/page.tsx       # open tasks + live SSE stream
│   │   ├── publish/page.tsx      # publish task form (all verification modes)
│   │   ├── work/page.tsx         # my executions (claim → submit)
│   │   ├── published/page.tsx    # my published tasks + review submissions
│   │   ├── wallet/page.tsx       # 3-state balance, redeem, reputation history
│   │   ├── account/page.tsx      # profile, compute-tier, rotate-key
│   │   └── admin/page.tsx        # reconcile + risk-flags (token-gated)
│   ├── components/               # Button, Card, Badge, Stat, Modal, Field, Nav…
│   ├── lib/
│   │   ├── api.ts                # typed fetch client (Bearer auth, error mapping)
│   │   ├── auth.ts               # API-key store (localStorage + context)
│   │   └── sse.ts                # EventSource wrapper for /events
│   └── styles/globals.css        # tokens + base layer
└── README.md                     # how to dev/build the web app
```

Because it's `output: 'export'`, the app is a client-rendered SPA at runtime
(React Router via App Router's static export). Auth is a client-side API-key
held in `localStorage` (an improvement over the current in-memory-only key,
which is lost on every refresh). All data comes from the REST API; SSE via
browser `EventSource`.

## Design Language (the anti-AI-look core)

- **Type as hierarchy:** a real type scale (e.g. display / h1 / h2 / body / mono
  for numbers). Money and IDs in a monospace face. No same-size-everything.
- **Restrained color:** neutral foundation (warm grays), gold `#f5c542` reserved
  for primary actions and key data — not every badge. Semantic colors (success/
  danger) muted, not saturated.
- **Real icons:** `lucide-react` line icons replacing all emoji.
- **Spacing rhythm:** an 8px spacing scale; intentional whitespace, not uniform
  card padding everywhere. Asymmetry where it aids scanning (e.g. a wallet
  summary band distinct from task lists).
- **Density where it helps:** task lists and ledger as scannable rows/tables, not
  forced into identical rounded cards.
- The OMC **`designer` agent** is invoked during implementation to author the
  component visuals and review against this language (separate authoring/review
  pass, per project conventions).

## Features (parity additions)

1. **Wallet** — show `earned` / `gift` / `frozen_earned` as three distinct
   figures with one-line explanations; `redeem` form (POSTs `/accounts/me/redeem`,
   handles the `403 REDEEM_ENABLED` disabled state gracefully); reputation
   history list from `/accounts/me/reputation`.
2. **Account** — show `compute_source` + `compute_tier` (Tier 1 local-model
   badge); `rotate-key` action (POSTs `/accounts/me/rotate-key`, shows the new
   key once with a copy affordance + "previous key now invalid" warning).
3. **Real-time task stream** — `browse` holds an `EventSource` to
   `/api/v1/events` (with the type filter), prepends `task.new` events live;
   falls back to a periodic refetch. A subtle "live" indicator.
4. **Admin panel** — a route shown only when an admin token is entered; calls
   `/admin/reconcile` (renders the conservation check result) and
   `/admin/risk-flags` (list with release/confirm actions). Admin token stored
   client-side, sent as the admin header the routes expect.

## Data Flow

Client-only. `lib/api.ts` wraps `fetch` with the Bearer key and maps the typed
error envelope the routes return. `lib/auth.ts` holds the key in `localStorage`
and a React context; pages read it via a hook. `lib/sse.ts` opens `EventSource`
for the browse stream. No server-side data fetching (static export), so no
secrets in the bundle — the user supplies their own key at runtime.

## Build & Deploy

- `web/` builds with `next build` (`output: 'export'`), emitting to
  `backend/public/` (configured via `outDir`/post-build copy). The old
  `index.html`/`app.js` are removed (replaced by the export).
- Fastify serves it unchanged from `backend/public/`. **No SSR, no new process,
  no Caddy change, no extra t3.micro load.**
- A CI step builds `web/` and ensures `backend/public/` is in sync (the export
  is committed, or built in the backend Docker image — decided in the plan).
- Backend `@fastify/static` may need `wildcard`/SPA-fallback so client routes
  (`/wallet`, `/admin`) resolve to the app shell; the plan verifies and adds a
  fallback to `index.html` if needed.

## Error Handling

- API errors surfaced as toasts using the route error envelope (`error` /
  `formErrors`). 402 (insufficient credits) on publish, 403 (redeem disabled,
  reputation gate), 401 (bad key) each get a clear, specific message.
- SSE auto-reconnects; on repeated failure it silently falls back to polling.
- Admin routes returning 404 (token not configured server-side) show a "admin
  not enabled on this server" state rather than a raw error.

## Testing

- Component/unit: the typed `api.ts` error mapping and `auth.ts` key handling
  (Vitest in `web/`).
- Build gate: `next build` (export) must succeed with no type errors; output
  lands in `backend/public/` with an `index.html`.
- Smoke: serve the built `backend/public/` via the backend and verify sign-in,
  browse (with a live SSE event), publish, wallet redeem-disabled state, account
  rotate-key, and admin-not-enabled state render correctly.
- Existing backend tests are unaffected (no backend logic change beyond a
  possible static SPA-fallback config).

## Out of Scope (YAGNI)

- SSR / server components / Node runtime (explicitly static export).
- SEO/meta for the app (behind login; landing SEO is the Astro docs site's job).
- Changing any REST endpoint or backend business logic.
- Auth beyond the existing API-key model (no OAuth/sessions).
- Mobile-native or PWA concerns beyond responsive layout.
- Migrating the Astro docs site.

## Success Criteria

1. The app no longer reads as AI-generated: distinct type hierarchy, restrained
   gold accent, real (non-emoji) icons, intentional spacing — reviewed by the
   `designer` agent against the design language above.
2. All four feature additions work against the live API (wallet redeem + 3-state,
   account rotate-key + compute-tier, live SSE browse, admin panel).
3. `next build` static-exports into `backend/public/`; Fastify serves it with no
   runtime/SSR and no t3.micro load increase.
4. API key persists across refresh (localStorage), unlike today's in-memory key.
5. Backend build/tests unaffected; deploy path unchanged (static files only).
