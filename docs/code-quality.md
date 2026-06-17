# Code quality & PR hardening

The checks that guard `main`, beyond the build/test CI in
[branch-protection.md](branch-protection.md). All are open-source and free for
this public repo — no paid SaaS, no per-seat cost.

## What runs on every PR

| Layer            | Tool            | Workflow         | Free? | Gate |
|------------------|-----------------|------------------|-------|------|
| Build + tests    | tsc / node test | `ci.yml`         | yes   | required |
| Semantic SAST    | CodeQL          | `codeql.yml`     | yes (public) | required |
| Secret scan      | gitleaks (CLI)  | `security.yml`   | yes   | required |
| Quality gate     | SonarCloud      | `sonarcloud.yml` | yes (public) | opt-in |
| Local pre-commit | `.githooks`     | —                | yes   | advisory |

CodeOwners (`.github/CODEOWNERS`) additionally routes review of money/untrusted
paths (`backend/src/domain/`, `backend/src/services/task/`, `sandbox.ts`) to a
maintainer once the TEAM preset is enabled.

## CodeQL

Semantic security + quality analysis for JS/TS. Runs on PR, push to `main`, and
a weekly cron (catches newly-disclosed query patterns on unchanged code).
Findings land in **Security → Code scanning**. No setup — it works out of the
box on public repos. Make `CodeQL (javascript-typescript)` a required check.

## gitleaks

Blocks secrets from entering history. Runs the gitleaks CLI directly (the
official action needs a paid license for org-owned repos). Config lives in
[`.gitleaks.toml`](../.gitleaks.toml): it extends the default ruleset and
allowlists the placeholder values in `*.env.example`.

Run it locally:

```bash
brew install gitleaks            # or: go install github.com/gitleaks/gitleaks/v8@latest
gitleaks detect --config .gitleaks.toml --redact
```

## Local pre-commit hook

Zero-dependency, shared through git. Enable once per clone:

```bash
git config core.hooksPath .githooks
```

On each commit it (1) scans the staged diff for secrets — using gitleaks if
installed, else a regex fallback — and (2) runs `tsc --noEmit` for whichever of
`backend` / `mcp-server` the commit touched. Bypass in an emergency with
`git commit --no-verify`. It's advisory: CI is the real gate, the hook just
gives you the answer seconds earlier.

## SonarCloud (opt-in)

Quality gate: bugs, code smells, duplication, coverage, security hotspots. Free
for public repos but needs a one-time account link, so it stays **inert** until
you turn it on. The workflow's `if: vars.ENABLE_SONAR == 'true'` guard means it
is skipped (not failed) until then.

To enable:

1. Sign in at <https://sonarcloud.io> with the `clawmint-ai` GitHub org and
   import `agent-task-market`. Set the Quality Gate to "Sonar way".
2. Add repo **secret** `SONAR_TOKEN` (from SonarCloud → My Account → Security).
3. Add repo **variable** `ENABLE_SONAR` = `true`.
4. After it runs once on a PR, add `SonarCloud (quality gate)` as a required
   check in branch protection.

Project config lives in [`sonar-project.properties`](../sonar-project.properties).

## Not adopted (and why)

- **CodeRabbit / PR-Agent (AI review)** — overlaps the local Claude
  `code-reviewer`/`security-reviewer` pass already in use, and adds noise on a
  single-maintainer repo. Revisit when the team grows or PR-level audit trails
  are needed.
- **ESLint/Biome as a blocking gate** — not wired in yet; would require fixing
  existing violations first. CodeQL's `security-and-quality` queries cover much
  of the same ground today. A good follow-up.

