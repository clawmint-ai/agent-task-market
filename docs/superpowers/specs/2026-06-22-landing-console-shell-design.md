# Product App: Marketing Landing + Sidebar Console Shell

**Date:** 2026-06-22
**Status:** Design (awaiting user approval)
**Topic:** Give `market.clawmint.space` a real marketing landing page and restructure the logged-in app into a left-sidebar console

## Goal

The product app (`market.clawmint.space`, the Vite + React SPA in `backend/public/`)
currently drops visitors straight onto a sign-in screen and, once in, uses a flat
top-nav with 7 tabs. Make it feel like a real product:

1. A **full marketing landing page** at the app root, with a clear entry into the console ("Launch console" / sign-in).
2. The logged-in app restructured into a **left-sidebar console** (Vercel/Stripe/Supabase-style) with grouped navigation, ready to hold "complete management tools."

This is the **first** of three planned cycles. Explicitly **out of scope here** (own later spec→plan→build): **multi-key-per-account** (one human account managing many agent API keys) — that's a backend data-model + auth change and is deferred.

## Decisions (locked with user)

| Decision | Choice |
| --- | --- |
| Sequence | Landing + console shell first; multi-key deferred to its own cycle |
| Landing scope | Full marketing landing on the app root (hero/features/flywheel/FAQ + console entry) — the `market` domain becomes the main face |
| Landing delivery | **Standalone static HTML** (real content + meta/OG/canonical written into the HTML at build time) — SEO-complete. NOT a client-rendered SPA route. |
| Console layout | Left sidebar + content area, grouped nav (replaces top-nav) |
| Console URL | SPA served under `/app` (login-gated; SEO irrelevant there) |
| Tooling | A second Vite entry (`landing.html`) styled with the existing Tailwind config. **No new/beta dependency** — `vite-react-ssg` is beta-only and is avoided; the landing is static HTML+CSS for what is essentially static marketing content. |
| Stack | Existing Vite + React + TS + Tailwind; landing is static HTML+CSS (+ optional tiny JS), console stays the React SPA |
| Multi-key | **Deferred** (not in this spec) |

## Why approach A (SEO)

The landing must be **indexable**: search engines need real content + meta tags in
the HTML the server returns. A client-rendered SPA (especially with `HashRouter`,
`/#/...`) returns an empty `<div id="root">` and hash fragments search engines
don't index — so putting the landing inside today's SPA is **not SEO-viable**.

Approach A splits by need: the **landing is a standalone static HTML page** built
from its own Vite entry (`landing.html`), with marketing content + Open Graph +
canonical baked into the markup at build time, plus a `sitemap.xml` + `robots.txt`
— fully SEO-complete, readable with JS disabled, served as a plain file at `/`. The
**console is the React client SPA** under `/app` where SEO doesn't matter (behind
login). Both are static files served by Fastify — no SSR runtime, no extra
t3.micro load.

> `vite-react-ssg` would let the landing reuse React components, but it is
> **beta-only** (`0.9.1-beta.1`, no stable release). For static marketing content
> a hand-authored HTML entry is the lower-risk choice; minor style duplication is
> acceptable since the landing shares the Tailwind config.

## Current State (explored)

- App is a Vite SPA built into `backend/public/`, served by Fastify. Routes via
  `HashRouter`: `/signin` + a `Shell` (top-nav header) wrapping `/browse`,
  `/publish`, `/work`, `/published`, `/wallet`, `/account`, `/admin`
  (`web/src/App.tsx`). Single entry `web/index.html` → `web/src/main.tsx`.
- `web/src/components/Nav.tsx` is the top horizontal nav (lucide icons).
- Auth: API key in `localStorage` (`web/src/lib/auth.tsx`); `Shell` redirects to
  `/signin` when no key. **One key = one account** today (account row has a single
  `api_key_hash`) — unchanged by this cycle.
- Backend serves `backend/public/` via `@fastify/static` at `prefix: '/'`
  (`backend/src/index.ts:111`), no SPA fallback.
- A separate Astro marketing site exists at `docs.clawmint.space`; this landing is
  the *product app's* own front door and will cross-link to docs for深入内容.

## Architecture

Two parts, split by SEO need, both static files served by Fastify — **the only
backend change is a static-serve SPA fallback** (detailed below):

1. **Static landing at `/`.** A new Vite entry `web/landing.html` with the real
   marketing content directly in the markup (hero copy, headings, FAQ text) plus
   `<title>`, meta description, Open Graph/Twitter tags, and a canonical URL in
   `<head>`. Tailwind classes (existing config) style it; optional tiny inline JS
   for a mobile menu toggle, but content is fully present without JS. Vite builds
   it to `index.html` at the output root. `sitemap.xml` + `robots.txt` go in
   `web/public/` so they're copied verbatim.

2. **Console SPA under `/app`.** The existing client-rendered React app (Browse,
   Publish, …) becomes a second entry `web/app.html` → `web/src/main.tsx`, built
   to `app.html`, wrapped in a new left-sidebar console shell. SEO is irrelevant
   here (login-gated). Existing route components are reused unchanged — only the
   shell around them changes.

### Vite multi-entry build

`vite.config.ts` gets `build.rollupOptions.input` with two HTML entries:
`landing` → `web/landing.html` (emits `index.html`) and `app` → `web/app.html`
(emits `app.html`). Both output into `backend/public/` (existing `outDir`). The
current single `web/index.html` is replaced by these two entries.

### Routing model

```
/                → landing (static index.html — SEO)
/app             → app.html → React SPA (BrowserRouter, basename="/app")
  /app/signin
  /app/browse, /app/publish, /app/work, /app/published,
  /app/wallet, /app/account, /app/admin
```

The SPA switches from `HashRouter` to `BrowserRouter` with `basename="/app"`, so
console routes are real paths under `/app`. The landing links to `/app` to enter
the console. A signed-in user landing on `/` sees a "Go to console" CTA (no
auto-forward, so `/` stays crawlable).

### SPA deep-link fallback (backend)

Real paths under `/app` mean a hard load of `/app/wallet` must return the SPA's
`app.html`. Today `@fastify/static` (prefix `/`) would 404 it. **The one backend
touch this cycle:** a not-found handler that, for a non-API (`!/api/`,
`!/health`, `!/metrics`) GET whose path starts with `/app`, serves
`backend/public/app.html`; `/` continues to serve the static landing `index.html`.
The plan verifies the exact mechanism (setNotFoundHandler vs. `@fastify/static`
wildcard) so landing and SPA don't collide.

## Components

### Landing (`web/landing.html` + `web/src/landing.css` if needed)
A full marketing page reusing the shipped Tailwind tokens (gold accent,
Inter/JetBrains Mono, modern-SaaS): hero ("Verifiable agent work over MCP" +
primary CTA "Launch console" → `/app`, secondary "Read the docs" →
`https://docs.clawmint.space`), a feature/flywheel section, a short FAQ, and a
footer. Content is literal HTML (indexable, no JS needed). `<head>` carries
title, description, OG/Twitter, and `<link rel="canonical" href="https://market.clawmint.space/">`.

### Console shell (`web/src/components/ConsoleShell.tsx` + `Sidebar.tsx`)
- Left sidebar: brand wordmark at top; grouped nav — **Work** (Browse, My work,
  My tasks, Publish), **Wallet**, **Account**; **Admin** in its own group at the
  bottom; sign-out + account name pinned to the very bottom. lucide icons,
  active-state via the existing NavLink pattern adapted to a vertical list.
- Content area: a top bar with the current section title + the live/offline
  indicator slot, then the routed page.
- Responsive: sidebar collapses to a top hamburger/drawer under `md`.

### Nav grouping (data)
A small `navGroups` array (label → items) drives the sidebar, so adding the
future "Agent keys" module is a one-line change.

## Data Flow

Unchanged for the console. Landing is static (no API calls). Console pages keep
using the existing `lib/api.ts` + `lib/auth.tsx`; `auth.tsx`'s key handling is
reused as-is. The routing change is `HashRouter` → `BrowserRouter` (basename
`/app`).

## Error Handling

- Signed-out user visiting `/app/*` (except `/app/signin`) → redirect to
  `/app/signin` (existing gate, moved into the console shell).
- Landing has no API calls, so no new error states.
- Hard load / deep link of `/app/wallet` → the backend SPA fallback returns
  `app.html` and the client router resolves the route (replaces old `HashRouter`).

## Testing

- `vite build` clean (multi-entry); output into `backend/public/` with `index.html`
  (landing) + `app.html` (console). Assert via grep that `index.html` contains the
  hero text + `og:` meta + canonical.
- `sitemap.xml` + `robots.txt` present in the build output.
- Existing Vitest (api error-mapping) still passes — unaffected.
- Backend SPA-fallback: a hard GET of `/app/wallet` returns `app.html` (not 404);
  `/` returns the landing; `/api/*` and `/health` are unaffected.
- Manual smoke: landing readable with JS disabled (view-source has content);
  "Launch console" → sign-in when no key, → console when keyed; sidebar nav
  switches sections; responsive drawer under `md`.
- A `designer` review pass on the landing + sidebar.

## Out of Scope (YAGNI)

- **Multi-key-per-account** (deferred to its own spec).
- Backend business-logic change (only the static-serve SPA fallback is touched).
- New marketing copy beyond adapting what the docs site already says.
- Auth changes (still localStorage API key).
- SSR at runtime — landing is build-time static HTML; no Node SSR process.
- `vite-react-ssg` / React-component prerender (beta-only; avoided).

## Success Criteria

1. `market.clawmint.space/` returns a static marketing landing whose HTML
   (view-source) contains the hero text + meta/OG/canonical — not an immediate
   sign-in wall, and readable with JS disabled.
2. Logged-in app uses a left-sidebar console with grouped nav; all 7 existing
   sections work under `/app/*`.
3. Sidebar is structured so the future "Agent keys" module slots in as one nav entry.
4. `vite build` (multi-entry) green into `backend/public/` with `index.html` +
   `app.html`; the only backend change is the static-serve SPA fallback; existing
   tests pass.
5. Visual quality matches the modern-SaaS bar from the last cycle (designer review).
