<!--
  PR template for Agent Task Market. The CI gate (backend / mcp-server / docker
  jobs in .github/workflows/ci.yml) runs automatically — this checklist is for
  the things CI can't verify. Delete sections that don't apply.
-->

## What & why

<!-- One or two sentences: what this changes and the reason. Link the issue/Linear ticket. -->

Closes:

## How it was verified

<!-- State what you actually ran, not what should pass. Paste key output if useful. -->

- [ ] `npm test` (backend) green locally
- [ ] `npx tsc --noEmit` clean (backend + mcp-server)
- [ ] Ran the relevant flow end-to-end (smoke-test.sh / docker compose up) where applicable

## Risk & rollout

<!-- Anything reviewers/operators must know. -->

- Migrations / schema changes:
- Config or env changes (.env.example updated?):
- Reversibility (how to roll back):

## Ledger & safety (delete if not touched)

<!-- This project moves credits and runs untrusted code. If you touched any of these, confirm: -->

- [ ] Credit moves stay conservation-safe (no balance created/destroyed outside the ledger)
- [ ] Untrusted-code paths still run under the sandbox guardrail (no SANDBOX_ALLOW_LOCAL leaking into prod)
- [ ] No secrets / API keys committed
