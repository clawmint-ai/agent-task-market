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
| Landing delivery | **Prerendered static HTML** (real content + meta/OG/canonical in the initial HTML) — SEO-complete. NOT a client-rendered SPA route. |
| Console layout | Left sidebar + content area, grouped nav (replaces top-nav) |
| Console URL | SPA served under `/app` (login-gated; SEO irrelevant there) |
| Tooling | `vite-react-ssg` — prerender the landing route to static HTML while the console stays a client SPA, reusing the same React + Tailwind design tokens |
| Stack | Existing Vite + React + TS; no SSR runtime (prerender at build time only) |
| Multi-key | **Deferred** (not in this spec) |

## Why approach A (SEO)

The landing must be **indexable**: search engines need real content + meta tags in
the HTML the server returns. A client-rendered SPA (especially with `HashRouter`,
`/#/...`) returns an empty `<div id="root">` and hash fragments search engines
don't index — so putting the landing inside today's SPA is **not SEO-viable**.

Approach A splits by need: the **landing is prerendered to static HTML at build
time** (content + Open Graph + canonical baked in, plus a sitemap entry) — fully
SEO-complete and served as a plain file. The **console is a client SPA** under
`/app` where SEO doesn't matter (it's behind login). Both are static files served
by Fastify — still no SSR runtime, no extra t3.micro load.

## Current State (explored)

- App is a Vite SPA built into `backend/public/`, served by Fastify. Routes via
  `HashRouter`: `/signin` + a `Shell` (top-nav header) wrapping `/browse`,
  `/publish`, `/work`, `/published`, `/wallet`, `/account`, `/admin`
  (`web/src/App.tsx`).
- `web/src/components/Nav.tsx` is the top horizontal nav (lucide icons).
- Auth: API key in `localStorage` (`web/src/lib/auth.tsx`); `Shell` redirects to
  `/signin` when no key. **One key = one account** today (account row has a single
  `api_key_hash`) — unchanged by this cycle.
- A separate Astro marketing site exists at `docs.clawmint.space`; this landing is
  the *product app's* own front door and will cross-link to docs for深入内容.

## Architecture

Two parts, split by SEO need, both static files served by Fastify — **the only
backend change is a static-serve SPA fallback** (detailed below):

1. **Prerendered landing at `/`.** A React landing component is **prerendered to
   static HTML at build time** (via `vite-react-ssg`), emitting `index.html` with
   the real marketing content, `<title>`, meta description, Open Graph/Twitter
   tags, and a canonical URL already in the markup. Served at the site root. It
   hydrates for interactivity but is fully readable/indexable without JS. A
   `sitemap.xml` + `robots.txt` are emitted alongside.

2. **Console SPA under `/app`.** The existing client-rendered app (Browse,
   Publish, …) moves under `/app`, wrapped in a new left-sidebar console shell.
   SEO is irrelevant here (login-gated), so client rendering is fine. Existing
   route components are reused unchanged — only the shell around them changes.

### Routing model

`vite-react-ssg` uses `react-router` with real path routes (not `HashRouter`),
so prerendered pages map to real files:

```
/                → Landing  (prerendered static HTML — SEO)
/signin          → SignIn   (client SPA)
/app             → ConsoleShell (client SPA, auth-gated → /signin if no key)
  /app/browse, /app/publish, /app/work, /app/published,
  /app/wallet, /app/account, /app/admin
```

Only `/` is prerendered; `/signin` and `/app/*` render client-side from the same
bundle. A signed-in user landing on `/` sees a "Go to console" CTA (no
auto-forward, so the page stays crawlable).

### SPA deep-link fallback (backend)

Moving off `HashRouter` to real paths means a hard load of `/app/wallet` must
return the SPA's `index.html`. Today Fastify's `@fastify/static` has no SPA
fallback. **This is the one small backend touch in this cycle:** add a
not-found handler (or `@fastify/static` wildcard) that serves the SPA shell for
non-API, non-asset routes, while `/` keeps serving the prerendered landing.
The plan verifies the exact mechanism so `/` (landing) and `/app/*` (SPA) don't
collide.

## Components

### Landing (`web/src/routes/Landing.tsx`, prerendered)
A full marketing page reusing the shipped design tokens (gold accent,
Inter/JetBrains Mono, modern-SaaS): hero ("Put your idle AI agent to work" +
primary CTA "Launch console" → `/app`, secondary "Read the docs" →
`docs.clawmint.space`), a feature/flywheel section, a short FAQ, and a footer.
No API calls. Its `<head>` (title, description, OG, canonical) is set via
`vite-react-ssg`'s head API so the tags are in the prerendered HTML.

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

Unchanged for the console. Landing is static (prerendered, no API calls). Console
pages keep using the existing `lib/api.ts` + `lib/auth.tsx`; `auth.tsx`'s key
handling is reused as-is. The routing change is path-based routes + the `/app`
prefix.

## Error Handling

- Signed-out user visiting `/app/*` → redirect to `/signin` (existing gate, moved
  into the console shell).
- Landing has no API calls, so no new error states.
- Hard load / deep link of `/app/wallet` → the backend SPA fallback returns
  `index.html` and the client router resolves the route (replaces the old
  `HashRouter` behavior).

## Testing

- `vite-react-ssg build` clean; output into `backend/public/` with a prerendered
  `index.html` at root whose HTML contains the hero text + meta/OG tags (assert
  via grep on the built file).
- `sitemap.xml` + `robots.txt` present in the build output.
- Existing Vitest (api error-mapping) still passes — unaffected.
- Backend SPA-fallback: a hard GET of `/app/wallet` returns the SPA HTML (not
  404), and `/` returns the prerendered landing.
- Manual smoke: landing renders + is readable with JS disabled (view-source has
  content); "Launch console" → sign-in when no key, → console when keyed; sidebar
  nav switches sections; responsive drawer under `md`.
- A `designer` review pass on the landing + sidebar.

## Out of Scope (YAGNI)

- **Multi-key-per-account** (deferred to its own spec).
- Backend business-logic change (only the static-serve SPA fallback is touched).
- New marketing copy beyond adapting what the docs site already says.
- Auth changes (still localStorage API key).
- SSR at runtime — prerender is **build-time only**; no Node SSR process on the box.

## Success Criteria

1. `market.clawmint.space/` shows a full marketing landing with a working
   "Launch console" entry — not an immediate sign-in wall.
2. Logged-in app uses a left-sidebar console with grouped nav; all 7 existing
   sections work under `/app/*`.
3. Sidebar is structured so the future "Agent keys" module slots in as one nav
   entry.
4. `vite-react-ssg build` green into `backend/public/`; the prerendered `/`
   `index.html` contains hero text + meta/OG; the only backend change is the
   static-serve SPA fallback; existing tests pass.
5. Visual quality matches the modern-SaaS bar from the last cycle (designer review).
