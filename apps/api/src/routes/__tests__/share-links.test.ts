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
  shareLink: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  contract: { findFirst: vi.fn() },
  matter: { findFirst: vi.fn() },
  document: { findFirst: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

vi.mock('../../middleware/auth.js', () => ({
  protect: (_req: any, _res: any, next: any) => next(),
}));

const { router, shareTokenRouter } = await import('../share-links.js');

function buildApp(orgId = 'org-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'user-1', organizationId: orgId };
    next();
  });
  app.use('/', router);
  app.use('/share', shareTokenRouter);
  return app;
}

function buildAppNoOrg() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'user-1' };
    next();
  });
  app.use('/', router);
  app.use('/share', shareTokenRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/share-links', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).get('/');
    expect(res.status).toBe(403);
  });

  it('returns list of share links', async () => {
    const data = [{ id: 'sl-1', token: 'abc', resourceType: 'contract', resourceId: 'c1' }];
    mockPrisma.$transaction.mockResolvedValue([data, 1]);
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('passes resourceType and resourceId filters', async () => {
    mockPrisma.$transaction.mockResolvedValue([[], 0]);
    const res = await request(buildApp()).get('/?resourceType=contract&resourceId=c1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('respects limit and offset parameters', async () => {
    mockPrisma.$transaction.mockResolvedValue([[], 0]);
    const res = await request(buildApp()).get('/?limit=5&offset=10');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
    expect(res.body.offset).toBe(10);
  });
});

describe('POST /api/share-links', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg())
      .post('/')
      .send({ resourceType: 'contract', resourceId: 'clxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid input (missing resourceType)', async () => {
    const res = await request(buildApp())
      .post('/')
      .send({ resourceId: 'clxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 400 for invalid resourceId format', async () => {
    const res = await request(buildApp())
      .post('/')
      .send({ resourceType: 'contract', resourceId: 'not-a-cuid' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when contract resource not found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/')
      .send({ resourceType: 'contract', resourceId: 'clxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Resource not found');
  });

  it('returns 404 when matter resource not found', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/')
      .send({ resourceType: 'matter', resourceId: 'clxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when document resource not found', async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/')
      .send({ resourceType: 'document', resourceId: 'clxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(404);
  });

  it('creates a share link for a contract', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx' });
    const createdLink = {
      id: 'sl-1',
      token: 'abc123',
      resourceType: 'contract',
      resourceId: 'clxxxxxxxxxxxxxxxxxxxx',
      role: 'viewer',
      organizationId: 'org-1',
    };
    mockPrisma.shareLink.create.mockResolvedValue(createdLink);

    const res = await request(buildApp())
      .post('/')
      .send({ resourceType: 'contract', resourceId: 'clxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBe('abc123');
    expect(mockPrisma.shareLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          resourceType: 'contract',
          resourceId: 'clxxxxxxxxxxxxxxxxxxxx',
          role: 'viewer',
        }),
      }),
    );
  });

  it('creates a share link with custom role and expiry', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx' });
    mockPrisma.shareLink.create.mockResolvedValue({ id: 'sl-2', role: 'editor' });

    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const res = await request(buildApp())
      .post('/')
      .send({
        resourceType: 'matter',
        resourceId: 'clxxxxxxxxxxxxxxxxxxxx',
        role: 'editor',
        expiresAt,
      });
    expect(res.status).toBe(201);
  });
});

describe('DELETE /api/share-links/:id', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).delete('/sl-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when share link not found', async () => {
    mockPrisma.shareLink.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).delete('/sl-999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Share link not found');
  });

  it('deletes share link and returns 204', async () => {
    mockPrisma.shareLink.findFirst.mockResolvedValue({ id: 'sl-1', organizationId: 'org-1' });
    mockPrisma.shareLink.delete.mockResolvedValue({});
    const res = await request(buildApp()).delete('/sl-1');
    expect(res.status).toBe(204);
    expect(mockPrisma.shareLink.delete).toHaveBeenCalledWith({ where: { id: 'sl-1' } });
  });
});

describe('GET /share/:token', () => {
  it('returns 404 when token not found', async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue(null);
    const res = await request(buildApp()).get('/share/nonexistent-token');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 410 when share link has expired', async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: 'sl-1',
      token: 'expired-token',
      resourceType: 'contract',
      resourceId: 'c1',
      organizationId: 'org-1',
      role: 'viewer',
      expiresAt: new Date('2020-01-01'),
    });
    const res = await request(buildApp()).get('/share/expired-token');
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('returns 404 when resource no longer exists (contract)', async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: 'sl-1',
      token: 'valid-token',
      resourceType: 'contract',
      resourceId: 'c1',
      organizationId: 'org-1',
      role: 'viewer',
      expiresAt: null,
    });
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).get('/share/valid-token');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no longer exists/i);
  });

  it('returns resource for valid contract share link', async () => {
    const resource = { id: 'c1', title: 'NDA', status: 'DRAFT', createdAt: new Date().toISOString() };
    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: 'sl-1',
      token: 'valid-token',
      resourceType: 'contract',
      resourceId: 'c1',
      organizationId: 'org-1',
      role: 'viewer',
      expiresAt: null,
    });
    mockPrisma.contract.findFirst.mockResolvedValue(resource);

    const res = await request(buildApp()).get('/share/valid-token');
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('contract');
    expect(res.body.role).toBe('viewer');
    expect(res.body.resource.id).toBe('c1');
  });

  it('returns resource for valid matter share link', async () => {
    const resource = { id: 'm1', title: 'Case A', status: 'OPEN', createdAt: new Date().toISOString() };
    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: 'sl-2',
      token: 'matter-token',
      resourceType: 'matter',
      resourceId: 'm1',
      organizationId: 'org-1',
      role: 'commenter',
      expiresAt: null,
    });
    mockPrisma.matter.findFirst.mockResolvedValue(resource);

    const res = await request(buildApp()).get('/share/matter-token');
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('matter');
    expect(res.body.resource.id).toBe('m1');
  });

  it('returns resource for valid document share link', async () => {
    const resource = { id: 'd1', filename: 'doc.pdf', mimeType: 'application/pdf', createdAt: new Date().toISOString() };
    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: 'sl-3',
      token: 'doc-token',
      resourceType: 'document',
      resourceId: 'd1',
      organizationId: 'org-1',
      role: 'editor',
      expiresAt: null,
    });
    mockPrisma.document.findFirst.mockResolvedValue(resource);

    const res = await request(buildApp()).get('/share/doc-token');
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('document');
    expect(res.body.resource.id).toBe('d1');
  });
});
