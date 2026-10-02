#!/bin/sh
# Nightly Postgres backup: pg_dump -> validate -> age-encrypt -> upload to R2.
# Runs as a Railway cron service (see infra/pg-backup/README.md). Exits non-zero on
# any failure so the cron run shows as failed in Railway.
#
# Required env:
#   DATABASE_URL          private-network URL of the database to dump
#   AGE_RECIPIENT         age public key (age1...) dumps are encrypted to
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
# Optional env:
#   BACKUP_PREFIX         object key prefix (default: production)
#   HEARTBEAT_URL         pinged on success; "$HEARTBEAT_URL/fail" on failure
#   BACKUP_REMOTE         rclone destination override (default: r2:$R2_BUCKET);
#                         used by the local end-to-end test to write to a directory
set -eu

log() { echo "[pg-backup] $*"; }

fail() {
  log "FAILED: $*"
  if [ -n "${HEARTBEAT_URL:-}" ]; then
    curl -fsS -m 10 --retry 3 "$HEARTBEAT_URL/fail" >/dev/null 2>&1 || true
  fi
  exit 1
}

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is required}"

PREFIX="${BACKUP_PREFIX:-production}"
if [ -z "${BACKUP_REMOTE:-}" ]; then
  : "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
  : "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
  : "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
  : "${R2_BUCKET:?R2_BUCKET is required}"
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  # The API token is scoped to one bucket and cannot create buckets.
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
  BACKUP_REMOTE="r2:$R2_BUCKET"
fi

TS=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
DUMP="$WORK/dump.pgcustom"
NAME="${PREFIX}-${TS}.pgcustom.age"
OUT="$WORK/$NAME"

log "dumping ($(pg_dump --version))"
pg_dump --format=custom --no-password --dbname="$DATABASE_URL" --file="$DUMP" \
  || fail "pg_dump exited non-zero"

# A dump that pg_restore cannot list is not a backup.
ENTRIES=$(pg_restore --list "$DUMP" | grep -vc '^;') || fail "pg_restore --list could not read the dump"
[ "$ENTRIES" -gt 0 ] || fail "dump has no entries"
log "dump ok: $(wc -c <"$DUMP" | tr -d ' ') bytes, $ENTRIES TOC entries"

age --encrypt --recipient "$AGE_RECIPIENT" --output "$OUT" "$DUMP" \
  || fail "age encryption failed"
rm -f "$DUMP"
SIZE=$(wc -c <"$OUT" | tr -d ' ')

rclone copyto "$OUT" "$BACKUP_REMOTE/$PREFIX/$NAME" --retries 3 \
  || fail "upload to $BACKUP_REMOTE failed"

# Confirm the object landed with the right size before reporting success.
REMOTE_SIZE=$(rclone lsjson "$BACKUP_REMOTE/$PREFIX/$NAME" | sed -n 's/.*"Size":\([0-9]*\).*/\1/p')
[ "$REMOTE_SIZE" = "$SIZE" ] || fail "uploaded size '$REMOTE_SIZE' != local size '$SIZE'"

log "uploaded $PREFIX/$NAME ($SIZE bytes)"
if [ -n "${HEARTBEAT_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$HEARTBEAT_URL" >/dev/null 2>&1 || log "warning: heartbeat ping failed"
fi
