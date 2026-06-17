#!/usr/bin/env bash
# Apply / verify branch protection on `main` for this repo.
#
# Single executable source of truth for the merge gate documented in
# docs/branch-protection.md (CLAWMIN-34). Idempotent: re-running `apply`
# converges to the same protected state.
#
# Usage:
#   scripts/branch-protection.sh apply  [solo|team]   # PUT the rule (default: solo)
#   scripts/branch-protection.sh verify               # read back & assert it took
#
# Prereqs: `gh auth login` once; the authenticated user must have admin on the
# repo. Requires `gh` and `jq`.
set -euo pipefail

REPO="${REPO:-clawmint-ai/agent-task-market}"
BRANCH="${BRANCH:-main}"

# Required status checks — must match the job `name:` in each workflow verbatim.
# Keep in sync with docs/branch-protection.md and .github/workflows/*.yml.
CHECKS=(
  "backend (typecheck + tests)"
  "mcp-server (typecheck + build)"
  "docker compose (config + build)"
  "CodeQL (javascript-typescript)"
  "gitleaks (secret scan)"
)

die() { echo "error: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

# Build the checks JSON array from CHECKS[] so the list lives in one place.
checks_json() {
  printf '%s\n' "${CHECKS[@]}" \
    | jq -R '{context: .}' \
    | jq -s '.'
}

# Assemble the full protection payload. $1 = solo|team.
# SOLO: PR required + green CI + strict + no force-push/delete, NO approvals
#       (GitHub forbids self-approval; requiring it locks out a lone maintainer).
# TEAM: SOLO + 1 approval + Code Owner review + dismiss stale + bind admins.
payload() {
  local preset="$1" reviews enforce_admins
  case "$preset" in
    solo)
      reviews=null
      enforce_admins=false
      ;;
    team)
      reviews='{"required_approving_review_count":1,"require_code_owner_reviews":true,"dismiss_stale_reviews":true}'
      enforce_admins=true
      ;;
    *) die "unknown preset: $preset (want: solo|team)" ;;
  esac

  jq -n \
    --argjson checks "$(checks_json)" \
    --argjson reviews "$reviews" \
    --argjson enforce_admins "$enforce_admins" \
    '{
      required_status_checks: { strict: true, checks: $checks },
      enforce_admins: $enforce_admins,
      required_pull_request_reviews: $reviews,
      required_conversation_resolution: true,
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false
    }'
}

cmd_apply() {
  local preset="${1:-solo}"
  need gh; need jq
  # Validate + build the payload BEFORE the pipe. If we let payload() die inside
  # `payload | gh api`, the subshell exits but gh still fires a network PUT with
  # empty stdin. Materialize first so a bad preset never touches the API.
  local body
  body="$(payload "$preset")"
  echo ">> applying '$preset' protection to $REPO@$BRANCH"
  gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" \
    -H "Accept: application/vnd.github+json" --input - <<<"$body" >/dev/null
  echo ">> applied. verifying..."
  cmd_verify
}

# Read the live rule back and assert the invariants this gate promises.
# Exits non-zero if any required property drifted.
cmd_verify() {
  need gh; need jq
  local got
  got="$(gh api "repos/$REPO/branches/$BRANCH/protection" \
    -H "Accept: application/vnd.github+json")"

  local want_checks fail=0
  want_checks="$(printf '%s\n' "${CHECKS[@]}" | sort)"
  local got_checks
  got_checks="$(jq -r '.required_status_checks.checks[].context' <<<"$got" | sort)"

  if [[ "$want_checks" != "$got_checks" ]]; then
    echo "FAIL required checks drifted:" >&2
    diff <(echo "$want_checks") <(echo "$got_checks") >&2 || true
    fail=1
  fi
  [[ "$(jq -r '.required_status_checks.strict' <<<"$got")" == "true" ]] \
    || { echo "FAIL strict != true" >&2; fail=1; }
  [[ "$(jq -r '.allow_force_pushes.enabled' <<<"$got")" == "false" ]] \
    || { echo "FAIL force pushes allowed" >&2; fail=1; }
  [[ "$(jq -r '.allow_deletions.enabled' <<<"$got")" == "false" ]] \
    || { echo "FAIL deletions allowed" >&2; fail=1; }
  [[ "$(jq -r '.required_conversation_resolution.enabled' <<<"$got")" == "true" ]] \
    || { echo "FAIL conversation resolution off" >&2; fail=1; }

  jq '{checks: [.required_status_checks.checks[].context],
       strict: .required_status_checks.strict,
       reviews: .required_pull_request_reviews,
       admins: .enforce_admins.enabled,
       force_push: .allow_force_pushes.enabled,
       deletions: .allow_deletions.enabled,
       conversation_resolution: .required_conversation_resolution.enabled}' <<<"$got"

  [[ "$fail" -eq 0 ]] && echo ">> OK: gate is live" || die "verification failed"
}

case "${1:-}" in
  apply)  shift; cmd_apply "${1:-solo}" ;;
  verify) cmd_verify ;;
  *) die "usage: $0 {apply [solo|team]|verify}" ;;
esac
