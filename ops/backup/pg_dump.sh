#!/usr/bin/env bash
# ── Ledger backup: pg_dump → encrypt → object storage (CLAWMIN-44) ───────────
# The immutable credit_ledger + accounts balances are the money source of truth.
# A single-instance Postgres with no off-site backup is an unacceptable ops gap:
# disk/instance loss = all balances and settlement history gone. This script
# takes an encrypted logical dump and ships it to S3-compatible object storage,
# then prunes old copies past the retention window. Idempotent; safe in cron.
#
# Restore + drill procedure: docs/RUNBOOK-backup-restore.md
#
# Required env (see backend/.env.example):
#   DATABASE_URL          Postgres connection string to dump
#   BACKUP_S3_BUCKET      target bucket (e.g. my-atm-backups)
#   BACKUP_GPG_PASSPHRASE symmetric encryption passphrase (secret manager in prod)
# Optional env:
#   BACKUP_S3_PREFIX      key prefix (default: ledger-backups)
#   BACKUP_RETENTION_DAYS copies older than this are pruned (default: 7)
#   AWS_*                 standard AWS creds/region for the aws CLI / S3 endpoint
#   BACKUP_S3_ENDPOINT    custom endpoint for non-AWS S3 (MinIO, R2, …)
#   DRY_RUN=1             dump + encrypt locally, skip all S3 calls (CI / local)
#
# Exit non-zero on any failure so cron/alerting can gate on it.
set -euo pipefail

fail() { echo "pg_dump.sh: $*" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required}"
PREFIX="${BACKUP_S3_PREFIX:-ledger-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
DRY_RUN="${DRY_RUN:-0}"

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found (install postgresql-client)"
command -v gpg     >/dev/null 2>&1 || fail "gpg not found (install gnupg)"

if [[ "$DRY_RUN" != "1" ]]; then
  : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required (or set DRY_RUN=1)}"
  : "${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required (or set DRY_RUN=1)}"
  command -v aws >/dev/null 2>&1 || fail "aws CLI not found (install awscli)"
fi

# UTC timestamp so copies sort lexically and never collide across regions.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
DUMP="$WORKDIR/ledger-$STAMP.dump"
ENC="$DUMP.gpg"

echo "pg_dump.sh: dumping database → $DUMP"
# Custom format (-Fc): compressed, supports selective pg_restore. Full DB so a
# restore reconstructs accounts + credit_ledger together (conservation holds).
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$DUMP"
[[ -s "$DUMP" ]] || fail "dump is empty"

# Passphrase from env (never on the command line — argv is world-readable).
PASS="${BACKUP_GPG_PASSPHRASE:-dry-run-local-passphrase}"
echo "pg_dump.sh: encrypting → $ENC"
gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase-fd 3 --output "$ENC" "$DUMP" 3<<<"$PASS"
[[ -s "$ENC" ]] || fail "encrypted artifact is empty"
echo "pg_dump.sh: encrypted artifact $(du -h "$ENC" | cut -f1) ready"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "pg_dump.sh: DRY_RUN=1 — skipping S3 upload/prune. Artifact: $ENC"
  # Copy the artifact out of the temp dir so a dry run can be inspected.
  OUT="${BACKUP_DRYRUN_OUT:-./ledger-$STAMP.dump.gpg}"
  cp "$ENC" "$OUT"
  echo "pg_dump.sh: DRY_RUN artifact written to $OUT"
  exit 0
fi

S3_BASE="s3://${BACKUP_S3_BUCKET}/${PREFIX}"
KEY="${S3_BASE}/ledger-${STAMP}.dump.gpg"
AWS_ARGS=()
[[ -n "${BACKUP_S3_ENDPOINT:-}" ]] && AWS_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")

echo "pg_dump.sh: uploading → $KEY"
aws "${AWS_ARGS[@]}" s3 cp "$ENC" "$KEY"

# Retention: prune encrypted dumps older than RETENTION_DAYS by their timestamped
# key. Compares the embedded date (UTC) against the cutoff; never deletes today's.
echo "pg_dump.sh: pruning copies older than ${RETENTION_DAYS}d under $S3_BASE"
CUTOFF="$(date -u -d "${RETENTION_DAYS} days ago" +%Y%m%d 2>/dev/null || date -u -v-"${RETENTION_DAYS}"d +%Y%m%d)"
aws "${AWS_ARGS[@]}" s3 ls "$S3_BASE/" | awk '{print $4}' | while read -r name; do
  [[ "$name" =~ ledger-([0-9]{8})T.*\.dump\.gpg ]] || continue
  day="${BASH_REMATCH[1]}"
  if [[ "$day" < "$CUTOFF" ]]; then
    echo "pg_dump.sh: prune $name (day $day < cutoff $CUTOFF)"
    aws "${AWS_ARGS[@]}" s3 rm "$S3_BASE/$name"
  fi
done

echo "pg_dump.sh: backup complete → $KEY"
