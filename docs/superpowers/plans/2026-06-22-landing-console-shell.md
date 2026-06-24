# Marketing Landing + Sidebar Console Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `market.clawmint.space` a SEO-indexable static marketing landing at `/` and move the React console app under `/app` with a left-sidebar shell.

**Architecture:** Vite multi-entry build: `landing.html` (static marketing HTML, content + meta/OG/canonical in the markup) emits `index.html`; `app.html` → existing React SPA emits `app.html`. Both build into `backend/public/`. The SPA switches `HashRouter` → `BrowserRouter` (basename `/app`) and gets a left-sidebar `ConsoleShell`. One backend touch: a not-found handler serving `app.html` for hard loads of `/app/*`. Landing reuses the shipped Tailwind tokens; no beta deps (`vite-react-ssg` avoided).

**Tech Stack:** Vite 5 (multi-entry), React 18, react-router-dom 6 (BrowserRouter), Tailwind 3, lucide-react. Backend: Fastify + @fastify/static. Node 22.

**Spec:** `docs/superpowers/specs/2026-06-22-landing-console-shell-design.md`

---

## File Structure

```
web/
├── index.html              # DELETE (replaced by landing.html + app.html entries)
├── landing.html            # CREATE — static marketing landing (emits index.html)
├── app.html                # CREATE — console SPA entry (emits app.html)
├── vite.config.ts          # MODIFY — multi-entry rollupOptions.input
├── public/
│   ├── robots.txt          # CREATE — sitemap pointer
│   └── sitemap.xml         # CREATE — landing URL
└── src/
    ├── main.tsx            # MODIFY — mount under /app (BrowserRouter basename)
    ├── App.tsx             # MODIFY — BrowserRouter basename="/app", ConsoleShell
    └── components/
        ├── ConsoleShell.tsx  # CREATE — sidebar layout + top bar + <Outlet/>
        ├── Sidebar.tsx       # CREATE — grouped vertical nav (navGroups data)
        └── Nav.tsx           # (kept; superseded by Sidebar — not imported after)

backend/src/index.ts        # MODIFY — setNotFoundHandler serving app.html for /app/*
```

Landing is standalone HTML (no React) so it is fully indexable. The console keeps
all existing route components (`web/src/routes/*`) unchanged — only the shell
(top-nav → sidebar) and the router (Hash → Browser, basename `/app`) change.

---

## Task 1: Vite multi-entry split (landing.html + app.html)

**Files:**
- Create: `web/app.html`
- Create: `web/landing.html` (minimal placeholder; real content in Task 5)
- Delete: `web/index.html`
- Modify: `web/vite.config.ts`

- [ ] **Step 1: Create `web/app.html`** — the console SPA entry (same as today's index.html, renamed)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <title>Console · Agent Task Market</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create a placeholder `web/landing.html`** (real content lands in Task 5; this just lets the multi-entry build resolve)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Task Market</title>
  </head>
  <body>
    <main>Agent Task Market — landing placeholder</main>
  </body>
</html>
```

- [ ] **Step 3: Delete the old single entry**

Run: `rm web/index.html`

- [ ] **Step 4: Modify `web/vite.config.ts`** — declare two HTML entries; `landing.html` must emit `index.html` at the output root.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: resolve(here, '../backend/public'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // landing.html -> backend/public/landing.html (renamed to index.html in Step 5)
        landing: resolve(here, 'landing.html'),
        app: resolve(here, 'app.html'),
      },
    },
  },
});
```

> Vite emits each HTML entry at its source filename, so this produces
> `backend/public/landing.html` + `backend/public/app.html`. We want the landing
> served at `/` as `index.html`; Step 5 adds a tiny build post-step to rename it.

- [ ] **Step 5: Add a rename post-step to `web/package.json` build script**

Change the `build` script so the landing entry is served as `index.html`:

```json
"build": "tsc -b && vite build && node -e \"require('fs').renameSync('../backend/public/landing.html','../backend/public/index.html')\"",
```

- [ ] **Step 6: Build and verify both entries emit**

Run: `cd web && npm run build && ls ../backend/public/index.html ../backend/public/app.html`
Expected: build succeeds; both `index.html` (from landing) and `app.html` exist. (`index.html` is the placeholder landing for now; `app.html` is the SPA entry.)

- [ ] **Step 7: Commit**

```bash
git add web/app.html web/landing.html web/vite.config.ts web/package.json backend/public
git rm web/index.html --cached 2>/dev/null || true
git commit -m "build(web): split into landing.html (->index.html) + app.html multi-entry"
```

---

## Task 2: Migrate SPA to BrowserRouter under /app

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Read the current `web/src/App.tsx`** to preserve the route list and Shell logic (it uses `HashRouter`, a `Shell` with top-nav, routes `/browse`…`/admin`, `/signin`).

- [ ] **Step 2: Replace the router in `web/src/App.tsx`** — switch `HashRouter` → `BrowserRouter` with `basename="/app"`, keep the same routes and the (about-to-be-replaced) Shell for now. Only the import + the router element + signin redirect paths change:

```tsx
// was: import { HashRouter, ... } from 'react-router-dom';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
```

And the top-level element:

```tsx
export default function App() {
  return (
    <AuthProvider>
      <Toaster>
        <BrowserRouter basename="/app">
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route element={<Shell />}>
              <Route index element={<Navigate to="/browse" replace />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/publish" element={<Publish />} />
              <Route path="/work" element={<Work />} />
              <Route path="/published" element={<Published />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/account" element={<Account />} />
              <Route path="/admin" element={<Admin />} />
            </Route>
            <Route path="*" element={<Navigate to="/browse" replace />} />
          </Routes>
        </BrowserRouter>
      </Toaster>
    </AuthProvider>
  );
}
```

(The `Shell` that redirects to `/signin` when `!apiKey` stays as-is in this task; it's replaced by `ConsoleShell` in Task 4. Inside the router, paths are relative to `basename` so `/browse` resolves to `/app/browse` in the URL bar.)

- [ ] **Step 3: Build to confirm the SPA still compiles under /app**

Run: `cd web && npm run build`
Expected: PASS. (The app now expects to be served at `/app`; the backend fallback in Task 3 makes hard loads work. `vite preview` will serve it at `/app/` via app.html.)

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx backend/public
git commit -m "feat(web): SPA uses BrowserRouter basename=/app"
```

---

## Task 3: Backend SPA fallback for /app/*

**Files:**
- Modify: `backend/src/index.ts` (after the `@fastify/static` register, ~line 111-115)

- [ ] **Step 1: Read the static-serve + health block** in `backend/src/index.ts` (around lines 108-120) to place the fallback after `fastifyStatic` is registered and before/after the health route consistently.

- [ ] **Step 2: Add a not-found handler that serves `app.html` for `/app/*` hard loads.** Insert this right after the `app.register(fastifyStatic, …)` block:

```ts
  // SPA deep-link fallback: a hard GET of /app/* (e.g. /app/wallet) must return
  // the console SPA shell so client-side routing can resolve it. The landing (/)
  // and assets are served by @fastify/static above; API/health/metrics are real
  // routes. Everything else under /app falls back to app.html.
  const path2 = path; // alias for clarity
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && req.url.startsWith('/app')) {
      return reply
        .type('text/html')
        .send(fs.readFileSync(path2.join(__dirname, '..', 'public', 'app.html')));
    }
    return reply.status(404).send({ error: 'Not found' });
  });
```

- [ ] **Step 3: Ensure `fs` is imported** at the top of `backend/src/index.ts`. If not present, add:

```ts
import fs from 'fs';
```

(Check the existing imports first; `path` is already imported since the static block uses `path.join`.)

- [ ] **Step 4: Typecheck the backend**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify the fallback serves app.html (with the build output present)**

Run (from repo root, backend built or via tsx): start the backend, then
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/app/wallet` → expect `200`;
`curl -s http://localhost:3000/app/wallet | grep -c '<div id="root">'` → expect `1`;
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health` → expect `200` (real route, not the fallback).
Expected: `/app/wallet` returns the SPA shell, `/health` still works, `/` returns the landing.

> If `fs.readFileSync` on every 404 is a concern, it's fine here: `/app/*` hard
> loads are rare (client routing handles in-app nav). Reading the small html file
> per request is acceptable; no caching needed for this scale.

- [ ] **Step 6: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): serve app.html for /app/* SPA deep links"
```

---

## Task 4: Sidebar ConsoleShell

**Files:**
- Create: `web/src/components/Sidebar.tsx`
- Create: `web/src/components/ConsoleShell.tsx`
- Modify: `web/src/App.tsx` (use `ConsoleShell` instead of the inline `Shell`)

- [ ] **Step 1: Create `web/src/components/Sidebar.tsx`** — grouped vertical nav driven by a `navGroups` array (so the future "Agent keys" entry is one line).

```tsx
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Search, PlusCircle, Wrench, ClipboardList, Wallet, User, ShieldCheck, LogOut,
} from 'lucide-react';
import { useAuth } from '../lib/auth';

const navGroups: { label: string; items: { to: string; label: string; Icon: typeof Search }[] }[] = [
  { label: 'Work', items: [
    { to: '/browse', label: 'Browse', Icon: Search },
    { to: '/work', label: 'My work', Icon: Wrench },
    { to: '/published', label: 'My tasks', Icon: ClipboardList },
    { to: '/publish', label: 'Publish', Icon: PlusCircle },
  ]},
  { label: 'Account', items: [
    { to: '/wallet', label: 'Wallet', Icon: Wallet },
    { to: '/account', label: 'Account', Icon: User },
  ]},
  { label: 'Ops', items: [
    { to: '/admin', label: 'Admin', Icon: ShieldCheck },
  ]},
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { setApiKey } = useAuth();
  const nav = useNavigate();
  return (
    <div className="flex flex-col h-full">
      <a href="/" className="flex items-center gap-2 px-4 h-16 shrink-0 font-semibold text-ink-900">
        <span className="text-brand-500">▲</span> Task Market
      </a>
      <nav className="flex-1 overflow-y-auto px-2 space-y-5 py-2">
        {navGroups.map((g) => (
          <div key={g.label}>
            <p className="px-3 mb-1 text-[11px] uppercase tracking-widest text-ink-400">{g.label}</p>
            {g.items.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                    isActive ? 'bg-brand-50 text-brand-700 font-medium' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
                  }`}>
                <Icon size={16} /> {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <button onClick={() => { setApiKey(null); nav('/signin'); }}
        className="flex items-center gap-2 px-4 h-12 shrink-0 border-t border-ink-100 text-sm text-ink-500 hover:text-ink-900">
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/components/ConsoleShell.tsx`** — sidebar + content area, auth gate, responsive drawer.

```tsx
import { useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Sidebar } from './Sidebar';

export function ConsoleShell() {
  const { apiKey } = useAuth();
  const [open, setOpen] = useState(false);
  if (!apiKey) return <Navigate to="/signin" replace />;
  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-60 shrink-0 border-r border-ink-100 bg-white">
        <Sidebar />
      </aside>
      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-60 bg-white border-r border-ink-100">
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <header className="md:hidden flex items-center gap-3 h-14 px-4 border-b border-ink-100 bg-white">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <span className="font-semibold text-ink-900"><span className="text-brand-500">▲</span> Task Market</span>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-8"><Outlet /></main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Use `ConsoleShell` in `web/src/App.tsx`** — replace the inline `Shell` component and its `<Route element={<Shell/>}>` with `<Route element={<ConsoleShell/>}>`, and delete the now-unused inline `Shell` + its `Nav` import.

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { Toaster } from './components/Toaster';
import { ConsoleShell } from './components/ConsoleShell';
import { SignIn } from './routes/SignIn';
import { Browse } from './routes/Browse';
import { Publish } from './routes/Publish';
import { Work } from './routes/Work';
import { Published } from './routes/Published';
import { Wallet } from './routes/Wallet';
import { Account } from './routes/Account';
import { Admin } from './routes/Admin';

export default function App() {
  return (
    <AuthProvider>
      <Toaster>
        <BrowserRouter basename="/app">
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route element={<ConsoleShell />}>
              <Route index element={<Navigate to="/browse" replace />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/publish" element={<Publish />} />
              <Route path="/work" element={<Work />} />
              <Route path="/published" element={<Published />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/account" element={<Account />} />
              <Route path="/admin" element={<Admin />} />
            </Route>
            <Route path="*" element={<Navigate to="/browse" replace />} />
          </Routes>
        </BrowserRouter>
      </Toaster>
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Delete the now-unused top-nav `web/src/components/Nav.tsx`**

Run: `git rm web/src/components/Nav.tsx`
(It's superseded by `Sidebar.tsx`. Confirm nothing else imports it: `grep -rn "components/Nav" web/src` → expect no results after App.tsx is updated.)

- [ ] **Step 5: Build to confirm the console compiles with the sidebar**

Run: `cd web && npm run build && ls ../backend/public/app.html`
Expected: PASS; app.html present.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Sidebar.tsx web/src/components/ConsoleShell.tsx web/src/App.tsx backend/public
git rm web/src/components/Nav.tsx 2>/dev/null || true
git commit -m "feat(web): left-sidebar console shell (grouped nav, responsive drawer)"
```

---

## Task 5: Static marketing landing + SEO assets

**Files:**
- Modify: `web/landing.html` (replace placeholder with the real landing)
- Create: `web/public/robots.txt`
- Create: `web/public/sitemap.xml`

- [ ] **Step 1: Replace `web/landing.html`** with the full static marketing page. Tailwind is applied by importing the project CSS as a module so the landing shares the design tokens. Content is literal HTML (indexable, readable without JS).

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>Agent Task Market — verifiable agent work over MCP</title>
    <meta name="description" content="An MCP-native, self-hostable market for machine-verifiable agent work with auditable credit escrow and automatic settlement." />
    <link rel="canonical" href="https://market.clawmint.space/" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Agent Task Market — verifiable agent work over MCP" />
    <meta property="og:description" content="MCP-native agent work, automatic verification, and auditable credit settlement." />
    <meta property="og:url" content="https://market.clawmint.space/" />
    <meta property="og:image" content="https://market.clawmint.space/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <script type="module" src="/src/landing.ts"></script>
  </head>
  <body class="bg-ink-50 text-ink-800 antialiased">
    <header class="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
      <span class="font-semibold text-ink-900"><span class="text-brand-500">▲</span> Task Market</span>
      <a href="/app" class="text-sm font-medium text-ink-700 hover:text-ink-900">Launch console →</a>
    </header>

    <main class="max-w-5xl mx-auto px-6">
      <section class="py-20 text-center">
        <h1 class="text-4xl md:text-5xl font-bold tracking-tight text-ink-900 max-w-3xl mx-auto">
          Verifiable agent work over MCP.
        </h1>
        <p class="mt-5 text-lg text-ink-500 max-w-2xl mx-auto">
          Agent Task Market is for machine-verifiable agent work. Publish tasks with explicit acceptance criteria, let agent keys execute through MCP, and settle credits through an auditable ledger.
        </p>
        <div class="mt-8 flex items-center justify-center gap-3">
          <a href="/app" class="inline-flex items-center rounded-lg bg-brand-500 hover:bg-brand-600 text-ink-900 font-medium px-5 py-2.5">Launch console</a>
          <a href="https://docs.clawmint.space" class="inline-flex items-center rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-100 px-5 py-2.5">Read the docs</a>
        </div>
      </section>

      <section class="grid md:grid-cols-3 gap-6 pb-20">
        <div class="bg-white border border-ink-100 rounded-xl p-6">
          <h2 class="font-semibold text-ink-900 mb-1">Claim &amp; earn</h2>
          <p class="text-sm text-ink-500">Agents browse open tasks, claim what they can do, submit results, and get paid in credits.</p>
        </div>
        <div class="bg-white border border-ink-100 rounded-xl p-6">
          <h2 class="font-semibold text-ink-900 mb-1">Auto-verified</h2>
          <p class="text-sm text-ink-500">Tasks verify by rules, tests, or LLM grading — accepted work pays out without manual review.</p>
        </div>
        <div class="bg-white border border-ink-100 rounded-xl p-6">
          <h2 class="font-semibold text-ink-900 mb-1">MCP-native</h2>
          <p class="text-sm text-ink-500">Connect over the Model Context Protocol. Any MCP-capable agent can join and start working.</p>
        </div>
      </section>

      <section class="pb-20 max-w-2xl">
        <h2 class="text-2xl font-semibold text-ink-900 mb-4">How it works</h2>
        <ol class="space-y-3 text-ink-600">
          <li><span class="font-medium text-ink-900">1. Publish</span> — a task with a credit bounty; the reward is escrowed.</li>
          <li><span class="font-medium text-ink-900">2. Claim</span> — an agent claims an open task it can complete.</li>
          <li><span class="font-medium text-ink-900">3. Execute &amp; submit</span> — the agent does the work and submits.</li>
          <li><span class="font-medium text-ink-900">4. Verify &amp; pay</span> — accepted work pays the agent; rejected refunds the publisher.</li>
        </ol>
      </section>
    </main>

    <footer class="border-t border-ink-100">
      <div class="max-w-5xl mx-auto px-6 py-8 text-sm text-ink-400 flex items-center justify-between">
        <span>© Agent Task Market</span>
        <a href="https://docs.clawmint.space" class="hover:text-ink-700">Docs</a>
      </div>
    </footer>
  </body>
</html>
```

- [ ] **Step 2: Create `web/src/landing.ts`** — a tiny entry that just imports the Tailwind CSS so Vite emits a stylesheet for the landing and Tailwind scans `landing.html`.

```ts
import './styles/globals.css';
```

- [ ] **Step 3: Make sure Tailwind scans `landing.html`** — confirm `web/tailwind.config.ts` `content` globs include the HTML entry. Update to:

```ts
  content: ['./index.html', './landing.html', './app.html', './src/**/*.{ts,tsx}'],
```

(The old `./index.html` glob is harmless after the rename; adding `landing.html` + `app.html` ensures classes used in the HTML entries aren't purged.)

- [ ] **Step 4: Create `web/public/robots.txt`**

```
User-agent: *
Allow: /

Sitemap: https://market.clawmint.space/sitemap.xml
```

- [ ] **Step 5: Create `web/public/sitemap.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://market.clawmint.space/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
```

- [ ] **Step 6: Build and verify the landing is real HTML with SEO tags**

Run:
```
cd web && npm run build
grep -c "Verifiable agent work over MCP" ../backend/public/index.html   # expect >= 1
grep -c 'property="og:title"' ../backend/public/index.html               # expect 1
grep -c 'rel="canonical"' ../backend/public/index.html                   # expect 1
ls ../backend/public/robots.txt ../backend/public/sitemap.xml            # both present
```
Expected: landing `index.html` contains the hero text + OG + canonical in the markup (not injected by JS); robots.txt + sitemap.xml copied to output.

- [ ] **Step 7: Commit**

```bash
git add web/landing.html web/src/landing.ts web/tailwind.config.ts web/public/robots.txt web/public/sitemap.xml backend/public
git commit -m "feat(web): static marketing landing (SEO: content + OG + canonical) + robots/sitemap"
```

---

## Task 6: Final verification + designer review

- [ ] **Step 1: Clean multi-entry build**

Run: `cd web && rm -rf ../backend/public/* node_modules/.vite && npm run build && ls ../backend/public/index.html ../backend/public/app.html ../backend/public/robots.txt ../backend/public/sitemap.xml`
Expected: all four present; build green.

- [ ] **Step 2: Unit tests still pass**

Run: `cd web && npm run test`
Expected: the api error-mapping tests pass (unaffected).

- [ ] **Step 3: Backend serves landing at / and SPA at /app/***

Start backend (`cd backend && npm run build && DATABASE_URL=<pg> node dist/index.js` or via tsx), then:
```
curl -s http://localhost:3000/ | grep -c "Verifiable agent work over MCP"     # expect >=1 (landing)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/app/wallet      # expect 200 (SPA fallback)
curl -s http://localhost:3000/app/wallet | grep -c '<div id="root">'           # expect 1 (SPA shell)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health          # expect 200 (real route)
```
Expected: `/` = landing HTML, `/app/wallet` = SPA shell, `/health` = JSON 200.

- [ ] **Step 4: Backend scope check**

Run: `git diff --name-only main...HEAD | grep -E '^backend/' | grep -v '^backend/public/'`
Expected: only `backend/src/index.ts` (the SPA fallback) — nothing else under backend.

- [ ] **Step 5: Designer review pass**

Dispatch the OMC `designer` agent (read-only review, then apply polish) against
`web/landing.html` + `web/src/components/Sidebar.tsx` + `ConsoleShell.tsx`,
checking against the modern-SaaS bar from the last cycle: restrained gold,
intentional spacing, strong hierarchy, no emoji, the landing hero feeling
designed not templated. Apply concrete fixes, rebuild, commit:
```bash
git add web backend/public
git commit -m "style(web): designer polish — landing + console sidebar"
```

---

## Self-Review (against the spec)

**Spec coverage:**
- Static SEO landing at `/` (content + meta/OG/canonical in HTML) → Task 1 (entry split), Task 5 (landing HTML + robots/sitemap), Task 6 Step 3 (served at `/`). ✓
- Console SPA under `/app` via BrowserRouter → Task 2. ✓
- Left-sidebar console shell, grouped nav, responsive → Task 4 (Sidebar + ConsoleShell). ✓
- Sidebar structured for future "Agent keys" (one-line add) → Task 4 `navGroups` array. ✓
- Backend SPA fallback (the one allowed backend touch) → Task 3. ✓
- `vite build` multi-entry green into `backend/public/`; tests pass → Task 6 Steps 1-2. ✓
- Designer review → Task 6 Step 5. ✓
- Multi-key explicitly deferred → not in this plan (correct). ✓

**Placeholder scan:** No TBD/TODO. Task 5 Step 3 references `web/tailwind.config.ts` content globs — these exist (created last cycle). The landing imports `./styles/globals.css` (exists). All file paths are concrete.

**Consistency:** `landing.html`→`index.html` (rename in Task 1 build script, asserted in Tasks 5/6); `app.html` is the SPA entry (Task 1) served by the fallback (Task 3) and routed by BrowserRouter basename `/app` (Task 2/4); `navGroups` defined once in `Sidebar.tsx` (Task 4); `ConsoleShell` replaces inline `Shell` and `Nav.tsx` is deleted (Task 4 Steps 3-4). The `/app/signin` vs `/signin`: under basename `/app`, the route path `/signin` renders at URL `/app/signin` — consistent across App.tsx (Task 4) and the auth gate (ConsoleShell redirects to `/signin`, which BrowserRouter resolves under the basename). ✓

**One risk flagged for the implementer:** Task 1's build script renames `landing.html`→`index.html` via a `node -e` inline script with a relative path (`../backend/public/...`) — it assumes the script runs from `web/`. The `build` npm script runs in `web/` (npm sets cwd to package dir), so the relative path resolves correctly. If a future change runs build from repo root, that path breaks — noted.
