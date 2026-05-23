#!/usr/bin/env bash
# Cross-region Postgres backup for Sohojatra.
#
# Dumps the production Supabase database with pg_dump --format=custom and uploads
# the dump to an S3 bucket in a DIFFERENT region than the database (see
# BACKUP_AND_RECOVERY.md for the why). Intended to run from .github/workflows/backup.yml
# but is safe to run locally as long as the required env vars are exported.
#
# Required env:
#   SUPABASE_DB_URL              postgres://...   (direct, port 5432, not pooler)
#   BACKUP_S3_BUCKET             bucket name
#   BACKUP_S3_REGION             e.g. ap-southeast-1
#   BACKUP_KMS_KEY_ID            KMS CMK ARN for SSE-KMS
#   BACKUP_AWS_ACCESS_KEY_ID     scoped IAM user (PutObject + GenerateDataKey only)
#   BACKUP_AWS_SECRET_ACCESS_KEY matching secret

set -euo pipefail

: "${SUPABASE_DB_URL:?missing SUPABASE_DB_URL}"
: "${BACKUP_S3_BUCKET:?missing BACKUP_S3_BUCKET}"
: "${BACKUP_S3_REGION:?missing BACKUP_S3_REGION}"
: "${BACKUP_KMS_KEY_ID:?missing BACKUP_KMS_KEY_ID}"
: "${BACKUP_AWS_ACCESS_KEY_ID:?missing BACKUP_AWS_ACCESS_KEY_ID}"
: "${BACKUP_AWS_SECRET_ACCESS_KEY:?missing BACKUP_AWS_SECRET_ACCESS_KEY}"

export AWS_ACCESS_KEY_ID="$BACKUP_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$BACKUP_S3_REGION"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

dump_file="$workdir/sohojatra-${timestamp}.dump"
sha_file="$workdir/sohojatra-${timestamp}.dump.sha256"

echo "[backup] dumping database -> $dump_file"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --compress=9 \
  --file="$dump_file" \
  "$SUPABASE_DB_URL"

dump_size=$(stat -c%s "$dump_file" 2>/dev/null || stat -f%z "$dump_file")
echo "[backup] dump size: ${dump_size} bytes"

if [ "${dump_size:-0}" -lt 1024 ]; then
  echo "[backup] FATAL: dump is implausibly small (<1KB). Aborting upload." >&2
  exit 1
fi

echo "[backup] computing checksum"
sha256sum "$dump_file" | awk '{print $1}' > "$sha_file"

year=$(date -u +%Y)
month=$(date -u +%m)
day=$(date -u +%d)
key_prefix="sohojatra/${year}/${month}/${day}"

echo "[backup] uploading dump to s3://${BACKUP_S3_BUCKET}/${key_prefix}/"
aws s3 cp "$dump_file" "s3://${BACKUP_S3_BUCKET}/${key_prefix}/$(basename "$dump_file")" \
  --sse aws:kms \
  --sse-kms-key-id "$BACKUP_KMS_KEY_ID" \
  --storage-class STANDARD_IA \
  --only-show-errors

aws s3 cp "$sha_file" "s3://${BACKUP_S3_BUCKET}/${key_prefix}/$(basename "$sha_file")" \
  --sse aws:kms \
  --sse-kms-key-id "$BACKUP_KMS_KEY_ID" \
  --only-show-errors

echo "[backup] done: s3://${BACKUP_S3_BUCKET}/${key_prefix}/$(basename "$dump_file")"
