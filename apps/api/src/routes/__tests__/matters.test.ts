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
  matter: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const { router } = await import('../matters.js');

function buildApp(orgId = 'org-1', userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: userId, organizationId: orgId };
    next();
  });
  app.use('/', router);
  return app;
}

function buildAppNoOrg() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1' };
    next();
  });
  app.use('/', router);
  return app;
}

const sampleMatter = {
  id: 'matter-1',
  title: 'Test Matter',
  description: 'A test matter',
  status: 'OPEN',
  organizationId: 'org-1',
  ownerId: 'user-1',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/matters', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/organization/i);
  });

  it('returns list of matters for the organization', async () => {
    mockPrisma.matter.findMany.mockResolvedValue([sampleMatter]);
    mockPrisma.matter.count.mockResolvedValue(1);
    const app = buildApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('matter-1');
    expect(res.body.total).toBe(1);
  });

  it('passes status filter to prisma query', async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.matter.count.mockResolvedValue(0);
    const app = buildApp();
    await request(app).get('/?status=CLOSED');
    expect(mockPrisma.matter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'CLOSED' }),
      })
    );
  });

  it('always filters by organizationId and deletedAt: null', async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.matter.count.mockResolvedValue(0);
    const app = buildApp('org-42');
    await request(app).get('/');
    expect(mockPrisma.matter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-42', deletedAt: null }),
      })
    );
  });
});

describe('GET /api/matters/:id', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/matter-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when matter not found', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/matter-999');
    expect(res.status).toBe(404);
  });

  it('returns the matter when found', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(sampleMatter);
    const app = buildApp();
    const res = await request(app).get('/matter-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('matter-1');
  });

  it('scopes lookup to organizationId', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    const app = buildApp('org-77');
    await request(app).get('/matter-1');
    expect(mockPrisma.matter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'matter-1', organizationId: 'org-77', deletedAt: null }),
      })
    );
  });
});

describe('POST /api/matters', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).post('/').send({ title: 'New Matter' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing title', async () => {
    const app = buildApp();
    const res = await request(app).post('/').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('creates a matter with correct organizationId and ownerId', async () => {
    mockPrisma.matter.create.mockResolvedValue({ ...sampleMatter, title: 'New Matter' });
    const app = buildApp('org-1', 'user-5');
    const res = await request(app).post('/').send({ title: 'New Matter', status: 'OPEN' });
    expect(res.status).toBe(201);
    expect(mockPrisma.matter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', ownerId: 'user-5', title: 'New Matter' }),
      })
    );
  });

  it('returns 400 for invalid status enum', async () => {
    const app = buildApp();
    const res = await request(app).post('/').send({ title: 'T', status: 'INVALID_STATUS' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/matters/:id', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).patch('/matter-1').send({ title: 'Updated' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when matter not found in org', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).patch('/matter-999').send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('updates and returns the matter', async () => {
    const updated = { ...sampleMatter, title: 'Updated Title' };
    mockPrisma.matter.findFirst.mockResolvedValue(sampleMatter);
    mockPrisma.matter.update.mockResolvedValue(updated);
    const app = buildApp();
    const res = await request(app).patch('/matter-1').send({ title: 'Updated Title' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
  });

  it('returns 400 for invalid status in patch', async () => {
    const app = buildApp();
    const res = await request(app).patch('/matter-1').send({ status: 'BOGUS' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/matters/:id', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).delete('/matter-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when matter not found in org', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).delete('/matter-999');
    expect(res.status).toBe(404);
  });

  it('soft-deletes the matter and returns 204', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(sampleMatter);
    mockPrisma.matter.update.mockResolvedValue({ ...sampleMatter, deletedAt: new Date() });
    const app = buildApp();
    const res = await request(app).delete('/matter-1');
    expect(res.status).toBe(204);
    expect(mockPrisma.matter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) })
    );
  });
});

describe('error propagation via next(err)', () => {
  function buildWithErrHandler(orgId = 'org-1') {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'user-1', organizationId: orgId }; next(); });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: err.message }); });
    return app;
  }

  it('GET / propagates DB errors', async () => {
    mockPrisma.matter.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/');
    expect(res.status).toBe(500);
  });

  it('POST / propagates DB errors', async () => {
    mockPrisma.matter.create.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).post('/').send({ title: 'T', status: 'OPEN' });
    expect(res.status).toBe(500);
  });

  it('GET /:id propagates DB errors', async () => {
    mockPrisma.matter.findFirst.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/m1');
    expect(res.status).toBe(500);
  });

  it('PATCH /:id propagates DB errors', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'm1' });
    mockPrisma.matter.update.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).patch('/m1').send({ status: 'CLOSED' });
    expect(res.status).toBe(500);
  });

  it('DELETE /:id propagates DB errors', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'm1' });
    mockPrisma.matter.update.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).delete('/m1');
    expect(res.status).toBe(500);
  });
});
