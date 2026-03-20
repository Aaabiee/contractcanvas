/**
 * Global setup for integration tests.
 *
 * Vitest runs this once in the main process before workers are forked.
 * With pool:'forks', forked workers inherit process.env changes made here.
 *
 * Steps:
 *  1. Ensure Docker is reachable (set DOCKER_HOST if needed)
 *  2. Boot a real PostgreSQL container via Testcontainers
 *  3. Set the POSTGRES_* env vars that config.ts assembles into DATABASE_URL
 *  4. Run `prisma migrate deploy` against the live container
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Resolve the apps/api root regardless of the process cwd
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let container: StartedPostgreSqlContainer;

export async function setup(): Promise<void> {
  // Testcontainers may not auto-detect the socket on macOS Docker Desktop
  if (!process.env['DOCKER_HOST']) {
    process.env['DOCKER_HOST'] = 'unix:///var/run/docker.sock';
  }

  process.env['NODE_ENV'] = 'test';

  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('contractcanvas_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const url  = container.getConnectionUri();

  // config.ts builds DATABASE_URL from individual POSTGRES_* vars —
  // set all of them so the route's prisma singleton uses the test container.
  process.env['POSTGRES_HOST']     = host;
  process.env['POSTGRES_PORT']     = String(port);
  process.env['POSTGRES_USER']     = 'test';
  process.env['POSTGRES_PASSWORD'] = 'test';
  process.env['POSTGRES_DB']       = 'contractcanvas_test';

  // Also expose the full URI for the test file's own PrismaClient
  process.env['DATABASE_URL']      = url;
  process.env['TEST_DATABASE_URL'] = url;

  // JWT secret used by both the route (signing) and protect middleware (verifying)
  process.env['JWT_SECRET'] = 'integration-test-secret-minimum-32-chars!!';

  // Apply schema to the live container before any tests run.
  // db push is used instead of migrate deploy so that it works even when
  // the Prisma migration history table isn't pre-seeded, and avoids
  // interactive prompts. stdio:'inherit' surfaces errors in CI logs.
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
