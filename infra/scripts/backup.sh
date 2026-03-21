#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
: "${POSTGRES_DB:?POSTGRES_DB required}"
: "${POSTGRES_HOST:=db}"
: "${POSTGRES_PORT:=5432}"
: "${S3_BUCKET:?S3_BUCKET required}"
: "${S3_BACKUP_PREFIX:=backups/daily}"
: "${AWS_DEFAULT_REGION:=us-east-1}"

DATE=$(date -u +%Y%m%d)
FILENAME="${POSTGRES_DB}-${DATE}.sql.gz"
TMPFILE="/tmp/${FILENAME}"

echo "[backup] Starting pg_dump for ${POSTGRES_DB} on ${DATE}"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT}" \
  -U "${POSTGRES_USER}" \
  --no-password \
  --format=plain \
  --no-owner \
  --no-privileges \
  "${POSTGRES_DB}" | gzip > "${TMPFILE}"

echo "[backup] Uploading to s3://${S3_BUCKET}/${S3_BACKUP_PREFIX}/${FILENAME}"
aws s3 cp "${TMPFILE}" "s3://${S3_BUCKET}/${S3_BACKUP_PREFIX}/${FILENAME}" \
  --storage-class STANDARD_IA

rm -f "${TMPFILE}"
echo "[backup] Done: s3://${S3_BUCKET}/${S3_BACKUP_PREFIX}/${FILENAME}"
