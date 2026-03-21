/**
 * Global setup for integration tests.
 *
 * Vitest runs this once in the main process before workers are forked.
 * With pool:'forks', forked workers inherit process.env changes made here.
 *
 * Steps:
 *  1. Ensure Docker is reachable (set DOCKER_HOST if needed)
 *  2. Boot a real PostgreSQL container via Testcontainers
 *  3. Boot a real MinIO container for S3 integration tests
 *  4. Set all env vars (POSTGRES_*, S3_*, JWT_SECRET)
 *  5. Create the S3 test bucket
 *  6. Run `prisma db push` against the live container
 */

import { execSync }           from 'node:child_process';
import { fileURLToPath }      from 'node:url';
import path                   from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer, Wait }   from 'testcontainers';
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

// Resolve the apps/api root regardless of the process cwd
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let pgContainer:    StartedPostgreSqlContainer;
let minioContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;

const MINIO_ACCESS_KEY = 'testAccessKey';
const MINIO_SECRET_KEY = 'testSecretKey';
const MINIO_BUCKET     = 'contractcanvas-test';

export async function setup(): Promise<void> {
  // Testcontainers may not auto-detect the socket on macOS Docker Desktop
  if (!process.env['DOCKER_HOST']) {
    process.env['DOCKER_HOST'] = 'unix:///var/run/docker.sock';
  }

  process.env['NODE_ENV'] = 'test';

  // Boot PostgreSQL, MinIO, and Redis in parallel
  [pgContainer, minioContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('contractcanvas_test')
      .withUsername('test')
      .withPassword('test')
      .start(),

    new GenericContainer('minio/minio:latest')
      .withExposedPorts(9000)
      .withEnvironment({
        MINIO_ROOT_USER:     MINIO_ACCESS_KEY,
        MINIO_ROOT_PASSWORD: MINIO_SECRET_KEY,
      })
      .withCommand(['server', '/data'])
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000).forStatusCode(200))
      .start(),

    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start(),
  ]);

  // ── PostgreSQL env vars ──────────────────────────────────────────────────
  const pgUrl = pgContainer.getConnectionUri();
  process.env['POSTGRES_HOST']     = pgContainer.getHost();
  process.env['POSTGRES_PORT']     = String(pgContainer.getMappedPort(5432));
  process.env['POSTGRES_USER']     = 'test';
  process.env['POSTGRES_PASSWORD'] = 'test';
  process.env['POSTGRES_DB']       = 'contractcanvas_test';
  process.env['DATABASE_URL']      = pgUrl;
  process.env['TEST_DATABASE_URL'] = pgUrl;

  // ── MinIO (S3) env vars ──────────────────────────────────────────────────
  const minioPort     = minioContainer.getMappedPort(9000);
  const minioEndpoint = `http://localhost:${minioPort}`;
  process.env['S3_ENDPOINT']         = minioEndpoint;
  process.env['S3_ACCESS_KEY']       = MINIO_ACCESS_KEY;
  process.env['S3_SECRET_KEY']       = MINIO_SECRET_KEY;
  process.env['S3_BUCKET']           = MINIO_BUCKET;
  process.env['S3_REGION']           = 'us-east-1';
  process.env['S3_FORCE_PATH_STYLE'] = 'true';
  process.env['TEST_S3_ENDPOINT']    = minioEndpoint;

  // Create the test bucket
  const s3 = new S3Client({
    endpoint:        minioEndpoint,
    region:          'us-east-1',
    forcePathStyle:  true,
    credentials: { accessKeyId: MINIO_ACCESS_KEY, secretAccessKey: MINIO_SECRET_KEY },
  });

  try {
    await s3.send(new HeadBucketCommand({ Bucket: MINIO_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: MINIO_BUCKET }));
  }

  // ── Redis env var ─────────────────────────────────────────────────────────
  const redisPort = redisContainer.getMappedPort(6379);
  process.env['REDIS_URL'] = `redis://localhost:${redisPort}`;

  // ── JWT secret ───────────────────────────────────────────────────────────
  process.env['JWT_SECRET'] = 'integration-test-secret-minimum-32-chars!!';

  // ── Apply schema to the live DB ──────────────────────────────────────────
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: pgUrl },
    stdio: 'inherit',
  });
}

export async function teardown(): Promise<void> {
  await Promise.all([
    pgContainer?.stop(),
    minioContainer?.stop(),
    redisContainer?.stop(),
  ]);
}
