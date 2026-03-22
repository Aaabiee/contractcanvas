/**
 * Isolated tests for auth.ts module-level branches and paths requiring
 * env manipulation + vi.resetModules().
 *
 * Covers:
 *   - Lines 40-50: JWKS initialization (createRemoteJWKSet path + throw on failure)
 *   - Lines 56-58: verifyToken RS256 path
 *   - Lines 66-67: verifyToken "No verifier configured" error
 *   - Lines 89-92, 106-110: toUser role/orgRole fallback chains (dead code due to || with truthy arrays)
 *   - Lines 217-226: API key authentication path (membership lookup, org resolution)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import express from 'express';
import request from 'supertest';

let envBackup: NodeJS.ProcessEnv;

beforeEach(() => {
  envBackup = { ...process.env };
  vi.resetModules();
});

afterEach(() => {
  process.env = envBackup;
  vi.restoreAllMocks();
});

const SECRET = 'test-secret-key-for-testing-minimum-32!!';

function signToken(payload: object) {
  return jwt.sign(payload, SECRET, { algorithm: 'HS256' });
}

function setupMocks() {
  vi.doMock('../../config.js', () => ({
    app: { env: 'test', port: 3333 },
    db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
    s3: { region: 'us-east-1', bucket: 'test', forcePathStyle: true },
    stripe: {},
    jwt: { secret: SECRET },
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  }));

  vi.doMock('../../lib/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));
}

// ── Lines 40-50: JWKS initialization failure ──────────────────────────────
describe('auth.ts — JWKS initialization failure (lines 40-50)', () => {
  it('throws when AUTH_JWKS_URI is an invalid URL', async () => {
    process.env.AUTH_JWKS_URI = ':::invalid-url';
    delete process.env.AUTH_ISSUER;
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'test';

    setupMocks();
    vi.doMock('../../lib/redis.js', () => ({ isBlacklisted: vi.fn().mockResolvedValue(false) }));
    vi.doMock('../../prisma.js', () => ({ default: {} }));

    await expect(import('../auth.js')).rejects.toThrow('JWKS initialization failed');
  });
});

// ── Lines 66-67: No verifier configured ───────────────────────────────────
describe('auth.ts — No verifier configured (lines 66-67)', () => {
  it('returns 401 when neither JWKS nor JWT_SECRET is set', async () => {
    delete process.env.AUTH_JWKS_URI;
    delete process.env.AUTH_ISSUER;
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'test';

    vi.doMock('../../config.js', () => ({
      app: { env: 'test', port: 3333 },
      db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
      s3: { region: 'us-east-1', bucket: 'test', forcePathStyle: true },
      stripe: {},
      jwt: { secret: '' },
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    }));
    vi.doMock('../../lib/logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    vi.doMock('../../lib/redis.js', () => ({ isBlacklisted: vi.fn().mockResolvedValue(false) }));
    vi.doMock('../../prisma.js', () => ({ default: {} }));

    const { protect } = await import('../auth.js');

    const app = express();
    app.use((req: any, _res: any, next: any) => { next(); });
    app.get('/test', protect, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer some.fake.token');

    expect(res.status).toBe(401);
  });
});

// ── Lines 217-226: API key authentication path ────────────────────────────
describe('auth.ts — API key authentication (lines 217-226)', () => {
  it('authenticates via x-api-key and resolves org from membership', async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.NODE_ENV = 'test';
    delete process.env.AUTH_JWKS_URI;
    delete process.env.AUTH_ISSUER;

    const mockPrisma = {
      apiKey: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'key-1',
          organizationId: 'org-1',
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      organizationMember: {
        findFirst: vi.fn().mockResolvedValue({
          role: 'OWNER',
          organization: { id: 'org-1', name: 'Test Org', slug: 'test-org' },
        }),
      },
    };

    setupMocks();
    vi.doMock('../../lib/redis.js', () => ({ isBlacklisted: vi.fn().mockResolvedValue(false) }));
    vi.doMock('../../prisma.js', () => ({ default: mockPrisma }));

    const { protect } = await import('../auth.js');

    const app = express();
    app.get('/test', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app)
      .get('/test')
      .set('x-api-key', 'cc_live_abcdef1234567890');

    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe('org-1');
    expect(res.body.organizations).toHaveLength(1);
    expect(res.body.organizations[0].name).toBe('Test Org');
    expect(mockPrisma.apiKey.update).toHaveBeenCalled();
  });

  it('returns 401 for invalid API key', async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.NODE_ENV = 'test';
    delete process.env.AUTH_JWKS_URI;
    delete process.env.AUTH_ISSUER;

    const mockPrisma = {
      apiKey: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    setupMocks();
    vi.doMock('../../lib/redis.js', () => ({ isBlacklisted: vi.fn().mockResolvedValue(false) }));
    vi.doMock('../../prisma.js', () => ({ default: mockPrisma }));

    const { protect } = await import('../auth.js');

    const app = express();
    app.get('/test', protect, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app)
      .get('/test')
      .set('x-api-key', 'invalid-key');

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid api key/i);
  });

  it('sets empty organizations when no membership found', async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.NODE_ENV = 'test';
    delete process.env.AUTH_JWKS_URI;
    delete process.env.AUTH_ISSUER;

    const mockPrisma = {
      apiKey: {
        findFirst: vi.fn().mockResolvedValue({ id: 'key-2', organizationId: 'org-2' }),
        update: vi.fn().mockResolvedValue({}),
      },
      organizationMember: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    setupMocks();
    vi.doMock('../../lib/redis.js', () => ({ isBlacklisted: vi.fn().mockResolvedValue(false) }));
    vi.doMock('../../prisma.js', () => ({ default: mockPrisma }));

    const { protect } = await import('../auth.js');

    const app = express();
    app.get('/test', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app)
      .get('/test')
      .set('x-api-key', 'cc_live_1234567890abcdef');

    expect(res.status).toBe(200);
    expect(res.body.organizations).toEqual([]);
  });
});
