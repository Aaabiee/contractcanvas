import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret-key-for-testing-minimum-32!!';
process.env.NODE_ENV = 'test';

const mockPrisma = {
  $queryRaw: vi.fn(),
};

vi.mock('../../config.js', () => ({
  app: { env: 'test', port: 3333 },
  db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
  s3: { region: 'us-east-1', bucket: 'test', forcePathStyle: true, endpoint: 'http://localhost:9000', accessKey: 'test', secretKey: 'test' },
  stripe: {},
  jwt: { secret: 'test-secret-key-for-testing-minimum-32!!' },
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
}));

vi.mock('../../prisma.js', () => ({ prisma: mockPrisma }));

const mockS3Send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockS3Send })),
  HeadBucketCommand: vi.fn(),
}));

const mockRedisClient = {
  ping: vi.fn(),
};
vi.mock('../../lib/redis.js', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
}));

const { default: healthRouter } = await import('../health.js');
const { getRedisClient } = await import('../../lib/redis.js');

function buildApp() {
  const app = express();
  app.use('/health', healthRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  (getRedisClient as ReturnType<typeof vi.fn>).mockReturnValue(null);
});

describe('GET /health', () => {
  it('returns 503 when DB check fails', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    mockS3Send.mockResolvedValue({});

    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.checks.db).toBe('error');
    expect(res.body.checks.s3).toBe('ok');
  });

  it('returns 503 when S3 check fails', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    mockS3Send.mockRejectedValue(new Error('bucket not found'));

    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.checks.db).toBe('ok');
    expect(res.body.checks.s3).toBe('error');
  });

  it('returns 503 when Redis check fails', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    mockS3Send.mockResolvedValue({});
    (getRedisClient as ReturnType<typeof vi.fn>).mockReturnValue(mockRedisClient);
    mockRedisClient.ping.mockRejectedValue(new Error('redis down'));

    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.checks.redis).toBe('error');
  });

  it('returns 200 when all checks pass (with Redis)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    mockS3Send.mockResolvedValue({});
    (getRedisClient as ReturnType<typeof vi.fn>).mockReturnValue(mockRedisClient);
    mockRedisClient.ping.mockResolvedValue('PONG');

    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks.db).toBe('ok');
    expect(res.body.checks.s3).toBe('ok');
    expect(res.body.checks.redis).toBe('ok');
  });

  it('returns 200 when all checks pass (without Redis)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    mockS3Send.mockResolvedValue({});

    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks.db).toBe('ok');
    expect(res.body.checks.s3).toBe('ok');
    expect(res.body.checks).not.toHaveProperty('redis');
  });

  it('returns 503 when both DB and S3 fail', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('db down'));
    mockS3Send.mockRejectedValue(new Error('s3 down'));

    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.checks.db).toBe('error');
    expect(res.body.checks.s3).toBe('error');
  });
});
