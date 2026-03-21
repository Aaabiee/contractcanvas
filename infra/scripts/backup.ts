#!/usr/bin/env npx tsx
import { execSync } from 'node:child_process';
import { createReadStream, unlinkSync, existsSync } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) { console.error(`[backup] ERROR: ${name} is required`); process.exit(1); }
  return val;
}

const POSTGRES_USER     = requireEnv('POSTGRES_USER');
const POSTGRES_PASSWORD = requireEnv('POSTGRES_PASSWORD');
const POSTGRES_DB       = requireEnv('POSTGRES_DB');
const POSTGRES_HOST     = process.env['POSTGRES_HOST'] ?? 'db';
const POSTGRES_PORT     = process.env['POSTGRES_PORT'] ?? '5432';
const S3_BUCKET         = requireEnv('S3_BUCKET');
const S3_BACKUP_PREFIX  = process.env['S3_BACKUP_PREFIX'] ?? 'backups/daily';
const AWS_REGION        = process.env['AWS_DEFAULT_REGION'] ?? 'us-east-1';

const date     = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const filename = `${POSTGRES_DB}-${date}.sql.gz`;
const tmpFile  = `/tmp/${filename}`;
const s3Key    = `${S3_BACKUP_PREFIX}/${filename}`;

console.log(`[backup] Starting pg_dump for ${POSTGRES_DB} on ${date}`);

execSync(
  `pg_dump -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" ` +
  `--no-password --format=plain --no-owner --no-privileges "${POSTGRES_DB}" | gzip > "${tmpFile}"`,
  { env: { ...process.env, PGPASSWORD: POSTGRES_PASSWORD }, stdio: 'inherit' },
);

console.log(`[backup] Uploading to s3://${S3_BUCKET}/${s3Key}`);

const s3 = new S3Client({ region: AWS_REGION });

async function upload() {
  const body = createReadStream(tmpFile);
  await s3.send(new PutObjectCommand({
    Bucket:       S3_BUCKET,
    Key:          s3Key,
    Body:         body,
    StorageClass: 'STANDARD_IA',
  }));

  if (existsSync(tmpFile)) unlinkSync(tmpFile);
  console.log(`[backup] Done: s3://${S3_BUCKET}/${s3Key}`);
}

upload().catch(err => {
  console.error('[backup] Upload failed:', err);
  if (existsSync(tmpFile)) unlinkSync(tmpFile);
  process.exit(1);
});
