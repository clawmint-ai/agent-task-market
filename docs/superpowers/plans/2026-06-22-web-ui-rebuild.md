# Web UI Rebuild (Vite + React) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vanilla-JS in-app UI with a Vite + React SPA that looks designed (modern-SaaS, gold accent, no emoji) and exposes the backend features today's UI omits (wallet redeem + 3-state balance, account rotate-key + compute-tier, live SSE task stream, admin panel).

**Architecture:** A new top-level `web/` directory (Vite + React + TS, Tailwind, react-router **hash** router, lucide-react icons). `vite build` emits static files into `backend/public/`, which Fastify already serves at `/` — no SSR, no backend code change, no t3.micro load. Hash routing (`/#/wallet`) avoids needing a server-side SPA fallback. API key persists in localStorage. The `designer` agent authors visuals during implementation.

**Tech Stack:** Vite 5, React 18, TypeScript, Tailwind CSS 3, react-router-dom 6 (HashRouter), lucide-react, Vitest. Node 22.

**Spec:** `docs/superpowers/specs/2026-06-22-web-ui-rebuild-design.md`

---

## Why hash routing

`backend/src/index.ts` registers `@fastify/static` with `root: public, prefix: '/'`
and **no not-found fallback**. A browser-history SPA route like `/wallet` would
404 on direct load/refresh. Using `HashRouter` (`/#/wallet`) means every URL
resolves to `index.html` with zero backend changes — preserving the success
criterion "backend build/tests unaffected; deploy path unchanged."

## File Structure

```
web/                              # NEW — Vite + React app (own package.json)
├── package.json
├── vite.config.ts                # build.outDir → ../backend/public, emptyOutDir
├── tsconfig.json
├── tailwind.config.ts            # design tokens: gold ramp, type scale, spacing
├── postcss.config.js
├── index.html                    # mounts #root
├── .gitignore                    # node_modules, (NOT ../backend/public)
└── src/
    ├── main.tsx                  # bootstraps React + HashRouter + AuthProvider
    ├── App.tsx                   # shell: header, nav, <Outlet/>, toaster
    ├── routes/
    │   ├── SignIn.tsx
    │   ├── Browse.tsx
    │   ├── Publish.tsx
    │   ├── Work.tsx
    │   ├── Published.tsx
    │   ├── Wallet.tsx
    │   ├── Account.tsx
    │   └── Admin.tsx
    ├── components/
    │   ├── ui.tsx                # Button, Card, Badge, Stat, Field, Modal
    │   ├── Nav.tsx               # top nav (lucide icons, active state)
    │   └── Toaster.tsx           # toast context + viewport
    ├── lib/
    │   ├── api.ts                # typed fetch client (Bearer, error mapping)
    │   ├── auth.ts               # AuthProvider + useAuth (localStorage key)
    │   ├── sse.ts                # useTaskStream hook over EventSource
    │   └── types.ts             # Account, Task, Execution, etc.
    └── styles/globals.css        # tailwind layers + base tokens

backend/public/                   # build output target (replaces index.html+app.js)
```

The build writes into `backend/public/`; the built assets are committed so the
Dockerfile's `COPY public ./public` (backend/Dockerfile:39) bakes them into prod
with no pipeline change.

---

## Task 1: Scaffold the Vite + React app

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/.gitignore`, `web/src/main.tsx`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "agent-task-market-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "lucide-react": "^0.439.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.45",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `web/vite.config.ts`** — output into `backend/public`, relative base so it works under Fastify's `/` mount.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: resolve(here, '../backend/public'),
    emptyOutDir: true,
  },
});
```

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Task Market</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `web/.gitignore`**

```
node_modules/
```

(Note: do NOT ignore `../backend/public` — the build output there is committed.)

- [ ] **Step 6: Create a minimal `web/src/main.tsx` so the build has an entry**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div>Agent Task Market</div>
  </React.StrictMode>,
);
```

- [ ] **Step 7: Install deps**

Run: `cd web && npm install`
Expected: installs cleanly, `node_modules/` + `package-lock.json` created.

- [ ] **Step 8: Verify the build emits into backend/public**

Run: `cd web && npm run build && ls ../backend/public/index.html ../backend/public/assets`
Expected: build succeeds; `../backend/public/index.html` exists and an `assets/` dir with hashed JS/CSS. (This overwrites the old vanilla `index.html`/`app.js` — intended.)

- [ ] **Step 9: Commit**

```bash
git add web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.json web/index.html web/.gitignore web/src/main.tsx backend/public
git commit -m "feat(web): scaffold Vite + React app, build into backend/public"
```

---

## Task 2: Tailwind + design tokens (modern-SaaS, gold accent)

**Files:**
- Create: `web/tailwind.config.ts`, `web/postcss.config.js`, `web/src/styles/globals.css`
- Modify: `web/src/main.tsx` (import the stylesheet)

- [ ] **Step 1: Create `web/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 2: Create `web/tailwind.config.ts`** — gold brand ramp + a real type scale. This is the anti-AI-look foundation: restrained palette, intentional scale.

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // gold accent (matches the published brand)
        brand: {
          50: '#fdf8e7', 100: '#fbeec2', 200: '#f7df90', 300: '#f3cf5e',
          400: '#f5c542', 500: '#e0aa1f', 600: '#b8860b', 700: '#946a00',
          800: '#6f5000', 900: '#5c4200',
        },
        // warm neutral foundation
        ink: {
          50: '#f7f7f6', 100: '#eceae7', 200: '#d9d6d0', 300: '#b8b3aa',
          400: '#8f8a7e', 500: '#6b665b', 600: '#514d44', 700: '#3d3a33',
          800: '#272521', 900: '#17150f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        display: ['2.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        h1: ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
        h2: ['1.25rem', { lineHeight: '1.3', fontWeight: '600' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(23,21,15,.04), 0 1px 3px rgba(23,21,15,.08)',
        pop: '0 8px 30px rgba(23,21,15,.12)',
      },
      borderRadius: { xl: '0.75rem', '2xl': '1rem' },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: Create `web/src/styles/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html { font-feature-settings: 'cv02','cv03','cv04','cv11'; }
  body { @apply bg-ink-50 text-ink-800 antialiased; }
  /* numbers/IDs use the mono face for a financial feel */
  .tabular { @apply font-mono tabular-nums; }
}
```

- [ ] **Step 4: Import the stylesheet — replace `web/src/main.tsx` with**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="p-8 text-display text-ink-900">Agent Task Market</div>
  </React.StrictMode>,
);
```

- [ ] **Step 5: Build to confirm Tailwind compiles**

Run: `cd web && npm run build && grep -rl "tailwind" ../backend/public/assets >/dev/null 2>&1; ls ../backend/public/assets/*.css`
Expected: build succeeds; a hashed `.css` file exists in `../backend/public/assets/`.

- [ ] **Step 6: Commit**

```bash
git add web/tailwind.config.ts web/postcss.config.js web/src/styles/globals.css web/src/main.tsx backend/public
git commit -m "feat(web): tailwind + design tokens (gold accent, type scale, mono numerals)"
```

---

## Task 3: Types + typed API client + auth store

**Files:**
- Create: `web/src/lib/types.ts`, `web/src/lib/api.ts`, `web/src/lib/auth.tsx`
- Test: `web/src/lib/api.test.ts`

- [ ] **Step 1: Create `web/src/lib/types.ts`** (shapes mirror the REST responses)

```ts
export type AccountType = 'human' | 'agent';

export interface Account {
  id: string;
  type: AccountType;
  name: string;
  email?: string;
  compute_source?: string;
  compute_tier?: number;
  gift_balance: number;
  earned_balance: number;
  frozen_earned: number;
  credit_balance: number;
  reputation_score: number;
  total_tasks_published: number;
  total_tasks_completed: number;
  created_at: string;
}

export interface Verification {
  mode: 'manual' | 'auto_rules' | 'auto_tests' | 'auto_llm';
  rules?: Array<{ type: string; value: string | number; path?: string }>;
  language?: string;
  tests?: string;
  rubric?: string;
  pass_threshold?: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  type: string;
  reward_credits: number;
  min_reputation: number;
  status: string;
  verification?: Verification;
  input_data?: Record<string, unknown>;
}

export interface Execution {
  id: string;
  task_id: string;
  task_title: string;
  type: string;
  reward_credits: number;
  status: string;
  score?: number | null;
  feedback?: string;
  result?: string;
  executor_id?: string;
  executor_name?: string;
}

export interface CreditsView {
  balance: number;
  earned: number;
  gift: number;
  frozen_earned: number;
  history: Array<{ delta: number; reason: string; description?: string }>;
}

export interface ReputationView {
  score: number;
  history: Array<{ score: number; reason?: string; created_at?: string }>;
}

export interface RiskFlag {
  id: string;
  account_id: string;
  kind: string;
  amount: number;
  detail?: Record<string, unknown>;
}
```

- [ ] **Step 2: Write the failing test `web/src/lib/api.test.ts`** for error-mapping (the one piece of real logic in the client).

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { type ApiError, request } from './api';

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch);
}

describe('request', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch(200, { hello: 'world' });
    await expect(request('GET', '/x', { key: 'k' })).resolves.toEqual({ hello: 'world' });
  });

  it('maps a string error envelope to ApiError.message', async () => {
    mockFetch(402, { error: 'Insufficient credits' });
    await expect(request('POST', '/x', { key: 'k' })).rejects.toMatchObject({
      status: 402, message: 'Insufficient credits',
    } satisfies Partial<ApiError>);
  });

  it('maps a zod flatten envelope (formErrors) to a joined message', async () => {
    mockFetch(400, { error: { formErrors: ['bad title'], fieldErrors: {} } });
    await expect(request('POST', '/x', { key: 'k' })).rejects.toMatchObject({
      status: 400, message: 'bad title',
    });
  });
});
```

- [ ] **Step 3: Run it — must fail (module not implemented)**

Run: `cd web && npx vitest run src/lib/api.test.ts`
Expected: FAIL — cannot find `./api` exports.

- [ ] **Step 4: Implement `web/src/lib/api.ts`**

```ts
const API = '/api/v1';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

function messageFromEnvelope(status: number, data: any): string {
  const e = data?.error;
  if (typeof e === 'string') return e;
  if (e?.formErrors?.length) return e.formErrors.join(', ');
  if (e?.fieldErrors) {
    const msgs = Object.values(e.fieldErrors).flat().filter(Boolean) as string[];
    if (msgs.length) return msgs.join(', ');
  }
  if (typeof data?.message === 'string') return data.message;
  return `Error ${status}`;
}

export async function request<T = unknown>(
  method: string,
  path: string,
  opts: { key?: string | null; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.key) headers.Authorization = `Bearer ${opts.key}`;
  const res = await fetch(API + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, messageFromEnvelope(res.status, data));
  return data as T;
}
```

- [ ] **Step 5: Run the test — must pass**

Run: `cd web && npx vitest run src/lib/api.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Implement `web/src/lib/auth.tsx`** (localStorage-backed key + context)

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const KEY_STORAGE = 'atm.apiKey';

interface AuthCtx {
  apiKey: string | null;
  setApiKey: (k: string | null) => void;
}

const Ctx = createContext<AuthCtx>({ apiKey: null, setApiKey: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setKey] = useState<string | null>(() => localStorage.getItem(KEY_STORAGE));
  useEffect(() => {
    if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey);
    else localStorage.removeItem(KEY_STORAGE);
  }, [apiKey]);
  return <Ctx.Provider value={{ apiKey, setApiKey: setKey }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
```

- [ ] **Step 7: Build + test pass, then commit**

Run: `cd web && npm run test && npm run build`
Expected: vitest PASS; build succeeds.

```bash
git add web/src/lib backend/public
git commit -m "feat(web): typed api client (error mapping, tested) + localStorage auth"
```

---

## Task 4: App shell, router, nav, toaster

**Files:**
- Create: `web/src/components/Toaster.tsx`, `web/src/components/ui.tsx`, `web/src/components/Nav.tsx`, `web/src/App.tsx`, stub `web/src/routes/*.tsx`
- Modify: `web/src/main.tsx`

- [ ] **Step 1: Create `web/src/components/Toaster.tsx`** (context + viewport; no emoji)

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; msg: string; tone: 'ok' | 'err' };
const Ctx = createContext<(msg: string, tone?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(Ctx);

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (msg: string, tone: 'ok' | 'err' = 'ok') => {
    const id = performance.now();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id}
            className={`rounded-xl px-4 py-3 text-sm shadow-pop border ${
              t.tone === 'err'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-white border-ink-200 text-ink-800'
            }`}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
```

- [ ] **Step 2: Create `web/src/components/ui.tsx`** (shared primitives — restrained, no emoji)

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({ variant = 'primary', className = '', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-brand-500 hover:bg-brand-600 text-ink-900 font-medium',
    ghost: 'bg-white hover:bg-ink-50 text-ink-700 border border-ink-200',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  }[variant];
  return <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50 ${styles} ${className}`} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white border border-ink-200 rounded-2xl shadow-card p-6 ${className}`}>{children}</div>;
}

export function Stat({ value, label, accent }: { value: ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={`tabular text-2xl ${accent ? 'text-brand-700' : 'text-ink-900'}`}>{value}</span>
      <span className="text-xs uppercase tracking-wide text-ink-400 mt-1">{label}</span>
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'ok' | 'muted' }) {
  const t = {
    neutral: 'bg-ink-100 text-ink-600', brand: 'bg-brand-100 text-brand-800',
    ok: 'bg-green-100 text-green-800', muted: 'bg-ink-100 text-ink-400',
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium text-ink-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400';
```

- [ ] **Step 3: Create `web/src/components/Nav.tsx`** (lucide icons, active state via NavLink)

```tsx
import { NavLink } from 'react-router-dom';
import { Search, PlusCircle, Wrench, ClipboardList, Wallet, User, ShieldCheck } from 'lucide-react';

const items = [
  { to: '/browse', label: 'Browse', Icon: Search },
  { to: '/publish', label: 'Publish', Icon: PlusCircle },
  { to: '/work', label: 'My work', Icon: Wrench },
  { to: '/published', label: 'My tasks', Icon: ClipboardList },
  { to: '/wallet', label: 'Wallet', Icon: Wallet },
  { to: '/account', label: 'Account', Icon: User },
  { to: '/admin', label: 'Admin', Icon: ShieldCheck },
];

export function Nav() {
  return (
    <nav className="flex gap-1 overflow-x-auto">
      {items.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg whitespace-nowrap transition-colors ${
              isActive ? 'bg-brand-100 text-brand-800' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-100'
            }`}>
          <Icon size={16} /> {label}
        </NavLink>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Create the 8 stub route files so the build compiles**

Create each of these with a placeholder export (implemented in later tasks). The export name must match exactly:

```tsx
// web/src/routes/SignIn.tsx
export function SignIn() { return <div className="text-ink-400">SignIn — coming up</div>; }
```

Repeat, changing BOTH the filename and the export name, for:
`Browse` → `web/src/routes/Browse.tsx`, `Publish` → `Publish.tsx`,
`Work` → `Work.tsx`, `Published` → `Published.tsx`, `Wallet` → `Wallet.tsx`,
`Account` → `Account.tsx`, `Admin` → `Admin.tsx`.

- [ ] **Step 5: Create `web/src/App.tsx`** (shell + routes; redirects to sign-in when no key)

```tsx
import { HashRouter, Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Toaster } from './components/Toaster';
import { Nav } from './components/Nav';
import { SignIn } from './routes/SignIn';
import { Browse } from './routes/Browse';
import { Publish } from './routes/Publish';
import { Work } from './routes/Work';
import { Published } from './routes/Published';
import { Wallet } from './routes/Wallet';
import { Account } from './routes/Account';
import { Admin } from './routes/Admin';

function Shell() {
  const { apiKey, setApiKey } = useAuth();
  const nav = useNavigate();
  if (!apiKey) return <Navigate to="/signin" replace />;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-ink-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="font-semibold text-h2">Agent Task <span className="text-brand-600">Market</span></span>
          <button onClick={() => { setApiKey(null); nav('/signin'); }}
            className="text-sm text-ink-400 hover:text-ink-700">Sign out</button>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-2"><Nav /></div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8"><Outlet /></main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster>
        <HashRouter>
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
        </HashRouter>
      </Toaster>
    </AuthProvider>
  );
}
```

- [ ] **Step 6: Replace `web/src/main.tsx` to render `<App/>`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
```

- [ ] **Step 7: Build to confirm the shell compiles**

Run: `cd web && npm run build && ls ../backend/public/index.html`
Expected: build succeeds; index.html present.

- [ ] **Step 8: Commit**

```bash
git add web/src/components web/src/App.tsx web/src/main.tsx web/src/routes backend/public
git commit -m "feat(web): app shell — hash router, nav (lucide), toaster, auth gate"
```

---

## Task 5: SignIn / register route

**Files:**
- Modify: `web/src/routes/SignIn.tsx`

- [ ] **Step 1: Implement `web/src/routes/SignIn.tsx`** (sign in with a key, or register; persists key via auth store)

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Field, inputCls } from '../components/ui';
import type { Account } from '../lib/types';

export function SignIn() {
  const { setApiKey } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [key, setKey] = useState('');
  const [type, setType] = useState<'human' | 'agent'>('human');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [computeSource, setComputeSource] = useState('local_model');
  const [attest, setAttest] = useState(false);
  const [created, setCreated] = useState<Account | null>(null);

  async function signIn() {
    if (!key.trim()) return toast('Enter an API key', 'err');
    try {
      await request<Account>('GET', '/accounts/me', { key: key.trim() });
      setApiKey(key.trim());
      nav('/browse');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Sign in failed', 'err');
    }
  }

  async function register() {
    try {
      const body: Record<string, unknown> = { type, name: name.trim(), email: email.trim() || undefined };
      if (type === 'agent') { body.compute_source = computeSource; body.compute_attestation = attest; }
      const acc = await request<Account & { api_key: string }>('POST', '/accounts/register', { body });
      setCreated(acc);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Registration failed', 'err');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-50 px-6">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-display text-ink-900">Agent Task <span className="text-brand-600">Market</span></h1>
          <p className="text-ink-500 mt-2">Run verifiable agent work over MCP — agent keys execute and settle.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <h2 className="text-h2 mb-4">Sign in</h2>
            <Field label="API key">
              <input className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} placeholder="paste your api_key" />
            </Field>
            <Button className="w-full" onClick={signIn}>Sign in</Button>
          </Card>
          <Card>
            <h2 className="text-h2 mb-4">Create account</h2>
            <Field label="Type">
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as 'human' | 'agent')}>
                <option value="human">Human</option>
                <option value="agent">AI Agent</option>
              </select>
            </Field>
            <Field label="Name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. my-claude-agent" />
            </Field>
            <Field label="Email (optional)">
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            {type === 'agent' && (
              <>
                <Field label="Compute source">
                  <select className={inputCls} value={computeSource} onChange={(e) => setComputeSource(e.target.value)}>
                    <option value="local_model">Local open model (Tier 1)</option>
                    <option value="payg_api_key">Pay-as-you-go API key</option>
                    <option value="token_plan_whitelist">Whitelisted token plan</option>
                    <option value="platform_credit">Platform-provided credit</option>
                  </select>
                </Field>
                <label className="flex items-start gap-2 text-xs text-ink-600 mb-3">
                  <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5" />
                  <span>I confirm my credential permits automated use. Subscription OAuth (Claude Pro/Max, ChatGPT Plus) is not permitted.</span>
                </label>
              </>
            )}
            <Button className="w-full" onClick={register}>Create account</Button>
          </Card>
        </div>
        {created && (
          <Card className="mt-6 border-brand-200 bg-brand-50">
            <h2 className="text-h2 mb-1">Account created — save your API key</h2>
            <p className="text-sm text-ink-600 mb-3">Shown only once. You start with {created.credit_balance} credits.</p>
            <div className="tabular text-xs bg-white border border-ink-200 rounded-lg px-3 py-2 break-all mb-3">{created.api_key}</div>
            <Button onClick={() => { setApiKey(created.api_key); nav('/browse'); }}>Sign in with this key</Button>
          </Card>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `cd web && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/routes/SignIn.tsx backend/public
git commit -m "feat(web): sign-in + register (persisted key, agent compliance fields)"
```

---

## Task 6: SSE hook + Browse route (live task stream)

**Files:**
- Create: `web/src/lib/sse.ts`
- Modify: `web/src/routes/Browse.tsx`

- [ ] **Step 1: Implement `web/src/lib/sse.ts`** (EventSource wrapper; the market API authenticates SSE via key — pass it as a query param since EventSource can't set headers)

```ts
import { useEffect, useRef, useState } from 'react';
import type { Task } from './types';

// EventSource cannot send Authorization headers, so the key rides as a query
// param. The market's /events accepts the API key; ?type filters by task type.
export function useTaskStream(apiKey: string | null, onNew: (t: Task) => void) {
  const [live, setLive] = useState(false);
  const cb = useRef(onNew);
  cb.current = onNew;
  useEffect(() => {
    if (!apiKey) return;
    let es: EventSource | null = null;
    let stopped = false;
    try {
      es = new EventSource(`/api/v1/events?api_key=${encodeURIComponent(apiKey)}`);
      es.onopen = () => !stopped && setLive(true);
      es.onerror = () => setLive(false); // browser auto-reconnects
      es.addEventListener('task.new', (ev) => {
        try { cb.current(JSON.parse((ev as MessageEvent).data) as Task); } catch { /* ignore */ }
      });
    } catch { setLive(false); }
    return () => { stopped = true; es?.close(); };
  }, [apiKey]);
  return live;
}
```

> Note: this assumes `/api/v1/events` accepts the key via `?api_key=`. The
> implementer MUST confirm against `backend/src/routes/events.ts` — if it only
> reads the `Authorization` header, add a one-line query-param fallback to that
> route (it's a read-only SSE auth check) and note it in the commit. This is the
> single backend touch the plan permits, and only if required.

- [ ] **Step 2: Implement `web/src/routes/Browse.tsx`** (initial fetch + live prepend)

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { useTaskStream } from '../lib/sse';
import { Card, Button, Badge } from '../components/ui';
import type { Task } from '../lib/types';

export function Browse() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const live = useTaskStream(apiKey, (t) => setTasks((prev) => prev.some((x) => x.id === t.id) ? prev : [t, ...prev]));

  useEffect(() => {
    request<{ tasks: Task[] }>('GET', '/tasks?status=open&limit=50', { key: apiKey })
      .then((d) => setTasks(d.tasks)).catch(() => {}).finally(() => setLoading(false));
  }, [apiKey]);

  async function claim(id: string) {
    try { await request('POST', `/tasks/${id}/claim`, { key: apiKey }); toast('Task claimed'); nav('/work'); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Claim failed', 'err'); }
  }

  if (loading) return <p className="text-ink-400">Loading…</p>;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-h1">Open tasks</h1>
        <span className="flex items-center gap-1.5 text-xs text-ink-400">
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-green-500' : 'bg-ink-300'}`} />
          {live ? 'Live' : 'Offline'}
        </span>
      </div>
      {tasks.length === 0 ? <p className="text-ink-400 py-12 text-center">No open tasks right now.</p> : (
        <div className="grid md:grid-cols-2 gap-4">
          {tasks.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h2 className="text-h2">{t.title}</h2>
                <span className="tabular text-brand-700 font-medium">{t.reward_credits}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Badge tone="brand">{t.type}</Badge>
                <Badge>{t.verification?.mode ?? 'manual'}</Badge>
                {t.min_reputation > 0 && <Badge tone="muted">rep ≥ {t.min_reputation}</Badge>}
              </div>
              <p className="text-sm text-ink-600 mb-4 flex-1">{String(t.description).slice(0, 160)}</p>
              <Button onClick={() => claim(t.id)}>Claim &amp; work</Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build to confirm it compiles**

Run: `cd web && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/sse.ts web/src/routes/Browse.tsx backend/public
git commit -m "feat(web): browse open tasks + live SSE stream with status indicator"
```

---

## Task 7: Publish route (all verification modes)

**Files:**
- Modify: `web/src/routes/Publish.tsx`

- [ ] **Step 1: Implement `web/src/routes/Publish.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Field, inputCls } from '../components/ui';
import type { Verification } from '../lib/types';

export function Publish() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('general');
  const [reward, setReward] = useState(100);
  const [minRep, setMinRep] = useState(0);
  const [mode, setMode] = useState<Verification['mode']>('manual');
  const [contains, setContains] = useState('');
  const [lang, setLang] = useState('python');
  const [tests, setTests] = useState('');
  const [rubric, setRubric] = useState('');
  const [threshold, setThreshold] = useState(6);

  async function publish() {
    const verification: Verification = { mode };
    if (mode === 'auto_rules') verification.rules = contains ? [{ type: 'contains', value: contains }] : [];
    else if (mode === 'auto_tests') { verification.language = lang; verification.tests = tests; }
    else if (mode === 'auto_llm') { verification.rubric = rubric; verification.pass_threshold = threshold; }
    try {
      await request('POST', '/tasks', {
        key: apiKey,
        body: { title: title.trim(), description: description.trim(), type, reward_credits: Number(reward), min_reputation: Number(minRep), verification },
      });
      toast('Task published');
      nav('/published');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Publish failed', 'err');
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-h1 mb-1">Publish a task</h1>
      <p className="text-sm text-ink-500 mb-5">Reward credits are escrowed from your balance immediately.</p>
      <Card>
        <Field label="Title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Description"><textarea rows={4} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
              {['general','code','content','data','research','translation'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Reward credits"><input type="number" className={inputCls} value={reward} onChange={(e) => setReward(Number(e.target.value))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min reputation (0–10)"><input type="number" step="0.5" className={inputCls} value={minRep} onChange={(e) => setMinRep(Number(e.target.value))} /></Field>
          <Field label="Verification">
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as Verification['mode'])}>
              <option value="manual">manual (you review)</option>
              <option value="auto_rules">auto_rules (keyword)</option>
              <option value="auto_tests">auto_tests (run tests)</option>
              <option value="auto_llm">auto_llm (LLM grades)</option>
            </select>
          </Field>
        </div>
        {mode === 'auto_rules' && (
          <Field label="Required substring (result must contain)"><input className={inputCls} value={contains} onChange={(e) => setContains(e.target.value)} /></Field>
        )}
        {mode === 'auto_tests' && (
          <>
            <Field label="Language">
              <select className={inputCls} value={lang} onChange={(e) => setLang(e.target.value)}><option>python</option><option>javascript</option></select>
            </Field>
            <Field label="Test code"><textarea rows={4} className={inputCls} value={tests} onChange={(e) => setTests(e.target.value)} /></Field>
          </>
        )}
        {mode === 'auto_llm' && (
          <>
            <Field label="Grading rubric"><textarea rows={3} className={inputCls} value={rubric} onChange={(e) => setRubric(e.target.value)} /></Field>
            <Field label="Pass threshold (0–10)"><input type="number" className={inputCls} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></Field>
          </>
        )}
        <Button className="mt-2" onClick={publish}>Publish task</Button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

Run: `cd web && npm run build`  → PASS
```bash
git add web/src/routes/Publish.tsx backend/public
git commit -m "feat(web): publish task form (all four verification modes)"
```

---

## Task 8: Work + Published routes

**Files:**
- Modify: `web/src/routes/Work.tsx`, `web/src/routes/Published.tsx`

- [ ] **Step 1: Implement `web/src/routes/Work.tsx`** (my executions; submit when in_progress)

```tsx
import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Badge, inputCls } from '../components/ui';
import type { Execution } from '../lib/types';

export function Work() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [execs, setExecs] = useState<Execution[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});

  const load = () => request<Execution[]>('GET', '/tasks/my/executions', { key: apiKey }).then(setExecs).catch(() => {});
  useEffect(() => { load(); }, [apiKey]);

  async function submit(taskId: string) {
    const result = (results[taskId] ?? '').trim();
    if (!result) return toast('Enter your result', 'err');
    try {
      const e = await request<{ auto_verified?: boolean; status?: string }>('POST', `/tasks/${taskId}/submit`, { key: apiKey, body: { result } });
      toast(e.auto_verified ? (e.status === 'accepted' ? 'Auto-accepted — paid' : 'Auto-rejected') : 'Submitted — awaiting review');
      load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Submit failed', 'err'); }
  }

  if (!execs.length) return <p className="text-ink-400 py-12 text-center">No claimed tasks yet. Browse tasks to start.</p>;
  return (
    <div className="space-y-3">
      <h1 className="text-h1 mb-2">My work</h1>
      {execs.map((e) => (
        <Card key={e.id}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <h2 className="text-h2">{e.task_title}</h2>
            <span className="tabular text-brand-700 font-medium">{e.reward_credits}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Badge tone="brand">{e.type}</Badge>
            <Badge>{e.status}</Badge>
            {e.score != null && <Badge tone="muted">score {e.score}</Badge>}
          </div>
          {e.feedback && <p className="text-sm text-ink-500 mb-2">{e.feedback}</p>}
          {e.status === 'in_progress' && (
            <>
              <textarea rows={3} className={inputCls} placeholder="Paste your deliverable"
                value={results[e.task_id] ?? ''} onChange={(ev) => setResults((r) => ({ ...r, [e.task_id]: ev.target.value }))} />
              <Button onClick={() => submit(e.task_id)}>Submit result</Button>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement `web/src/routes/Published.tsx`** (my tasks; review submissions)

```tsx
import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Badge } from '../components/ui';
import type { Task, Execution } from '../lib/types';

export function Published() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subs, setSubs] = useState<Record<string, Execution[]>>({});

  const load = () => request<Task[]>('GET', '/tasks/my/published?limit=50', { key: apiKey }).then(setTasks).catch(() => {});
  useEffect(() => { load(); }, [apiKey]);

  async function loadSubs(taskId: string) {
    try { setSubs((s) => ({ ...s, [taskId]: await request<Execution[]>('GET', `/tasks/${taskId}/submissions`, { key: apiKey }) })); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Load failed', 'err'); }
  }
  async function verify(taskId: string, executionId: string, accepted: boolean) {
    try { await request('POST', `/tasks/${taskId}/verify`, { key: apiKey, body: { execution_id: executionId, accepted } });
      toast(accepted ? 'Accepted — paid' : 'Rejected — refunded'); loadSubs(taskId); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Verify failed', 'err'); }
  }

  if (!tasks.length) return <p className="text-ink-400 py-12 text-center">You haven't published any tasks yet.</p>;
  return (
    <div className="space-y-3">
      <h1 className="text-h1 mb-2">My tasks</h1>
      {tasks.map((t) => (
        <Card key={t.id}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <h2 className="text-h2">{t.title}</h2>
            <span className="tabular text-brand-700 font-medium">{t.reward_credits}</span>
          </div>
          <div className="flex flex-wrap gap-1.5"><Badge tone="brand">{t.type}</Badge><Badge>{t.status}</Badge></div>
          {t.status === 'submitted' && (
            <Button variant="ghost" className="mt-3" onClick={() => loadSubs(t.id)}>Review submissions</Button>
          )}
          {subs[t.id]?.map((s) => (
            <div key={s.id} className="border border-ink-200 rounded-lg p-4 mt-3 bg-ink-50">
              <p className="text-xs text-ink-500 mb-2">by {s.executor_name ?? s.executor_id} · <Badge>{s.status}</Badge></p>
              <pre className="bg-white border border-ink-200 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap mb-3">{s.result}</pre>
              {s.status === 'submitted' && (
                <div className="flex gap-2">
                  <Button onClick={() => verify(t.id, s.id, true)}>Accept</Button>
                  <Button variant="danger" onClick={() => verify(t.id, s.id, false)}>Reject</Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `cd web && npm run build`  → PASS
```bash
git add web/src/routes/Work.tsx web/src/routes/Published.tsx backend/public
git commit -m "feat(web): my-work (submit) + published (review/verify) routes"
```

---

## Task 9: Wallet route (3-state balance, redeem, reputation)

**Files:**
- Modify: `web/src/routes/Wallet.tsx`

- [ ] **Step 1: Implement `web/src/routes/Wallet.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Stat, inputCls } from '../components/ui';
import type { CreditsView, ReputationView } from '../lib/types';

export function Wallet() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [credits, setCredits] = useState<CreditsView | null>(null);
  const [rep, setRep] = useState<ReputationView | null>(null);
  const [amount, setAmount] = useState(0);

  const load = () => {
    request<CreditsView>('GET', '/accounts/me/credits', { key: apiKey }).then(setCredits).catch(() => {});
    request<ReputationView>('GET', '/accounts/me/reputation', { key: apiKey }).then(setRep).catch(() => {});
  };
  useEffect(() => { load(); }, [apiKey]);

  async function redeem() {
    if (amount <= 0) return toast('Enter an amount', 'err');
    try { await request('POST', '/accounts/me/redeem', { key: apiKey, body: { amount } });
      toast('Redeemed'); setAmount(0); load(); }
    catch (e) {
      const msg = e instanceof ApiError
        ? (e.status === 403 ? 'Redemption is not enabled on this server yet' : e.message)
        : 'Redeem failed';
      toast(msg, 'err');
    }
  }

  if (!credits || !rep) return <p className="text-ink-400">Loading…</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-h1">Wallet</h1>
      <Card>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat value={credits.earned} label="Earned (redeemable)" accent />
          <Stat value={credits.gift} label="Gift (publish-only)" />
          <Stat value={credits.frozen_earned} label="Frozen (in review)" />
          <Stat value={Number(rep.score).toFixed(1)} label="Reputation" />
        </div>
      </Card>
      <Card>
        <h2 className="text-h2 mb-1">Redeem earned credits</h2>
        <p className="text-sm text-ink-500 mb-3">Only earned credits are redeemable. Gift and frozen credits never redeem.</p>
        <div className="flex gap-2 items-end">
          <div className="flex-1"><input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(Number(e.target.value))} placeholder="amount" /></div>
          <Button onClick={redeem}>Redeem</Button>
        </div>
      </Card>
      <Card>
        <h2 className="text-h2 mb-4">Credit history</h2>
        <div className="divide-y divide-ink-100">
          {credits.history.length ? credits.history.map((h, i) => (
            <div key={i} className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-ink-700">{h.reason}</span>
              <span className={`tabular font-medium ${h.delta > 0 ? 'text-green-600' : 'text-red-500'}`}>{h.delta > 0 ? '+' : ''}{h.delta}</span>
            </div>
          )) : <p className="text-sm text-ink-400 py-4">No transactions yet.</p>}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

Run: `cd web && npm run build`  → PASS
```bash
git add web/src/routes/Wallet.tsx backend/public
git commit -m "feat(web): wallet — 3-state balance, redeem (handles disabled), history"
```

---

## Task 10: Account route (compute-tier + rotate-key)

**Files:**
- Modify: `web/src/routes/Account.tsx`

- [ ] **Step 1: Implement `web/src/routes/Account.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Stat, Badge } from '../components/ui';
import type { Account as Acct } from '../lib/types';

export function Account() {
  const { apiKey, setApiKey } = useAuth();
  const toast = useToast();
  const [me, setMe] = useState<Acct | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  useEffect(() => {
    request<Acct>('GET', '/accounts/me', { key: apiKey }).then(setMe).catch(() => {});
  }, [apiKey]);

  async function rotate() {
    if (!confirm('Rotate your API key? The current key becomes invalid immediately.')) return;
    try {
      const r = await request<{ api_key: string }>('POST', '/accounts/me/rotate-key', { key: apiKey });
      setNewKey(r.api_key);
      setApiKey(r.api_key); // keep the session working with the new key
      toast('Key rotated — old key is now invalid');
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Rotate failed', 'err'); }
  }

  if (!me) return <p className="text-ink-400">Loading…</p>;
  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-h1">Account</h1>
      <Card>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-400">Name</p>
            <p className="text-ink-900">{me.name} <Badge tone="brand">{me.type}</Badge></p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-400">Compute</p>
            <p className="text-ink-900">
              {me.compute_source ?? '—'}
              {me.compute_tier != null && <Badge tone={me.compute_tier === 1 ? 'ok' : 'neutral'}>Tier {me.compute_tier}</Badge>}
            </p>
          </div>
          <Stat value={me.total_tasks_completed} label="Completed" />
          <Stat value={me.total_tasks_published} label="Published" />
        </div>
      </Card>
      <Card>
        <h2 className="text-h2 mb-1">API key</h2>
        <p className="text-sm text-ink-500 mb-3">Rotating invalidates the current key immediately and issues a new one (shown once).</p>
        <Button variant="ghost" onClick={rotate}>Rotate API key</Button>
        {newKey && (
          <div className="tabular text-xs bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 break-all mt-3">{newKey}</div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

Run: `cd web && npm run build`  → PASS
```bash
git add web/src/routes/Account.tsx backend/public
git commit -m "feat(web): account — compute-source/tier display + rotate-key"
```

---

## Task 11: Admin route (reconcile + risk-flags)

**Files:**
- Modify: `web/src/routes/Admin.tsx`

- [ ] **Step 1: Implement `web/src/routes/Admin.tsx`** (admin token entered locally, sent as `x-admin-token`)

```tsx
import { useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useToast } from '../components/Toaster';
import { Card, Button, Badge, inputCls } from '../components/ui';
import type { RiskFlag } from '../lib/types';

export function Admin() {
  const toast = useToast();
  const [token, setToken] = useState('');
  const [reconcile, setReconcile] = useState<unknown>(null);
  const [flags, setFlags] = useState<RiskFlag[] | null>(null);
  const hdr = () => ({ 'x-admin-token': token });

  async function runReconcile() {
    try { setReconcile(await request('GET', '/admin/reconcile', { headers: hdr() })); }
    catch (e) { toast(adminErr(e), 'err'); }
  }
  async function loadFlags() {
    try { setFlags(await request<RiskFlag[]>('GET', '/admin/risk-flags', { headers: hdr() })); }
    catch (e) { toast(adminErr(e), 'err'); }
  }
  async function act(id: string, action: 'release' | 'confirm') {
    try { await request('POST', `/admin/risk-flags/${id}/${action}`, { headers: hdr() });
      toast(`Flag ${action}ed`); loadFlags(); }
    catch (e) { toast(adminErr(e), 'err'); }
  }
  function adminErr(e: unknown) {
    if (e instanceof ApiError && e.status === 404) return 'Admin is not enabled on this server';
    return e instanceof ApiError ? e.message : 'Request failed';
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-h1">Admin</h1>
      <Card>
        <h2 className="text-h2 mb-1">Admin token</h2>
        <p className="text-sm text-ink-500 mb-3">Required for operator actions. Stored only in this tab.</p>
        <input className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} placeholder="ADMIN_TOKEN" />
      </Card>
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-h2">Ledger reconcile</h2>
          <Button variant="ghost" onClick={runReconcile} disabled={!token}>Run check</Button>
        </div>
        {reconcile != null && (
          <pre className="bg-ink-50 border border-ink-200 rounded-lg p-3 text-xs overflow-x-auto">{JSON.stringify(reconcile, null, 2)}</pre>
        )}
      </Card>
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-h2">Risk flags</h2>
          <Button variant="ghost" onClick={loadFlags} disabled={!token}>Load</Button>
        </div>
        {flags && (flags.length ? (
          <div className="space-y-2">
            {flags.map((f) => (
              <div key={f.id} className="flex items-center justify-between border border-ink-200 rounded-lg p-3">
                <span className="text-sm"><Badge>{f.kind}</Badge> <span className="tabular">{f.amount}</span> <span className="text-ink-400">{f.account_id}</span></span>
                <span className="flex gap-2">
                  <Button onClick={() => act(f.id, 'release')}>Release</Button>
                  <Button variant="danger" onClick={() => act(f.id, 'confirm')}>Confirm</Button>
                </span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-ink-400">No open flags.</p>)}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Confirm the admin header name** — check `backend/src/routes/admin.ts` for how the admin token is read (header name). If it's not `x-admin-token`, update `hdr()` to match. Do not change the backend.

- [ ] **Step 3: Build + commit**

Run: `cd web && npm run build`  → PASS
```bash
git add web/src/routes/Admin.tsx backend/public
git commit -m "feat(web): admin panel — reconcile + risk-flags release/confirm"
```

---

## Task 12: Final verification + designer review

- [ ] **Step 1: Clean build from scratch**

Run: `cd web && rm -rf ../backend/public/* node_modules/.vite && npm run build && ls ../backend/public/index.html ../backend/public/assets`
Expected: build PASS; `index.html` + `assets/` present in `backend/public/`.

- [ ] **Step 2: Run the unit tests**

Run: `cd web && npm run test`
Expected: the api error-mapping tests PASS.

- [ ] **Step 3: Serve via the backend and smoke-test**

Start the backend (`cd backend && DATABASE_URL=<pg> npm run dev`), open `http://localhost:3000`. Verify: sign-in/register works and persists across refresh; browse shows tasks with a live/offline indicator; publish; my-work submit; wallet shows earned/gift/frozen and the redeem-disabled message; account shows compute-tier and rotate-key; admin shows "not enabled" without a valid token. (If no DB handy, at minimum confirm the app shell + sign-in render and routing works.)

- [ ] **Step 4: Confirm backend is otherwise untouched**

Run: `git diff --name-only main...HEAD | grep -E '^backend/' | grep -v '^backend/public/'`
Expected: empty (only `backend/public/` build output changed, unless the SSE query-param fallback in Task 6 was needed — in which case `backend/src/routes/events.ts` also appears, which is expected and documented).

- [ ] **Step 5: Designer review pass**

Dispatch the OMC `designer` agent (read-only review) against the running UI / the component code, checking against the spec's design language: type hierarchy present, gold used sparingly (not every element), no emoji icons, intentional spacing, lists/tables not forced into uniform cards. Apply its concrete fixes, rebuild, commit:
```bash
git add web/src backend/public
git commit -m "style(web): designer-review polish pass"
```

- [ ] **Step 6: Remove the obsolete vanilla source note**

The old `backend/public/app.js` + hand-written `index.html` are replaced by the build output. Confirm they're gone from `backend/public/` (the Vite build with `emptyOutDir` removes them). No separate deletion commit needed.

---

## Self-Review (against the spec)

**Spec coverage:**
- Vite + React SPA, static build into `backend/public/` → Task 1 (scaffold + outDir), Task 12 (clean build). ✓
- Modern-SaaS aesthetic, gold accent, no emoji, type hierarchy → Task 2 (tokens), Task 4 (ui primitives + lucide nav), Task 12 Step 5 (designer review). ✓
- Wallet: redeem + earned/gift/frozen + reputation history → Task 9. ✓
- Account: rotate-key + compute_source/tier → Task 10. ✓
- Live SSE task stream → Task 6 (sse hook + Browse). ✓
- Admin panel: reconcile + risk-flags release/confirm → Task 11. ✓
- API key persists in localStorage → Task 3 (auth.tsx). ✓
- Served by Fastify unchanged, no SSR → hash router (Task 4) + outDir to public (Task 1); backend-untouched check Task 12 Step 4. ✓
- All publish verification modes → Task 7. ✓
- Browse/Work/Published parity with current UI → Tasks 6/8. ✓

**Placeholder scan:** No TBD/TODO. Two explicit verification steps (Task 6 Step 1 note on the SSE auth param; Task 11 Step 2 on the admin header name) are real "confirm against the backend route" checks with the exact file to read — not placeholders. Stub route files (Task 4 Step 4) are intentional scaffolding, each replaced by a named later task.

**Consistency:** Names line up across tasks — `request`/`ApiError` (api.ts) used everywhere; `useAuth`/`apiKey`/`setApiKey` (auth.tsx); `useToast`; `useTaskStream` (sse.ts); ui primitives `Button`/`Card`/`Stat`/`Badge`/`Field`/`inputCls`; route export names match the imports in `App.tsx`. Types (`Account`, `Task`, `Execution`, `CreditsView`, `ReputationView`, `RiskFlag`) defined in Task 3 and consumed in Tasks 5–11. ✓

**Backend touch:** Only `backend/public/` (build output, committed for the Dockerfile copy). The single conditional exception — an SSE query-param auth fallback in `backend/src/routes/events.ts` — is gated on a verification step and only if EventSource can't authenticate otherwise. Flagged, not silent.
