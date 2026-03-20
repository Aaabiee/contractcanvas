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
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

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

  // Run migrations against the live container before any tests run
  execSync('npx prisma migrate deploy --schema prisma/schema.prisma', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
