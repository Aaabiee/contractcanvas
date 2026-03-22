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

// ── Helper: import auth with HS256 configured ─────────────────────────────
async function importAuthWithHs256() {
  process.env.JWT_SECRET = SECRET;
  process.env.NODE_ENV = 'test';
  delete process.env.AUTH_JWKS_URI;
  delete process.env.AUTH_ISSUER;
  delete process.env.AUTH_ROLE_CLAIM;

  setupMocks();
  vi.doMock('../../lib/redis.js', () => ({ isBlacklisted: vi.fn().mockResolvedValue(false) }));
  vi.doMock('../../prisma.js', () => ({ default: {} }));

  return import('../auth.js');
}

// ── Lines 61-64: HS256 verifyToken ────────────────────────────────────────
describe('auth.ts — HS256 JWT verification (lines 61-64)', () => {
  it('verifies a valid HS256 token and calls next', async () => {
    const { protect } = await importAuthWithHs256();
    const token = signToken({ sub: 'u1', email: 'a@b.com', roles: ['LAWYER'] });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('u1');
    expect(res.body.email).toBe('a@b.com');
  });

  it('returns 401 for an expired HS256 token', async () => {
    const { protect } = await importAuthWithHs256();
    const token = jwt.sign({ sub: 'u1' }, SECRET, { expiresIn: '-1s' });

    const app = express();
    app.get('/t', protect, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

// ── Lines 69-170: toUser + resolveOrganizationId ──────────────────────────
describe('auth.ts — toUser claim parsing (lines 69-170)', () => {
  it('extracts email from "emails" array fallback', async () => {
    const { protect } = await importAuthWithHs256();
    const token = signToken({ sub: 'u2', emails: ['first@x.com', 'second@x.com'] });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.body.email).toBe('first@x.com');
  });

  it('maps role strings to enum values', async () => {
    const { protect } = await importAuthWithHs256();
    const token = signToken({ sub: 'u3', roles: ['admin', 'paralegal'] });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.body.role).toBe('ADMIN');
    expect(res.body.roles).toEqual(['admin', 'paralegal']);
  });

  it('maps org_roles to OrgRole enum', async () => {
    const { protect } = await importAuthWithHs256();
    const token = signToken({ sub: 'u4', roles: ['lawyer'], org_roles: ['owner', 'admin'] });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.body.orgRole).toBe('OWNER');
    expect(res.body.orgRoles).toContain('OWNER');
    expect(res.body.orgRoles).toContain('ADMIN');
  });

  it('uses fallback regex loop for custom role keys (e.g. "appRoles")', async () => {
    const { protect } = await importAuthWithHs256();
    const token = signToken({ sub: 'u5', appRoles: ['client'] });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.body.roles).toContain('client');
    expect(res.body.role).toBe('CLIENT');
  });

  it('extracts organizations array from token', async () => {
    const { protect } = await importAuthWithHs256();
    const orgs = [{ id: 'org-1', name: 'Org', slug: 'org', role: 'OWNER' }];
    const token = signToken({ sub: 'u6', roles: [], organizations: orgs });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.body.organizations).toEqual(orgs);
    expect(res.body.organizationId).toBe('org-1');
  });

  it('resolves org from X-Organization-Id header', async () => {
    const { protect } = await importAuthWithHs256();
    const orgs = [
      { id: 'org-a', name: 'A', slug: 'a', role: 'OWNER' },
      { id: 'org-b', name: 'B', slug: 'b', role: 'MEMBER' },
    ];
    const token = signToken({ sub: 'u7', roles: [], organizations: orgs });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org-b');
    expect(res.body.organizationId).toBe('org-b');
  });

  it('returns undefined orgId when X-Organization-Id does not match', async () => {
    const { protect } = await importAuthWithHs256();
    const orgs = [{ id: 'org-a', name: 'A', slug: 'a', role: 'OWNER' }];
    const token = signToken({ sub: 'u8', roles: [], organizations: orgs });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org-nonexistent');
    expect(res.body.organizationId).toBeUndefined();
  });

  it('uses user_id fallback when sub is missing', async () => {
    const { protect } = await importAuthWithHs256();
    const token = signToken({ user_id: 'uid-fallback', roles: [] });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.body.id).toBe('uid-fallback');
  });

  it('extracts name, picture, emailVerified from token', async () => {
    const { protect } = await importAuthWithHs256();
    const token = signToken({ sub: 'u9', name: 'Alice', picture: 'https://img.com/a.png', emailVerified: true, roles: [] });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.body.name).toBe('Alice');
    expect(res.body.picture).toBe('https://img.com/a.png');
    expect(res.body.emailVerified).toBe(true);
  });

  it('handles comma-separated role string', async () => {
    const { protect } = await importAuthWithHs256();
    const token = signToken({ sub: 'u10', roles: 'lawyer,admin' });

    const app = express();
    app.get('/t', protect, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.body.roles).toContain('lawyer');
    expect(res.body.roles).toContain('admin');
  });
});

// ── Lines 185-202: protect JWT path (toUser, blacklist, next) ─────────────
describe('auth.ts — protect JWT path (lines 185-202)', () => {
  it('returns 401 when token has no subject', async () => {
    const { protect } = await importAuthWithHs256();
    const token = signToken({ roles: [] }); // no sub, no user_id, no uid

    const app = express();
    app.get('/t', protect, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/no subject/i);
  });

  it('returns 401 when JTI is blacklisted', async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.NODE_ENV = 'test';
    delete process.env.AUTH_JWKS_URI;
    delete process.env.AUTH_ISSUER;

    setupMocks();
    vi.doMock('../../lib/redis.js', () => ({ isBlacklisted: vi.fn().mockResolvedValue(true) }));
    vi.doMock('../../prisma.js', () => ({ default: {} }));

    const { protect } = await import('../auth.js');
    const token = signToken({ sub: 'u-bl', jti: 'revoked-jti', roles: [] });

    const app = express();
    app.get('/t', protect, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/revoked/i);
  });
});

// ── Line 239: protect — no auth header ────────────────────────────────────
describe('auth.ts — protect no auth (line 239)', () => {
  it('returns 401 when no Authorization header or API key', async () => {
    const { protect } = await importAuthWithHs256();

    const app = express();
    app.get('/t', protect, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/missing bearer/i);
  });
});

// ── Lines 247-259: optionalAuth ───────────────────────────────────────────
describe('auth.ts — optionalAuth (lines 247-259)', () => {
  it('passes through when no token is present', async () => {
    const { optionalAuth } = await importAuthWithHs256();

    const app = express();
    app.get('/t', optionalAuth, (req: any, res: any) => res.json({ hasUser: !!req.user }));

    const res = await request(app).get('/t');
    expect(res.status).toBe(200);
    expect(res.body.hasUser).toBe(false);
  });

  it('sets req.user when a valid token is present', async () => {
    const { optionalAuth } = await importAuthWithHs256();
    const token = signToken({ sub: 'opt-u1', roles: ['lawyer'] });

    const app = express();
    app.get('/t', optionalAuth, (req: any, res: any) => res.json(req.user));

    const res = await request(app).get('/t').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('opt-u1');
  });

  it('passes through silently on invalid token', async () => {
    const { optionalAuth } = await importAuthWithHs256();

    const app = express();
    app.get('/t', optionalAuth, (req: any, res: any) => res.json({ hasUser: !!req.user }));

    const res = await request(app).get('/t').set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(200);
    expect(res.body.hasUser).toBe(false);
  });
});

// ── Lines 262-271: requireEmailVerified ────────────────────────────────────
describe('auth.ts — requireEmailVerified (lines 262-271)', () => {
  it('returns 401 when no user', async () => {
    const { requireEmailVerified } = await importAuthWithHs256();

    const app = express();
    app.get('/t', requireEmailVerified, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t');
    expect(res.status).toBe(401);
  });

  it('returns 403 when emailVerified is false', async () => {
    const { requireEmailVerified } = await importAuthWithHs256();

    const app = express();
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'u', emailVerified: false }; next(); });
    app.get('/t', requireEmailVerified, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('email_not_verified');
  });

  it('passes when emailVerified is true', async () => {
    const { requireEmailVerified } = await importAuthWithHs256();

    const app = express();
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'u', emailVerified: true }; next(); });
    app.get('/t', requireEmailVerified, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t');
    expect(res.status).toBe(200);
  });
});

// ── Lines 274-287: requireRole ────────────────────────────────────────────
describe('auth.ts — requireRole (lines 274-287)', () => {
  it('returns 401 when no user', async () => {
    const { requireRole } = await importAuthWithHs256();

    const app = express();
    app.get('/t', requireRole('ADMIN'), (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user lacks required role', async () => {
    const { requireRole } = await importAuthWithHs256();

    const app = express();
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'u', roles: ['MEMBER'] }; next(); });
    app.get('/t', requireRole('ADMIN'), (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/insufficient/i);
  });

  it('passes when user has required role', async () => {
    const { requireRole } = await importAuthWithHs256();

    const app = express();
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'u', roles: ['ADMIN'] }; next(); });
    app.get('/t', requireRole('ADMIN'), (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t');
    expect(res.status).toBe(200);
  });

  it('passes when user has one of multiple required roles', async () => {
    const { requireRole } = await importAuthWithHs256();

    const app = express();
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'u', roles: ['LAWYER'] }; next(); });
    app.get('/t', requireRole('ADMIN', 'LAWYER'), (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/t');
    expect(res.status).toBe(200);
  });
});
