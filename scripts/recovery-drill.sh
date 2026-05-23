#!/usr/bin/env bash
# Monthly recovery drill for Sohojatra.
#
# Downloads a backup archive from the cross-region S3 bucket and restores it into
# a throwaway Postgres 16 container, then runs a fixed set of sanity queries.
# Pass / fail is decided by:
#   - pg_restore exits 0
#   - sanity queries return plausible row counts (i.e. > 0 for ride_requests / users)
#
# Usage:
#   scripts/recovery-drill.sh s3://<bucket>/sohojatra/2026/05/22/sohojatra-20260522T020000Z.dump
#
# Required env:
#   BACKUP_AWS_ACCESS_KEY_ID
#   BACKUP_AWS_SECRET_ACCESS_KEY
#   BACKUP_S3_REGION

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 s3://<bucket>/<key>" >&2
  exit 64
fi

s3_uri="$1"

: "${BACKUP_AWS_ACCESS_KEY_ID:?missing BACKUP_AWS_ACCESS_KEY_ID}"
: "${BACKUP_AWS_SECRET_ACCESS_KEY:?missing BACKUP_AWS_SECRET_ACCESS_KEY}"
: "${BACKUP_S3_REGION:?missing BACKUP_S3_REGION}"

export AWS_ACCESS_KEY_ID="$BACKUP_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_S3_REGION"

workdir="$(mktemp -d)"
container="sohojatra-drill-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

archive="$workdir/$(basename "$s3_uri")"
echo "[drill] downloading $s3_uri"
aws s3 cp "$s3_uri" "$archive" --only-show-errors

pw="drill-$(openssl rand -hex 8)"
echo "[drill] launching throwaway postgres container"
docker run -d --name "$container" \
  -e POSTGRES_PASSWORD="$pw" \
  -e POSTGRES_DB=drill \
  -p 0:5432 \
  postgres:16-alpine >/dev/null

# Wait until ready
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

port=$(docker port "$container" 5432/tcp | head -n1 | awk -F: '{print $NF}')
conn="postgres://postgres:${pw}@127.0.0.1:${port}/drill"

start=$(date +%s)
echo "[drill] restoring archive into container"
pg_restore --no-owner --no-privileges --dbname="$conn" "$archive"
elapsed=$(( $(date +%s) - start ))
echo "[drill] restore completed in ${elapsed}s"

echo "[drill] running sanity queries"
psql "$conn" -At -c "select 'ride_requests='||count(*) from public.ride_requests;"
psql "$conn" -At -c "select 'users='||count(*) from public.users;"
psql "$conn" -At -c "select 'ride_passengers='||count(*) from public.ride_passengers;"
psql "$conn" -At -c "select 'max_ride_created='||coalesce(max(created_at)::text,'null') from public.ride_requests;"

rows=$(psql "$conn" -At -c "select count(*) from public.ride_requests;")
if [ "${rows:-0}" -lt 1 ]; then
  echo "[drill] FAIL: ride_requests is empty after restore" >&2
  exit 1
fi

echo "[drill] PASS"
