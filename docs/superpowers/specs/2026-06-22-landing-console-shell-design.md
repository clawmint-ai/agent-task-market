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
| Console layout | Left sidebar + content area, grouped nav (replaces top-nav) |
| Stack | Existing Vite + React + TS SPA; no new framework |
| Multi-key | **Deferred** (not in this spec) |

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

Two structural changes in the SPA, no backend change:

1. **Public landing route.** A new `/` (or `/welcome`) route rendered **outside**
   the auth `Shell` — visible signed-out. It does NOT redirect to `/signin`.
   Today the index redirects to `/browse`; instead the index becomes the landing,
   and signed-in users get a "Launch console" / auto-routing into the console.

2. **Sidebar console shell.** Replace the top-nav `Shell` with a layout that has a
   persistent left sidebar (brand mark, grouped nav, account/sign-out at the
   bottom) and a content area. Existing route components (Browse, Publish, …) are
   reused unchanged — only the shell around them changes.

### Routing model

```
/                → Landing (public, no auth gate)
/signin          → SignIn (public)
/app             → ConsoleShell (auth-gated; redirect to /signin if no key)
  /app/browse, /app/publish, /app/work, /app/published,
  /app/wallet, /app/account, /app/admin
```

The console moves under an `/app` prefix so the root is free for the landing.
A signed-in user hitting `/` sees the landing with a "Go to console" button (or
we auto-forward to `/app/browse` if a key is present — decided in the plan).

## Components

### Landing (`web/src/routes/Landing.tsx`)
A full marketing page reusing the design tokens already shipped (gold accent,
Inter/JetBrains Mono, modern-SaaS): hero ("Put your idle AI agent to work" +
primary CTA "Launch console" → `/app`, secondary "Read the docs" →
`docs.clawmint.space`), a feature/flywheel section, a short FAQ, and a footer.
Self-contained; no API calls.

### Console shell (`web/src/components/ConsoleShell.tsx` + `Sidebar.tsx`)
- Left sidebar: brand wordmark at top; grouped nav — **Work** (Browse, My work,
  My tasks, Publish), **Wallet**, **Account**; **Admin** in its own group at the
  bottom; sign-out + account name pinned to the very bottom. lucide icons,
  active-state via the existing NavLink underline/fill pattern adapted to a
  vertical list.
- Content area: a top bar with the current section title + the live/offline
  indicator slot, then the routed page.
- Responsive: sidebar collapses to a top hamburger/drawer under `md`.

### Nav grouping (data)
A small `navGroups` array (label → items) drives the sidebar, so adding the
future "Agent keys" module is a one-line change.

## Data Flow

Unchanged. Landing is static/client-only. Console pages keep using the existing
`lib/api.ts` + `lib/auth.tsx`. The only routing change is the `/app` prefix and a
public root; `auth.tsx`'s key handling is reused as-is.

## Error Handling

- Signed-out user visiting `/app/*` → redirect to `/signin` (existing gate, moved
  to the console shell).
- Landing has no API calls, so no new error states.
- Deep links: because routing is `HashRouter`, `/#/app/wallet` resolves to the
  shell with no server changes (consistent with today).

## Testing

- `vite build` clean; output into `backend/public/`.
- Existing Vitest (api error-mapping) still passes — unaffected.
- Manual smoke: landing renders signed-out; "Launch console" → sign-in when no
  key, → console when keyed; sidebar nav switches sections; sign-out returns to
  landing; responsive drawer works under `md`.
- A `designer` review pass on the landing + sidebar (the aesthetic bar set last
  cycle).

## Out of Scope (YAGNI)

- **Multi-key-per-account** (deferred to its own spec).
- Any backend/API change (routing + components only).
- New marketing copy beyond adapting what the docs site already says.
- Auth changes (still localStorage API key).
- SSR/SEO for the app (still a client SPA; docs site owns marketing SEO — note:
  the user wants a full landing here too, accepted as client-rendered).

## Success Criteria

1. `market.clawmint.space/` shows a full marketing landing with a working
   "Launch console" entry — not an immediate sign-in wall.
2. Logged-in app uses a left-sidebar console with grouped nav; all 7 existing
   sections work under `/app/*`.
3. Sidebar is structured so the future "Agent keys" module slots in as one nav
   entry.
4. `vite build` green into `backend/public/`; backend untouched; existing tests pass.
5. Visual quality matches the modern-SaaS bar from the last cycle (designer review).
