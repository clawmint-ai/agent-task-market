# RUNBOOK — Ledger backup & restore (CLAWMIN-44)

The immutable `credit_ledger` plus the `accounts` balances are the money source
of truth. Production runs a single Postgres instance; without an off-site backup,
disk or instance loss means **all balances and settlement history are gone**.
This runbook covers taking encrypted off-site backups and restoring from them.

> Scope: the open backend's Postgres (open core). The closed risk-engine's own
> state is backed up separately by that service.

## What gets backed up

`ops/backup/pg_dump.sh` takes a **full** logical dump (`pg_dump -Fc`) so a restore
reconstructs `accounts` and `credit_ledger` **together** — conservation
(Σledger == Σbalances) only holds if both are restored from the same point in
time. The dump is encrypted with `gpg` (AES-256, symmetric) before it leaves the
host, then uploaded to S3-compatible object storage.

Required tooling on the host: `pg_dump`, `gpg`, `aws` (CLI). The backend runtime
image already ships `postgresql-client`; install `gnupg` and `awscli` on the
backup host.

## Configuration

| Env | Default | Purpose |
|-----|---------|---------|
| `DATABASE_URL` | — | Postgres to dump (same as the app). |
| `BACKUP_S3_BUCKET` | — | Target bucket. |
| `BACKUP_GPG_PASSPHRASE` | — | Symmetric encryption passphrase. **Production: load from a secret manager, never commit.** |
| `BACKUP_S3_PREFIX` | `ledger-backups` | Key prefix within the bucket. |
| `BACKUP_RETENTION_DAYS` | `7` | Copies older than this are pruned each run. |
| `BACKUP_S3_ENDPOINT` | (AWS) | Custom endpoint for non-AWS S3 (MinIO, Cloudflare R2). |
| `AWS_*` | — | Standard creds/region for the `aws` CLI. |
| `DRY_RUN` | `0` | `1` = dump + encrypt locally, skip all S3 calls. |

## Taking a backup

```bash
# Production (creds from the secret manager / environment):
DATABASE_URL=… BACKUP_S3_BUCKET=my-atm-backups BACKUP_GPG_PASSPHRASE=… \
  bash ops/backup/pg_dump.sh

# Local validation without object storage — produces an encrypted artifact only:
DRY_RUN=1 BACKUP_DRYRUN_OUT=/tmp/ledger.dump.gpg bash ops/backup/pg_dump.sh
```

Schedule it from cron on the backup host, e.g. daily at 03:17 UTC:

```cron
17 3 * * *  cd /srv/agent-task-market && BACKUP_S3_BUCKET=… BACKUP_GPG_PASSPHRASE=… bash ops/backup/pg_dump.sh >> /var/log/atm-backup.log 2>&1
```

The script exits non-zero on any failure, so cron mail / an alert on the log
surfaces a failed backup.

## Restoring

1. **Fetch & decrypt** the chosen copy (keys are UTC-timestamped, sort lexically):

   ```bash
   aws s3 cp s3://$BACKUP_S3_BUCKET/ledger-backups/ledger-<STAMP>.dump.gpg ./restore.dump.gpg
   gpg --batch --decrypt --passphrase-fd 3 --output ./restore.dump ./restore.dump.gpg 3<<<"$BACKUP_GPG_PASSPHRASE"
   ```

2. **Restore into a clean database** (never restore over a live one — stand up a
   fresh DB, verify, then cut over):

   ```bash
   createdb atm_restore
   pg_restore --no-owner --no-privileges --dbname="postgres://…/atm_restore" ./restore.dump
   ```

3. **Verify conservation** before trusting the restore (see drill below).

4. **Cut over**: point `DATABASE_URL` at the restored DB and restart the backend.

## Restore drill (verification — REQUIRED before trusting a backup)

Run this on a host that has `pg_dump`/`gpg`/`pg_restore` (the CI sandbox does not;
the deploy host and the backend image do):

```bash
# 1. Back up (or DRY_RUN to produce an artifact), then decrypt + restore into a
#    throwaway DB as above (atm_restore).

# 2. Conservation self-check against the restored DB:
cd backend
DATABASE_URL="postgres://…/atm_restore" npm run reconcile
```

Expected: the report prints `ok: true`, all class diffs `0`, and the line
`RECONCILE OK: ledger conserves across all classes (atm_conservation_ok=1)`.
Exit code is `0`. A non-zero exit or `RECONCILE FAILED` means the restore is
inconsistent — do **not** cut over; investigate before trusting that copy.

> `npm run reconcile` wraps `services/reconcileService.reconcile` (read-only). Its
> conservation logic is covered by `backend/test/integration/ledger.test.cjs`
> (`reconcile: ledger conserves after activity, ok=true`).

## Status

- Script + RUNBOOK + `reconcile` CLI: shipped, syntax/typecheck verified in CI.
- A live `pg_dump → S3 → restore → reconcile` drill must be run once on the
  deploy host (where the pg tooling and S3 creds exist) to fully close CLAWMIN-44.
