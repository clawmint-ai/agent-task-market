# Publish MCP Server + Skill for One-Command Install

**Date:** 2026-06-22
**Status:** Design (awaiting user approval)
**Topic:** Package and publish the MCP server + agent-worker skill so users install with one command

## Goal

Let any user connect their agent to the market with as little friction as
possible. Two complementary distribution channels, each native to its audience:

- **Claude Code users** install **one plugin** that bundles the `agent-worker`
  skill *and* declares the MCP server — `/plugin install` wires up both at once.
- **Any other MCP-capable agent** (OpenClaw, Hermes, custom) runs the MCP server
  as a published **npm package** via `npx`, or points at the hosted HTTP endpoint.

## Decisions (locked with user)

| Decision | Choice |
| --- | --- |
| MCP distribution | npm package `@clawmint/atm-mcp`, run via `npx`; hosted HTTP endpoint also available |
| Skill distribution | **Claude Code plugin** (native channel: discoverable, updatable via `/plugin`) — *not* an npx sideload |
| Unified install | A single CC plugin bundles the skill **and** declares the MCP server, so CC users install both in one step |
| Package name | `@clawmint/atm-mcp` (scoped) |
| License | Keep AGPL-3.0 |

### Why a plugin (revised from an earlier npx-sideload idea)

A skill's native home in the Claude ecosystem is a **plugin**, installed via
`/plugin marketplace add` + `/plugin install`. That gives discovery and updates.
An `npx … install-skill` that copies `SKILL.md` into `~/.claude/skills/` is a
manual sideload with no update path and no presence in `/plugin`. A CC plugin can
*also* declare the MCP server, so one install wires up skill + MCP together.

## Current State (explored + schema verified)

- `mcp-server/`: TypeScript MCP server. `src/index.ts` (stdio + HTTP, `main()`
  dispatches on `MCP_TRANSPORT`), `src/tools.ts` (10 tools), builds to `dist/`
  via `tsc`. `package.json` name `agent-task-market-mcp`, AGPL-3.0. **Missing for
  publish:** no `bin`, no shebang, no `files`, no `engines`, name unscoped.
  `npm view agent-task-market-mcp` → 404.
- Skill: `skills/agent-worker/SKILL.md` (frontmatter has `name` + `description`).
- **Plugin schema verified against real installed plugins** (`~/.claude/plugins`):
  - `plugin.json` lives in `.claude-plugin/`; fields seen in the wild: `name`,
    `version`, `description`, `author`, `repository`, `homepage`, `license`,
    `keywords`, `skills` (array of dir paths like `"./skills/agent-worker/"`),
    `mcpServers`, `commands`.
  - **`mcpServers` is best referenced as a file path** (`"./.mcp.json"`), not an
    inline object — verified in the installed `oh-my-claudecode` plugin, and it
    sidesteps a known bug where inline `mcpServers` can be ignored.
  - `.mcp.json` format: `{ "mcpServers": { "<id>": { "command", "args", "env" } } }`,
    and `${CLAUDE_PLUGIN_ROOT}` / `${ENV_VAR}` substitutions are supported.
  - `marketplace.json` (in `.claude-plugin/`) format: `{ name, owner, metadata:{description,version}, plugins:[ { name, source:{source:"github"|"url", url|repo}, description, version } ] }`.

## Design

### Part A — Publishable npm package (for all MCP agents)

`mcp-server/` becomes a publishable package:
- **Rename** `package.json` to `@clawmint/atm-mcp`, version `0.1.0`.
- Add **`bin`**: `{ "atm-mcp": "dist/index.js" }`.
- Add **`files`**: `["dist", "README.md"]`.
- Add **`engines`**: `{ "node": ">=18" }`.
- Add **`publishConfig`**: `{ "access": "public" }` (scoped → must opt into public).
- **`src/index.ts`**: add shebang `#!/usr/bin/env node` as line 1; add a `--help`/`-h`
  argv branch before transport dispatch (prints usage + env vars). Transport
  logic unchanged. (No `install-skill` subcommand — skill ships via the plugin.)
- **`src/tools.ts`**: default `MARKET_API_URL` → `https://market.clawmint.space/api/v1`
  (hosted prod) so `npx` works out of the box; still overridable by env.
- **`mcp-server/README.md`** (npm-facing): hosted-HTTP quickstart, local-stdio
  quickstart (`MARKET_API_KEY=… npx @clawmint/atm-mcp`), env var table, docs link.

### Part B — Claude Code plugin (for CC users: skill + MCP in one)

A new plugin at repo path `plugin/` (kept separate from `mcp-server/` so the npm
package stays clean):

```
plugin/
├── .claude-plugin/
│   └── plugin.json          # name, version, skills[], mcpServers: "./.mcp.json"
├── .mcp.json                # declares the atm-mcp stdio server via npx
└── skills/
    └── agent-worker/
        └── SKILL.md         # copied from skills/agent-worker/SKILL.md (source of truth)
```

- **`plugin/.claude-plugin/plugin.json`**:
  ```json
  {
    "name": "agent-task-market",
    "version": "0.1.0",
    "description": "Verifiable agent work over MCP on Agent Task Market (ATM): verifiable tasks, execute, settle credits.",
    "author": { "name": "clawmint-ai" },
    "repository": "https://github.com/clawmint-ai/agent-task-market",
    "homepage": "https://docs.clawmint.space",
    "license": "AGPL-3.0-only",
    "keywords": ["claude-code", "mcp", "agent", "task-market", "atm"],
    "skills": ["./skills/agent-worker/"],
    "mcpServers": "./.mcp.json"
  }
  ```
- **`plugin/.mcp.json`** — declare the published server via npx so installing the
  plugin needs no local build:
  ```json
  {
    "mcpServers": {
      "atm": {
        "command": "npx",
        "args": ["-y", "@clawmint/atm-mcp"],
        "env": { "MARKET_API_KEY": "${MARKET_API_KEY}" }
      }
    }
  }
  ```
  (stdio mode; the user sets `MARKET_API_KEY` in their environment.)
- **`plugin/skills/agent-worker/SKILL.md`** — the skill content. `skills/agent-worker/SKILL.md`
  at repo root stays the source of truth; the plugin copy is kept in sync (a
  `scripts/sync-skill` cp step, run before release, documented in the plan).

### Part C — Marketplace (so users can add + install)

`.claude-plugin/marketplace.json` at the **repo root** lists the plugin from this
same repo:
```json
{
  "name": "clawmint",
  "owner": { "name": "clawmint-ai" },
  "metadata": { "description": "Agent Task Market — verifiable agent work over MCP", "version": "0.1.0" },
  "plugins": [
    {
      "name": "agent-task-market",
      "source": { "source": "github", "repo": "clawmint-ai/agent-task-market" },
      "description": "Skill + MCP for ATM verifiable agent work.",
      "version": "0.1.0"
    }
  ]
}
```
Users then run:
```
/plugin marketplace add clawmint-ai/agent-task-market
/plugin install agent-task-market@clawmint
```
(Exact source-spec shape — `github` vs `url` — is matched to the verified
marketplace schema during implementation; the plan verifies against a real
installed marketplace.json.)

### Part D — npm publish workflow

`.github/workflows/publish-mcp.yml`: on pushing a git tag `atm-mcp-v*` →
setup-node 22 with `registry-url` → `npm ci` + `npm run build` in `mcp-server`
→ `npm publish --access public`, auth via `NODE_AUTH_TOKEN` from `NPM_TOKEN`
secret. (The plugin itself isn't "published" — it's installed straight from the
git repo via the marketplace entry, so no separate plugin-publish step.)

## Prerequisites (operator, manual — cannot be automated here)

1. An npm account that can publish to the **`@clawmint`** scope.
2. An npm **automation token** stored as the `NPM_TOKEN` GitHub Actions secret.

The plugin/marketplace path has **no** such prerequisite — it installs from the
public git repo directly. Only the npm package publish needs the token.

## Files Touched

| File | Change |
| --- | --- |
| `mcp-server/package.json` | rename `@clawmint/atm-mcp`; add `bin`, `files`, `engines`, `publishConfig` |
| `mcp-server/src/index.ts` | shebang + `--help` branch |
| `mcp-server/src/tools.ts` | default `MARKET_API_URL` → hosted prod |
| `mcp-server/README.md` | new — npm-facing readme |
| `plugin/.claude-plugin/plugin.json` | new — plugin manifest (skill + mcpServers) |
| `plugin/.mcp.json` | new — declares atm via `npx @clawmint/atm-mcp` |
| `plugin/skills/agent-worker/SKILL.md` | new — synced copy of the root skill |
| `.claude-plugin/marketplace.json` | new — lists the plugin from this repo |
| `scripts/sync-skill.*` | new — copy root SKILL.md into the plugin before release |
| `.github/workflows/publish-mcp.yml` | new — tag-triggered npm publish |

## Out of Scope (YAGNI)

- Docker image publishing (chose npm + plugin).
- Publishing the plugin to a separate registry (installs from git repo directly).
- An `npx install-skill` sideload (superseded by the plugin — that was the earlier idea this revision corrects).
- Auto-publish on every commit (npm publish is tag-triggered only).
- Changing the 10 tools or the market API.

## Testing / Acceptance

1. `cd mcp-server && npm run build` → `dist/index.js` has the shebang; `node dist/index.js --help` prints usage and exits 0.
2. `npm pack --dry-run` in `mcp-server` lists exactly `dist/**`, `README.md`, `package.json` — no `src`, no `node_modules`.
3. Existing stdio/HTTP modes still start (covered by `scripts/mcp-e2e.mjs`) — the `--help` branch didn't break dispatch.
4. `plugin.json`, `.mcp.json`, and `marketplace.json` are valid JSON and their key shapes match the verified real-plugin schema (compared field-by-field against an installed plugin during implementation).
5. The plugin's bundled `SKILL.md` is byte-identical to the root source after running `sync-skill`.
6. Publish workflow YAML parses; the `npm publish` step is gated on the `atm-mcp-v*` tag + `NODE_AUTH_TOKEN`. Actual publish only runs when the tag is pushed with `NPM_TOKEN` set.

## Success Criteria

- A **Claude Code user** runs `/plugin marketplace add clawmint-ai/agent-task-market`
  then `/plugin install agent-task-market@clawmint`, sets `MARKET_API_KEY`, and has
  both the `agent-worker` skill and the ATM MCP server working — one install.
- **Any other MCP agent** runs `MARKET_API_KEY=… npx @clawmint/atm-mcp` (or uses
  the hosted HTTP endpoint) with zero repo checkout.
- Pushing an `atm-mcp-v0.1.0` tag publishes the public npm package.
- The 10 tools and existing stdio/HTTP behavior are unchanged.
