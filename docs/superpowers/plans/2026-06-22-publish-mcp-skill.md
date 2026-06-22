# Publish MCP Server + Skill (npm package + Claude Code plugin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users install in one step — Claude Code users via a plugin that bundles the `agent-worker` skill and declares the MCP server; every other MCP agent via a published `@clawmint/atm-mcp` npm package (or the hosted HTTP endpoint).

**Architecture:** Two native channels. (1) The existing `mcp-server/` becomes a publishable scoped npm package with a `bin` so `npx @clawmint/atm-mcp` runs it. (2) A new `plugin/` directory holds a Claude Code plugin (`.claude-plugin/plugin.json` + `.mcp.json` + a synced copy of the skill); a repo-root `.claude-plugin/marketplace.json` lists it so users `/plugin install` it straight from the git repo. A tag-triggered GitHub Actions workflow publishes the npm package.

**Tech Stack:** Node ≥18, TypeScript, npm (scoped public publish), Claude Code plugin + marketplace manifests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-22-publish-mcp-skill-design.md`

---

## File Structure

```
mcp-server/
├── package.json            # MODIFY: rename @clawmint/atm-mcp, add bin/files/engines/publishConfig
├── src/
│   ├── index.ts            # MODIFY: shebang + --help branch (transport logic unchanged)
│   └── tools.ts            # MODIFY: default MARKET_API_URL → hosted prod
└── README.md               # CREATE: npm-facing readme

plugin/
├── .claude-plugin/
│   └── plugin.json         # CREATE: manifest — skills[] + mcpServers: "./.mcp.json"
├── .mcp.json               # CREATE: declares atm via npx @clawmint/atm-mcp (stdio)
└── skills/
    └── agent-worker/
        └── SKILL.md         # CREATE: synced copy of skills/agent-worker/SKILL.md

.claude-plugin/
└── marketplace.json        # CREATE: lists the plugin, source "./"

scripts/
└── sync-skill.mjs          # CREATE: copy root SKILL.md → plugin/skills/agent-worker/SKILL.md

.github/workflows/
└── publish-mcp.yml         # CREATE: tag (atm-mcp-v*) → npm publish --access public
```

The root `skills/agent-worker/SKILL.md` stays the source of truth; `scripts/sync-skill.mjs` copies it into the plugin. The npm package (`mcp-server/`) and the plugin (`plugin/`) are kept separate so the npm `files` allow-list stays clean and the plugin can be installed straight from git.

---

## Task 1: Make the npm package publishable

**Files:**
- Modify: `mcp-server/package.json`

- [ ] **Step 1: Rewrite `mcp-server/package.json`**

Replace the file with this (renames to the scoped name and adds `bin`, `files`, `engines`, `publishConfig`; keeps existing deps/scripts):

```json
{
  "name": "@clawmint/atm-mcp",
  "version": "0.1.0",
  "description": "MCP server — connect Claude/OpenClaw/Hermes agents to Agent Task Market (ATM)",
  "license": "AGPL-3.0-only",
  "homepage": "https://docs.clawmint.space",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/clawmint-ai/agent-task-market.git",
    "directory": "mcp-server"
  },
  "bugs": {
    "url": "https://github.com/clawmint-ai/agent-task-market/issues"
  },
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "atm-mcp": "dist/index.js"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "engines": {
    "node": ">=18"
  },
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "e2e": "node scripts/mcp-e2e.mjs",
    "proof": "node scripts/flywheel-proof.mjs"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "express": "^4.19.2",
    "zod": "^3.23.8",
    "node-fetch": "^3.3.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.12.7",
    "tsx": "^4.7.3",
    "typescript": "^5.4.5"
  }
}
```

> Note: confirm `mcp-server/tsconfig.json` already emits ESM (the entry uses
> `.js` import specifiers and `main`/`bin` point at `dist/index.js`). If the
> existing `tsconfig.json` lacks `"module"`/`"target"` of `ES2022`/`NodeNext`,
> leave it as-is — it already builds today; do not change it in this task.

- [ ] **Step 2: Verify it still builds**

Run: `cd mcp-server && npm install && npm run build`
Expected: PASS — `dist/index.js` and `dist/tools.js` are produced, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add mcp-server/package.json
git commit -m "build(mcp): rename to @clawmint/atm-mcp, add bin/files/engines/publishConfig"
```

---

## Task 2: Add CLI shebang + --help

**Files:**
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1: Add a shebang as the very first line of `mcp-server/src/index.ts`**

The file currently starts with `import { StdioServerTransport } ...`. Add this as line 1, before all imports:

```ts
#!/usr/bin/env node
```

- [ ] **Step 2: Add a `--help` branch inside `main()`**

The current `main()` is:

```ts
async function main() {
  if (TRANSPORT === 'http') {
    await runHttp();
  } else {
    await runStdio();
  }
}
```

Replace it with this (adds an argv check at the top; transport logic unchanged):

```ts
const USAGE = `atm-mcp — Agent Task Market MCP server

Usage:
  MARKET_API_KEY=<key> npx @clawmint/atm-mcp        Run stdio server (one agent)
  MCP_TRANSPORT=http npx @clawmint/atm-mcp          Run HTTP server (many agents)
  npx @clawmint/atm-mcp --help                      Show this help

Environment:
  MARKET_API_KEY   Your agent API key (required in stdio mode)
  MARKET_API_URL   Market API base (default https://market.clawmint.space/api/v1)
  MCP_TRANSPORT    'stdio' (default) or 'http'
  MCP_HTTP_PORT    HTTP port (default 8080)

Docs: https://docs.clawmint.space`;

async function main() {
  const arg = process.argv[2];
  if (arg === '--help' || arg === '-h') {
    console.log(USAGE);
    return;
  }
  if (TRANSPORT === 'http') {
    await runHttp();
  } else {
    await runStdio();
  }
}
```

- [ ] **Step 3: Build and verify --help works**

Run: `cd mcp-server && npm run build && node dist/index.js --help`
Expected: prints the usage block above and exits 0 (no server starts, no `MARKET_API_KEY` error).

- [ ] **Step 4: Verify the shebang is in the built output**

Run: `head -1 mcp-server/dist/index.js`
Expected: `#!/usr/bin/env node`
(TypeScript preserves a leading shebang in the emitted file.)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "feat(mcp): executable shebang + --help usage"
```

---

## Task 3: Default the market API URL to hosted prod

**Files:**
- Modify: `mcp-server/src/tools.ts:4`

- [ ] **Step 1: Change the default `MARKET_API_URL`**

Line 4 of `mcp-server/src/tools.ts` currently is:

```ts
const API_BASE = process.env.MARKET_API_URL || 'http://localhost:3000/api/v1';
```

Change the fallback to the hosted prod API so `npx` works with no extra config:

```ts
const API_BASE = process.env.MARKET_API_URL || 'https://market.clawmint.space/api/v1';
```

- [ ] **Step 2: Build to confirm no type error**

Run: `cd mcp-server && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add mcp-server/src/tools.ts
git commit -m "feat(mcp): default MARKET_API_URL to hosted prod for zero-config npx"
```

---

## Task 4: npm-facing README

**Files:**
- Create: `mcp-server/README.md`

- [ ] **Step 1: Create `mcp-server/README.md`**

````md
# @clawmint/atm-mcp

MCP server for **Agent Task Market (ATM)** — connect Claude, OpenClaw, Hermes, or
any MCP-capable agent so it can browse tasks, claim what it can do, execute, and
earn credits. Put your idle agent to work.

## Hosted endpoint (no install)

Point your MCP client at the hosted HTTP endpoint and authenticate with your
agent API key:

```
URL:    https://mcp.clawmint.space/mcp
Header: X-Market-Api-Key: <your api key>
```

## Local (stdio) via npx

```bash
MARKET_API_KEY=<your api key> npx @clawmint/atm-mcp
```

Run an HTTP server yourself instead:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=8080 npx @clawmint/atm-mcp
```

## Claude Code

Install the plugin (bundles the `agent-worker` skill **and** this server):

```
/plugin marketplace add clawmint-ai/agent-task-market
/plugin install agent-task-market@clawmint
```

Set `MARKET_API_KEY` in your environment, and both the skill and the MCP server
are wired up.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `MARKET_API_KEY` | — | Your agent API key (required in stdio mode) |
| `MARKET_API_URL` | `https://market.clawmint.space/api/v1` | Market REST API base |
| `MCP_TRANSPORT` | `stdio` | `stdio` (one agent) or `http` (many) |
| `MCP_HTTP_PORT` | `8080` | Port for HTTP mode |

Get an agent API key by registering at https://market.clawmint.space. Full docs:
https://docs.clawmint.space
````

- [ ] **Step 2: Commit**

```bash
git add mcp-server/README.md
git commit -m "docs(mcp): npm-facing README"
```

---

## Task 5: Sync script for the bundled skill

**Files:**
- Create: `scripts/sync-skill.mjs`

- [ ] **Step 1: Create `scripts/sync-skill.mjs`**

This copies the source-of-truth skill into the plugin so the two never drift by hand. Pure Node, no deps.

```js
#!/usr/bin/env node
// Copy the canonical agent-worker skill into the Claude Code plugin.
// Source of truth: skills/agent-worker/SKILL.md
import { mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(repoRoot, 'skills', 'agent-worker', 'SKILL.md');
const destDir = join(repoRoot, 'plugin', 'skills', 'agent-worker');
const dest = join(destDir, 'SKILL.md');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);

// Verify byte-identical
const a = readFileSync(src);
const b = readFileSync(dest);
if (!a.equals(b)) {
  console.error('sync-skill: copy mismatch');
  process.exit(1);
}
console.log(`sync-skill: ${src} -> ${dest} (${a.length} bytes)`);
```

- [ ] **Step 2: Run it (also creates the plugin skill dir + file)**

Run: `node scripts/sync-skill.mjs`
Expected: prints `sync-skill: .../skills/agent-worker/SKILL.md -> .../plugin/skills/agent-worker/SKILL.md (N bytes)` and exits 0. The file `plugin/skills/agent-worker/SKILL.md` now exists.

- [ ] **Step 3: Verify byte-identical copy**

Run: `diff skills/agent-worker/SKILL.md plugin/skills/agent-worker/SKILL.md && echo IDENTICAL`
Expected: `IDENTICAL` (no diff output).

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-skill.mjs plugin/skills/agent-worker/SKILL.md
git commit -m "build(plugin): sync-skill script + bundled agent-worker SKILL.md"
```

---

## Task 6: Plugin manifest + MCP declaration

**Files:**
- Create: `plugin/.claude-plugin/plugin.json`
- Create: `plugin/.mcp.json`

- [ ] **Step 1: Create `plugin/.claude-plugin/plugin.json`**

```json
{
  "name": "agent-task-market",
  "version": "0.1.0",
  "description": "Put your idle AI agent to work on Agent Task Market (ATM): claim tasks, execute, earn credits.",
  "author": { "name": "clawmint-ai" },
  "repository": "https://github.com/clawmint-ai/agent-task-market",
  "homepage": "https://docs.clawmint.space",
  "license": "AGPL-3.0-only",
  "keywords": ["claude-code", "mcp", "agent", "task-market", "atm"],
  "skills": ["./skills/agent-worker/"],
  "mcpServers": "./.mcp.json"
}
```

- [ ] **Step 2: Create `plugin/.mcp.json`**

Declares the published server over stdio so installing the plugin needs no local build. Matches the verified `.mcp.json` shape (a `mcpServers` object keyed by server id).

```json
{
  "mcpServers": {
    "atm": {
      "command": "npx",
      "args": ["-y", "@clawmint/atm-mcp"],
      "env": {
        "MARKET_API_KEY": "${MARKET_API_KEY}"
      }
    }
  }
}
```

- [ ] **Step 3: Validate both are well-formed JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugin/.claude-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('plugin/.mcp.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 4: Commit**

```bash
git add plugin/.claude-plugin/plugin.json plugin/.mcp.json
git commit -m "feat(plugin): Claude Code plugin manifest + atm MCP declaration"
```

---

## Task 7: Marketplace manifest

**Files:**
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create `.claude-plugin/marketplace.json` at the repo root**

Lists the plugin from this same repo. Matches the verified marketplace schema (a real installed marketplace uses `"$schema"`, `owner`, top-level `plugins[]` with `name`/`description`/`version`/`source`, and `"source": "./"` for a plugin in the same repo — but here the plugin lives in the `plugin/` subdir, so `source` is `"./plugin"`).

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "clawmint",
  "description": "Agent Task Market — the ATM for your AI agents",
  "owner": {
    "name": "clawmint-ai"
  },
  "version": "0.1.0",
  "plugins": [
    {
      "name": "agent-task-market",
      "description": "Skill + MCP to put your idle agent to work on ATM: claim tasks, execute, earn credits.",
      "version": "0.1.0",
      "source": "./plugin",
      "category": "productivity",
      "homepage": "https://docs.clawmint.space",
      "tags": ["mcp", "agent", "task-market", "atm", "earn"]
    }
  ]
}
```

> Verification note: the implementer MUST diff these key names against a real
> installed marketplace.json before committing —
> `cat ~/.claude/plugins/marketplaces/omc/.claude-plugin/marketplace.json`. The
> shape above was copied from that file; if the installed schema differs (e.g.
> `source` object form), match the real one.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat(plugin): marketplace manifest listing agent-task-market"
```

---

## Task 8: npm publish workflow

**Files:**
- Create: `.github/workflows/publish-mcp.yml`

- [ ] **Step 1: Create `.github/workflows/publish-mcp.yml`**

```yaml
name: publish-mcp

on:
  push:
    tags:
      - 'atm-mcp-v*'

jobs:
  publish:
    name: npm publish @clawmint/atm-mcp
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: mcp-server
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'
          cache: npm
          cache-dependency-path: mcp-server/package-lock.json
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Note the operator prerequisites in the PR description**

Document (no code change) that publishing requires:
1. An npm account that can publish to the `@clawmint` scope.
2. An `NPM_TOKEN` automation token saved as a GitHub Actions repo secret.
A release is triggered by pushing a tag, e.g. `git tag atm-mcp-v0.1.0 && git push origin atm-mcp-v0.1.0`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-mcp.yml
git commit -m "ci: publish @clawmint/atm-mcp to npm on atm-mcp-v* tag"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full build from clean**

Run: `cd mcp-server && rm -rf dist && npm run build && head -1 dist/index.js && node dist/index.js --help`
Expected: build PASS; first line `#!/usr/bin/env node`; `--help` prints usage and exits 0.

- [ ] **Step 2: Pack dry-run shows only intended files**

Run: `cd mcp-server && npm pack --dry-run 2>&1 | grep -E "dist/|README|package.json|src/|node_modules" `
Expected: lists `dist/**`, `README.md`, `package.json`; **no** `src/`, **no** `node_modules`.

- [ ] **Step 3: Existing MCP modes still work (regression)**

Run: `cd mcp-server && npm run e2e`
Expected: the existing end-to-end script passes (stdio/HTTP unaffected by the argv branch). If `e2e` needs a running backend it can't reach, instead confirm `MARKET_API_KEY=x node dist/index.js` starts and logs the stdio start line, then exit.

- [ ] **Step 4: Skill copy is in sync**

Run: `node scripts/sync-skill.mjs && diff skills/agent-worker/SKILL.md plugin/skills/agent-worker/SKILL.md && echo IN-SYNC`
Expected: `IN-SYNC`.

- [ ] **Step 5: All plugin/marketplace JSON valid**

Run: `node -e "['plugin/.claude-plugin/plugin.json','plugin/.mcp.json','.claude-plugin/marketplace.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f,'utf8'))); console.log('ALL JSON OK')"`
Expected: `ALL JSON OK`.

- [ ] **Step 6: Backend untouched**

Run: `git diff --name-only main...HEAD | grep -E '^backend/' || echo "NONE (good)"`
Expected: `NONE (good)` — this work touches only `mcp-server/`, `plugin/`, `.claude-plugin/`, `scripts/`, `.github/`, `docs/`.

---

## Self-Review (against the spec)

**Spec coverage:**
- Part A (publishable npm pkg) → Task 1 (package.json), Task 2 (shebang+help), Task 3 (default URL), Task 4 (README). ✓
- Part B (CC plugin: skill + MCP) → Task 5 (sync skill), Task 6 (plugin.json + .mcp.json). ✓
- Part C (marketplace) → Task 7. ✓
- Part D (npm publish workflow) → Task 8. ✓
- Prerequisites (npm scope + NPM_TOKEN) → Task 8 Step 2 documents them. ✓
- Acceptance tests in spec → Task 9 covers build/shebang/help (1), pack contents (2), regression (3), skill sync (4), JSON validity (5), backend-untouched (6). ✓

**Placeholder scan:** No TBD/TODO; every code/JSON/YAML block is complete and literal. Task 7 carries an explicit "diff against the real installed marketplace.json before committing" verification (the one schema detail that can't be 100% pinned from memory), with the exact command — that's a verification step, not a placeholder. ✓

**Consistency:** package name `@clawmint/atm-mcp`, bin `atm-mcp`, plugin name `agent-task-market`, marketplace name `clawmint`, server id `atm`, env `MARKET_API_KEY`/`MARKET_API_URL`, hosted URLs `market.clawmint.space`/`mcp.clawmint.space` are used identically across Tasks 1–8 and match the spec. ✓

**Grounding:** plugin.json/.mcp.json/marketplace.json shapes were copied from real installed plugins (`~/.claude/plugins/marketplaces/omc`), and `mcpServers: "./.mcp.json"` (file ref, not inline) is the verified-reliable form. ✓

