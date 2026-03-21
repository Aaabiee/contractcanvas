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
  organization: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  organizationMember: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const mockRevokeAllUserSessions = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/session.js', () => ({
  revokeAllUserSessions: (...args: any[]) => mockRevokeAllUserSessions(...args),
}));

const { router } = await import('../organizations.js');

function buildApp(userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: userId };
    next();
  });
  app.use('/', router);
  return app;
}

function buildAppNoUser() {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/organizations', () => {
  it('returns 401 when no user', async () => {
    const app = buildAppNoUser();
    const res = await request(app).post('/').send({ name: 'Acme', slug: 'acme' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing name', async () => {
    const app = buildApp();
    const res = await request(app).post('/').send({ slug: 'acme' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid slug (uppercase)', async () => {
    const app = buildApp();
    const res = await request(app).post('/').send({ name: 'Acme', slug: 'Acme-Corp' });
    expect(res.status).toBe(400);
  });

  it('creates org and member in transaction', async () => {
    const newOrg = { id: 'org-1', name: 'Acme', slug: 'acme' };
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        organization: { create: vi.fn().mockResolvedValue(newOrg) },
        organizationMember: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    const app = buildApp();
    const res = await request(app).post('/').send({ name: 'Acme', slug: 'acme' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('org-1');
  });

  it('returns 409 when slug is already taken (P2002)', async () => {
    const err: any = new Error('Unique constraint failed');
    err.code = 'P2002';
    err.meta = { target: ['slug'] };
    mockPrisma.$transaction.mockRejectedValue(err);

    const { PrismaClientKnownRequestError } = await import('@prisma/client/runtime/library');
    const prismaErr = Object.create(PrismaClientKnownRequestError.prototype);
    Object.assign(prismaErr, { code: 'P2002', meta: { target: ['slug'] }, message: 'Unique' });

    mockPrisma.$transaction.mockRejectedValue(prismaErr);
    const app = buildApp();
    const res = await request(app).post('/').send({ name: 'Acme', slug: 'acme' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/organizations/me', () => {
  it('returns 401 when no user', async () => {
    const app = buildAppNoUser();
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
  });

  it('returns list of active orgs for the current user', async () => {
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      { role: 'OWNER', organization: { id: 'org-1', name: 'Acme', slug: 'acme', deletedAt: null } },
      { role: 'MEMBER', organization: { id: 'org-2', name: 'Beta', slug: 'beta', deletedAt: new Date() } },
    ]);
    const app = buildApp();
    const res = await request(app).get('/me');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('org-1');
    expect(res.body[0].userRole).toBe('OWNER');
  });

  it('filters out soft-deleted organizations', async () => {
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      { role: 'MEMBER', organization: { id: 'org-del', name: 'Gone', slug: 'gone', deletedAt: new Date() } },
    ]);
    const app = buildApp();
    const res = await request(app).get('/me');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe('GET /api/organizations/:orgId/members', () => {
  it('returns 401 when no user', async () => {
    const app = buildAppNoUser();
    const res = await request(app).get('/org-1/members');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not a member', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/org-1/members');
    expect(res.status).toBe(403);
  });

  it('returns members when user is a member', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      { id: 'm1', role: 'OWNER', user: { id: 'user-1', email: 'a@b.com', name: 'A', avatarUrl: null } },
    ]);
    const app = buildApp();
    const res = await request(app).get('/org-1/members');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('POST /api/organizations/:orgId/members', () => {
  it('returns 403 when user is not admin/owner', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    const app = buildApp();
    const res = await request(app)
      .post('/org-1/members')
      .send({ userId: 'clxxxxxxxxxxxxxxxxxxxx', role: 'MEMBER' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when target user does not exist', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/org-1/members')
      .send({ userId: 'clxxxxxxxxxxxxxxxxxxxx', role: 'MEMBER' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user/i);
  });

  it('adds member when requester is admin', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    mockPrisma.organizationMember.create.mockResolvedValue({
      id: 'm-new',
      organizationId: 'org-1',
      userId: 'user-2',
      role: 'MEMBER',
      user: { id: 'user-2', email: 'b@c.com', name: 'B' },
    });
    const app = buildApp();
    const res = await request(app)
      .post('/org-1/members')
      .send({ userId: 'clxxxxxxxxxxxxxxxxxxxx', role: 'MEMBER' });
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/organizations/:orgId/members/:memberId', () => {
  it('returns 403 when requester is not admin/owner', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    const app = buildApp();
    const res = await request(app).patch('/org-1/members/m1').send({ role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid role', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    const app = buildApp();
    const res = await request(app).patch('/org-1/members/m1').send({ role: 'SUPERUSER' });
    expect(res.status).toBe(400);
  });

  it('updates member role when requester is owner', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    mockPrisma.organizationMember.update.mockResolvedValue({
      id: 'm1',
      role: 'ADMIN',
      user: { id: 'user-2', email: 'b@c.com', name: 'B' },
    });
    const app = buildApp();
    const res = await request(app).patch('/org-1/members/m1').send({ role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ADMIN');
  });
});

describe('POST /api/organizations/:orgId/members — 401 when no user', () => {
  it('returns 401 when user is not authenticated', async () => {
    const app = buildAppNoUser();
    const res = await request(app).post('/org-1/members').send({ userId: 'clxxxxxxxxxxxxxxxxxxxx', role: 'MEMBER' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid userId (not a cuid)', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    const app = buildApp();
    const res = await request(app).post('/org-1/members').send({ userId: 'not-a-cuid', role: 'MEMBER' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when user is already a member (P2002)', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    const { PrismaClientKnownRequestError } = await import('@prisma/client/runtime/library');
    const err = Object.create(PrismaClientKnownRequestError.prototype);
    Object.assign(err, { code: 'P2002', message: 'Unique' });
    mockPrisma.organizationMember.create.mockRejectedValue(err);
    const app = buildApp();
    const res = await request(app).post('/org-1/members').send({ userId: 'clxxxxxxxxxxxxxxxxxxxx', role: 'MEMBER' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already a member/i);
  });

  it('returns 404 when foreign key violation (P2003)', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    const { PrismaClientKnownRequestError } = await import('@prisma/client/runtime/library');
    const err = Object.create(PrismaClientKnownRequestError.prototype);
    Object.assign(err, { code: 'P2003', message: 'Foreign key' });
    mockPrisma.organizationMember.create.mockRejectedValue(err);
    const app = buildApp();
    const res = await request(app).post('/org-1/members').send({ userId: 'clxxxxxxxxxxxxxxxxxxxx', role: 'MEMBER' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/organizations/:orgId/members/:memberId — auth and error paths', () => {
  it('returns 401 when user is not authenticated', async () => {
    const app = buildAppNoUser();
    const res = await request(app).patch('/org-1/members/m1').send({ role: 'ADMIN' });
    expect(res.status).toBe(401);
  });

  it('returns 404 when member not found (P2025)', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    const { PrismaClientKnownRequestError } = await import('@prisma/client/runtime/library');
    const err = Object.create(PrismaClientKnownRequestError.prototype);
    Object.assign(err, { code: 'P2025', message: 'Not found' });
    mockPrisma.organizationMember.update.mockRejectedValue(err);
    const app = buildApp();
    const res = await request(app).patch('/org-1/members/m-nonexistent').send({ role: 'ADMIN' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe('DELETE /api/organizations/:orgId/members/:memberId — auth and error paths', () => {
  it('returns 401 when user is not authenticated', async () => {
    const app = buildAppNoUser();
    const res = await request(app).delete('/org-1/members/m1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when P2025 thrown during delete', async () => {
    mockPrisma.organizationMember.findUnique
      .mockResolvedValueOnce({ id: 'm1', organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' })
      .mockResolvedValueOnce({ role: 'ADMIN' });
    const { PrismaClientKnownRequestError } = await import('@prisma/client/runtime/library');
    const err = Object.create(PrismaClientKnownRequestError.prototype);
    Object.assign(err, { code: 'P2025', message: 'Not found' });
    mockPrisma.organizationMember.delete.mockRejectedValue(err);
    const app = buildApp('user-1');
    const res = await request(app).delete('/org-1/members/m1');
    expect(res.status).toBe(404);
  });
});

describe('error propagation via next(err)', () => {
  function buildAppWithErrorHandler() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'user-1' }; next(); });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: err.message }); });
    return app;
  }

  it('GET /me propagates DB errors', async () => {
    mockPrisma.organizationMember.findMany.mockRejectedValue(new Error('DB error'));
    const res = await request(buildAppWithErrorHandler()).get('/me');
    expect(res.status).toBe(500);
  });

  it('GET /:orgId/members propagates DB errors', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    mockPrisma.organizationMember.findMany.mockRejectedValue(new Error('DB error'));
    const res = await request(buildAppWithErrorHandler()).get('/org-1/members');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/organizations — P2002 with non-slug target', () => {
  it('returns 409 with generic message for non-slug unique constraint', async () => {
    const { PrismaClientKnownRequestError } = await import('@prisma/client/runtime/library');
    const err = Object.create(PrismaClientKnownRequestError.prototype);
    Object.assign(err, { code: 'P2002', meta: { target: ['name'] }, message: 'Unique' });
    mockPrisma.$transaction.mockRejectedValue(err);
    const app = buildApp();
    const res = await request(app).post('/').send({ name: 'Acme', slug: 'acme' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/unique constraint/i);
  });
});

describe('DELETE /api/organizations/:orgId/members/:memberId', () => {
  it('returns 404 when member not found in org', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await request(app).delete('/org-1/members/m-none');
    expect(res.status).toBe(404);
  });

  it('allows user to remove themselves (self-removal)', async () => {
    mockPrisma.organizationMember.findUnique
      .mockResolvedValueOnce({ id: 'm1', organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' })
      .mockResolvedValueOnce({ role: 'MEMBER' });
    mockPrisma.organizationMember.delete.mockResolvedValue({});
    const app = buildApp('user-1');
    const res = await request(app).delete('/org-1/members/m1');
    expect(res.status).toBe(204);
    expect(mockRevokeAllUserSessions).toHaveBeenCalledWith('user-1');
  });

  it('returns 403 when non-admin tries to remove another member', async () => {
    mockPrisma.organizationMember.findUnique
      .mockResolvedValueOnce({ id: 'm2', organizationId: 'org-1', userId: 'user-2', role: 'MEMBER' })
      .mockResolvedValueOnce({ role: 'MEMBER' });
    const app = buildApp('user-1');
    const res = await request(app).delete('/org-1/members/m2');
    expect(res.status).toBe(403);
  });

  it('allows admin to remove another member and revokes their sessions', async () => {
    mockPrisma.organizationMember.findUnique
      .mockResolvedValueOnce({ id: 'm2', organizationId: 'org-1', userId: 'user-2', role: 'MEMBER' })
      .mockResolvedValueOnce({ role: 'ADMIN' });
    mockPrisma.organizationMember.delete.mockResolvedValue({});
    const app = buildApp('user-1');
    const res = await request(app).delete('/org-1/members/m2');
    expect(res.status).toBe(204);
    expect(mockRevokeAllUserSessions).toHaveBeenCalledWith('user-2');
  });
});
