# Branch protection & merge gate

How `main` is protected and how PRs are gated. The CI workflow
(`.github/workflows/ci.yml`) already runs on every PR — this doc makes those
checks **required to merge** and locks down direct pushes.

These rules can't be set from this repo's tooling sandbox (no `gh`, no network
to GitHub). Run the commands below from your own machine, or click through the
GitHub UI equivalents in [§ UI path](#ui-path).

---

## Required status checks — exact names

Branch protection matches checks by the job's **display name** (`name:` in the
workflow), not the job id. They must be copied verbatim:

| Job id        | Required check name (verbatim)    | Workflow        |
|---------------|-----------------------------------|-----------------|
| `backend`     | `backend (typecheck + tests)`     | `ci.yml`        |
| `mcp-server`  | `mcp-server (typecheck + build)`  | `ci.yml`        |
| `docker`      | `docker compose (config + build)` | `ci.yml`        |
| `analyze`     | `CodeQL (javascript-typescript)`  | `codeql.yml`    |
| `gitleaks`    | `gitleaks (secret scan)`          | `security.yml`  |

If you rename a job, you must update the protection rule too, or the gate
silently stops requiring that job.

`SonarCloud (quality gate)` (`sonarcloud.yml`) is intentionally **not** in this
table: it only runs when you opt in (repo variable `ENABLE_SONAR=true`). Add it
as a required check after enabling it — see [docs/code-quality.md](code-quality.md).

---

## Pick a preset

This repo is currently single-maintainer. **GitHub does not let you approve your
own PR**, so a rule that requires approvals will lock you out of merging your own
work. Choose accordingly:

- **SOLO** — enforce PR + green CI + up-to-date branch + no force-push/delete +
  conversations resolved, but **no required approvals**. You can still merge your
  own PRs. Use this now.
- **TEAM** — SOLO plus: require ≥1 approving review, require Code Owner review
  (activates `.github/CODEOWNERS`), and dismiss stale approvals on new commits.
  Switch to this once a second maintainer exists.

---

## Apply with `gh` (recommended)

Prereq: `gh auth login` once, and `REPO=clawmint-ai/agent-task-market`.

### One command (preferred)

[`scripts/branch-protection.sh`](../scripts/branch-protection.sh) is the
executable source of truth — the check list lives there once, so it can't drift
from the raw `gh api` blocks below. It is idempotent (re-running `apply`
converges to the same state) and self-verifies after applying:

```bash
scripts/branch-protection.sh apply solo   # PUT the SOLO rule, then verify
scripts/branch-protection.sh apply team   # switch to TEAM once a 2nd maintainer exists
scripts/branch-protection.sh verify        # read back & assert the gate is live
```

The raw payloads below are the same thing spelled out by hand, kept for
reference / UI parity.

### SOLO preset

```bash
REPO=clawmint-ai/agent-task-market
gh api -X PUT "repos/$REPO/branches/main/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "backend (typecheck + tests)" },
      { "context": "mcp-server (typecheck + build)" },
      { "context": "docker compose (config + build)" },
      { "context": "CodeQL (javascript-typescript)" },
      { "context": "gitleaks (secret scan)" }
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "required_conversation_resolution": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

What each field buys you:
- `strict: true` — branch must be **up to date with main** before merge (no merging
  a PR whose base moved out from under a green run).
- `required_conversation_resolution` — every review thread must be resolved.
- `allow_force_pushes/deletions: false` — nobody can rewrite or delete `main`.
- `enforce_admins: false` — admins keep a manual escape hatch. Set `true` to bind
  admins to the same rules (recommended once the team grows).
- `required_pull_request_reviews: null` — a PR is still required to change `main`
  (direct pushes are blocked), but no human approval is forced — so you can self-merge.

### TEAM preset

Same as SOLO, but replace the `required_pull_request_reviews` line:

```bash
REPO=clawmint-ai/agent-task-market
gh api -X PUT "repos/$REPO/branches/main/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "backend (typecheck + tests)" },
      { "context": "mcp-server (typecheck + build)" },
      { "context": "docker compose (config + build)" },
      { "context": "CodeQL (javascript-typescript)" },
      { "context": "gitleaks (secret scan)" }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "required_conversation_resolution": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

### Verify it took

```bash
gh api "repos/$REPO/branches/main/protection" \
  --jq '{checks: .required_status_checks.checks, strict: .required_status_checks.strict,
         reviews: .required_pull_request_reviews, admins: .enforce_admins.enabled,
         force_push: .allow_force_pushes.enabled}'
```

---

## UI path

Settings → Branches → Add branch ruleset (or "Add classic branch protection rule")
→ branch name pattern `main`, then tick:

- ✅ Require a pull request before merging
  - SOLO: leave "Require approvals" **unchecked**
  - TEAM: Require approvals = 1, ✅ Require review from Code Owners, ✅ Dismiss stale approvals
- ✅ Require status checks to pass → search and add the check names from the
  table above; ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution before merging
- ✅ Do not allow force pushes / deletions
- TEAM: ✅ Include administrators

---

## Notes

- A check only becomes selectable in the UI **after it has run at least
  once** on a PR. If you don't see one, open a throwaway PR, let CI run, then
  add it.
- `docker compose (config + build)` does a clean image build on every PR (~a few
  minutes). If that latency ever hurts, the cheaper guard is to keep
  `docker compose config -q` required and move the full build to a merge-queue or
  nightly job — but for now a full build on each PR is the honest gate.
