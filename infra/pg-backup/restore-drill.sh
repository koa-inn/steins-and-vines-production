#!/bin/sh
# Restore drill: fetch a backup (latest by default), decrypt it, restore it into a
# scratch database, and print row counts. Never point RESTORE_URL at a real database.
#
# Required env:
#   RESTORE_URL           scratch database URL to restore into
#   AGE_IDENTITY_FILE     path to the age private key file (mounted read-only)
#   plus the same R2_* variables as backup.sh (or BACKUP_REMOTE)
# Optional env:
#   BACKUP_PREFIX         default: production
#   BACKUP_OBJECT         a specific object name to restore instead of the latest
set -eu

log() { echo "[restore-drill] $*"; }

: "${RESTORE_URL:?RESTORE_URL is required}"
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE is required}"

PREFIX="${BACKUP_PREFIX:-production}"
if [ -z "${BACKUP_REMOTE:-}" ]; then
  : "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${R2_BUCKET:?}"
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
  BACKUP_REMOTE="r2:$R2_BUCKET"
fi

# Object names embed a UTC timestamp, so the lexically last one is the newest.
OBJ="${BACKUP_OBJECT:-$(rclone lsf "$BACKUP_REMOTE/$PREFIX/" | sort | tail -n 1)}"
[ -n "$OBJ" ] || { log "no backups found under $BACKUP_REMOTE/$PREFIX/"; exit 1; }
log "restoring $PREFIX/$OBJ"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
rclone copyto "$BACKUP_REMOTE/$PREFIX/$OBJ" "$WORK/dump.age"
age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$WORK/dump.pgcustom" "$WORK/dump.age"

pg_restore --no-owner --no-acl --exit-on-error --dbname="$RESTORE_URL" "$WORK/dump.pgcustom"

log "restored. row counts:"
psql "$RESTORE_URL" -At -F ' ' -c "
  SELECT schemaname || '.' || relname, n_live_tup
  FROM pg_stat_user_tables ORDER BY 1" | sed 's/^/  /'
# n_live_tup lags after a bulk load; give exact counts for each table too.
psql "$RESTORE_URL" -At -c "
  SELECT format('SELECT %L, count(*) FROM %I.%I', schemaname || '.' || relname, schemaname, relname)
  FROM pg_stat_user_tables ORDER BY 1" \
  | while read -r q; do psql "$RESTORE_URL" -At -F ' ' -c "$q" | sed 's/^/  exact /'; done
log "drill complete"
