import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, cleanDb } from './helpers.js';
import { s3 } from '../../config.js';
import { getRedisClient } from '../../lib/redis.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

afterEach(() => cleanDb(db));
afterAll(() => db.$disconnect());

describe('GET /health', () => {
  it('returns 200 with ok:true and a checks object', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks).toBeDefined();
  });

  it('reports db:ok when connected', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');
    expect(res.body.checks.db).toBe('ok');
  });

  it('includes env field', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');
    expect(typeof res.body.env).toBe('string');
  });

  it('reports s3 check status', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');

    // The checks object should have an s3 key regardless of whether MinIO is running
    expect(res.body.checks).toHaveProperty('s3');
    expect(['ok', 'error']).toContain(res.body.checks.s3);
  });

  it('reports redis check status when redis is available', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');

    // Redis check is only included if getRedisClient() returns a client.
    // If redis is running, it should appear. If not, it may be absent.
    if (res.body.checks.redis !== undefined) {
      expect(['ok', 'error']).toContain(res.body.checks.redis);
    }
  });

  it('returns all checks in a single response', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');

    expect(res.status).toBeLessThanOrEqual(503);
    expect(res.body).toHaveProperty('ok');
    expect(typeof res.body.ok).toBe('boolean');
    expect(res.body).toHaveProperty('checks');
    expect(typeof res.body.checks).toBe('object');
    // db should always be present
    expect(res.body.checks).toHaveProperty('db');
  });

  it('returns 503 when any check fails', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');

    if (res.body.ok === false) {
      expect(res.status).toBe(503);
      // At least one check should be 'error'
      const checks = Object.values(res.body.checks);
      expect(checks).toContain('error');
    } else {
      // All checks pass
      expect(res.status).toBe(200);
      const checks = Object.values(res.body.checks);
      expect(checks.every((c) => c === 'ok')).toBe(true);
    }
  });
});

// ─── Error-branch coverage (lines 17-19, 31-33, 41-43) ──────────────────────

describe('GET /health — error branches', () => {
  let originalBucket: string;

  it('reports s3:error when bucket is invalid (lines 31-33)', async () => {
    originalBucket = s3.bucket;
    (s3 as any).bucket = 'nonexistent-bucket-that-does-not-exist-xyz';

    try {
      const app = buildApp();
      const res = await request(app).get('/health');

      expect(res.body.checks.s3).toBe('error');
      expect(res.body.ok).toBe(false);
      expect(res.status).toBe(503);
    } finally {
      (s3 as any).bucket = originalBucket;
    }
  });

  it('reports redis:error when ping fails (lines 41-43)', async () => {
    const redis = getRedisClient();
    if (!redis) return; // skip if no redis

    const originalPing = redis.ping.bind(redis);
    redis.ping = async () => { throw new Error('forced ping failure'); };

    try {
      const app = buildApp();
      const res = await request(app).get('/health');

      expect(res.body.checks.redis).toBe('error');
      expect(res.body.ok).toBe(false);
      expect(res.status).toBe(503);
    } finally {
      redis.ping = originalPing;
    }
  });
});
