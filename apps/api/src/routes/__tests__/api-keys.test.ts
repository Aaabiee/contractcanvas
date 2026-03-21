import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.NODE_ENV = 'test';

vi.mock('../../config.js', () => ({
  app: { env: 'test', port: 3333 },
  db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
  s3: { region: 'us-east-1', bucket: 'test', forcePathStyle: true },
  stripe: {},
  jwt: { secret: 'test-secret-key-for-testing' },
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
}));

const mockPrisma = {
  apiKey: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

/* The protect middleware calls prisma / jose — stub it so requests pass through */
vi.mock('../../middleware/auth.js', () => ({
  protect: (_req: any, _res: any, next: any) => next(),
}));

const { router } = await import('../api-keys.js');

function buildApp(orgId = 'org-1', userId = 'user-1', orgRole = 'ADMIN') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = {
      id: userId,
      organizationId: orgId,
      orgRole,
      organizations: [{ id: orgId, role: orgRole }],
    };
    next();
  });
  /* The router uses mergeParams to read :orgId from parent — mount at /:orgId/api-keys */
  app.use('/:orgId/api-keys', router);
  return app;
}

function buildAppNoUser() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    /* req.user is undefined — should fail orgAccess check */
    next();
  });
  app.use('/:orgId/api-keys', router);
  return app;
}

function buildAppMismatchOrg() {
  /* User belongs to org-1 but the URL will target org-OTHER */
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = {
      id: 'user-1',
      organizationId: 'org-1',
      orgRole: 'ADMIN',
      organizations: [{ id: 'org-1', role: 'ADMIN' }],
    };
    next();
  });
  app.use('/:orgId/api-keys', router);
  return app;
}

function buildAppWithRole(orgId: string, orgRole: string) {
  return buildApp(orgId, 'user-1', orgRole);
}

const sampleKey = {
  id: 'key-1',
  name: 'My Key',
  prefix: 'cc_live_xxxxxxxx',
  lastUsedAt: null,
  createdAt: new Date(),
  revokedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

/* ---------- requireOrgAccess guard ---------- */
describe('requireOrgAccess guard', () => {
  it('returns 403 when req.user is undefined', async () => {
    const app = buildAppNoUser();
    const res = await request(app).get('/org-1/api-keys/');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 403 when user.organizationId does not match URL orgId', async () => {
    const app = buildAppMismatchOrg();
    const res = await request(app).get('/org-OTHER/api-keys/');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 403 when user role is MEMBER (not OWNER/ADMIN)', async () => {
    const app = buildAppWithRole('org-1', 'MEMBER');
    const res = await request(app).get('/org-1/api-keys/');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

/* ---------- GET / (list keys) ---------- */
describe('GET /:orgId/api-keys', () => {
  it('returns list of active API keys', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([sampleKey]);
    const app = buildApp();
    const res = await request(app).get('/org-1/api-keys/');
    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0].id).toBe('key-1');
  });

  it('returns empty array when no keys exist', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app).get('/org-1/api-keys/');
    expect(res.status).toBe(200);
    expect(res.body.keys).toEqual([]);
  });

  it('queries with correct organizationId and revokedAt filter', async () => {
    mockPrisma.apiKey.findMany.mockResolvedValue([]);
    const app = buildApp();
    await request(app).get('/org-1/api-keys/');
    expect(mockPrisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', revokedAt: null },
        orderBy: { createdAt: 'desc' },
      })
    );
  });
});

/* ---------- POST / (create key) ---------- */
describe('POST /:orgId/api-keys', () => {
  it('creates an API key and returns 201 with rawKey', async () => {
    mockPrisma.apiKey.create.mockResolvedValue(sampleKey);
    const app = buildApp();
    const res = await request(app).post('/org-1/api-keys/').send({ name: 'My Key' });
    expect(res.status).toBe(201);
    expect(res.body.key).toBeDefined();
    expect(res.body.key.rawKey).toBeDefined();
    expect(res.body.key.rawKey).toMatch(/^cc_live_/);
  });

  it('returns 400 for missing name', async () => {
    const app = buildApp();
    const res = await request(app).post('/org-1/api-keys/').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 400 for empty name', async () => {
    const app = buildApp();
    const res = await request(app).post('/org-1/api-keys/').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 400 for name exceeding 120 characters', async () => {
    const app = buildApp();
    const res = await request(app).post('/org-1/api-keys/').send({ name: 'x'.repeat(121) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 403 when org access fails', async () => {
    const app = buildAppMismatchOrg();
    const res = await request(app).post('/org-OTHER/api-keys/').send({ name: 'Test' });
    expect(res.status).toBe(403);
  });

  it('passes correct data to prisma.apiKey.create', async () => {
    mockPrisma.apiKey.create.mockResolvedValue(sampleKey);
    const app = buildApp();
    await request(app).post('/org-1/api-keys/').send({ name: 'Prod Key' });
    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          name: 'Prod Key',
          hashedKey: expect.any(String),
          prefix: expect.any(String),
        }),
      })
    );
  });
});

/* ---------- DELETE /:keyId (revoke key) ---------- */
describe('DELETE /:orgId/api-keys/:keyId', () => {
  it('revokes an existing key and returns ok', async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValue(sampleKey);
    mockPrisma.apiKey.update.mockResolvedValue({ ...sampleKey, revokedAt: new Date() });
    const app = buildApp();
    const res = await request(app).delete('/org-1/api-keys/key-1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 404 when key not found', async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).delete('/org-1/api-keys/key-999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('API key not found');
  });

  it('soft-revokes by setting revokedAt', async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValue(sampleKey);
    mockPrisma.apiKey.update.mockResolvedValue({ ...sampleKey, revokedAt: new Date() });
    const app = buildApp();
    await request(app).delete('/org-1/api-keys/key-1');
    expect(mockPrisma.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'key-1' },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      })
    );
  });

  it('returns 403 when org access fails', async () => {
    const app = buildAppMismatchOrg();
    const res = await request(app).delete('/org-OTHER/api-keys/key-1');
    expect(res.status).toBe(403);
  });
});

/* ---------- error propagation via next(err) ---------- */
describe('error propagation via next(err)', () => {
  function buildWithErrHandler(orgId = 'org-1') {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = {
        id: 'user-1',
        organizationId: orgId,
        orgRole: 'ADMIN',
        organizations: [{ id: orgId, role: 'ADMIN' }],
      };
      next();
    });
    app.use('/:orgId/api-keys', router);
    app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: err.message }); });
    return app;
  }

  it('GET / propagates DB errors', async () => {
    mockPrisma.apiKey.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/org-1/api-keys/');
    expect(res.status).toBe(500);
  });

  it('POST / propagates DB errors', async () => {
    mockPrisma.apiKey.create.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).post('/org-1/api-keys/').send({ name: 'K' });
    expect(res.status).toBe(500);
  });

  it('DELETE /:keyId propagates DB errors', async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValue(sampleKey);
    mockPrisma.apiKey.update.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).delete('/org-1/api-keys/key-1');
    expect(res.status).toBe(500);
  });
});
