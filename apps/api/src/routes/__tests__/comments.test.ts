import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret-key-for-testing-minimum-32!!';
process.env.NODE_ENV = 'test';

vi.mock('../../config.js', () => ({
  app: { env: 'test', port: 3333 },
  db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
  s3: { region: 'us-east-1', bucket: 'test', forcePathStyle: true },
  stripe: {},
  jwt: { secret: 'test-secret-key-for-testing-minimum-32!!' },
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
}));

const mockPrisma = {
  comment: {
    findMany:  vi.fn(),
    findFirst: vi.fn(),
    create:    vi.fn(),
    update:    vi.fn(),
    delete:    vi.fn(),
    count:     vi.fn(),
  },
  matter:          { findFirst: vi.fn() },
  contract:        { findFirst: vi.fn() },
  contractVersion: { findFirst: vi.fn() },
  document:        { findFirst: vi.fn() },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

// Passthrough so existing assertions see the exact string they send.
// XSS stripping is unit-tested in sanitize.test.ts.
vi.mock('../../lib/sanitize.js', () => ({
  sanitizeMarkdown: (s: string) => s,
}));

const { default: router } = await import('../comments.js');

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

const sampleComment = {
  id:             'comment-1',
  organizationId: 'org-1',
  authorId:       'user-1',
  matterId:       'matter-1',
  contractId:     null,
  documentId:     null,
  bodyMd:         '# Review needed',
  createdAt:      new Date(),
  editedAt:       null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/comments', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).get('/');
    expect(res.status).toBe(403);
  });

  it('returns paginated comments', async () => {
    mockPrisma.comment.findMany.mockResolvedValue([sampleComment]);
    mockPrisma.comment.count.mockResolvedValue(1);
    const res = await request(buildApp()).get('/?matterId=matter-1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('filters by matterId', async () => {
    mockPrisma.comment.findMany.mockResolvedValue([]);
    mockPrisma.comment.count.mockResolvedValue(0);
    await request(buildApp()).get('/?matterId=matter-5');
    expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ matterId: 'matter-5' }) })
    );
  });

  it('filters by contractId', async () => {
    mockPrisma.comment.findMany.mockResolvedValue([]);
    mockPrisma.comment.count.mockResolvedValue(0);
    await request(buildApp()).get('/?contractId=contract-3');
    expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ contractId: 'contract-3' }) })
    );
  });

  it('filters by documentId', async () => {
    mockPrisma.comment.findMany.mockResolvedValue([]);
    mockPrisma.comment.count.mockResolvedValue(0);
    await request(buildApp()).get('/?documentId=doc-7');
    expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ documentId: 'doc-7' }) })
    );
  });

  it('filters by contractVersionId', async () => {
    mockPrisma.comment.findMany.mockResolvedValue([]);
    mockPrisma.comment.count.mockResolvedValue(0);
    await request(buildApp()).get('/?contractVersionId=cv-9');
    expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ contractVersionId: 'cv-9' }) })
    );
  });
});

describe('POST /api/comments', () => {
  it('returns 403 when no org', async () => {
    const res = await request(buildAppNoOrg()).post('/').send({ bodyMd: 'hi', matterId: 'cltest1234567890123456789' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when no resource id provided', async () => {
    const res = await request(buildApp()).post('/').send({ bodyMd: 'hi' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when bodyMd is empty', async () => {
    const res = await request(buildApp()).post('/').send({ bodyMd: '', matterId: 'cltest1234567890123456789' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when matterId does not belong to org (IDOR guard)', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null); // foreign org's matter
    const res = await request(buildApp())
      .post('/')
      .send({ bodyMd: '# Note', matterId: 'cltest1234567890123456789' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/matter not found/i);
  });

  it('returns 404 when contractId does not belong to org (IDOR guard)', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/')
      .send({ bodyMd: 'note', contractId: 'cltest1234567890123456789' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/contract not found/i);
  });

  it('returns 404 when documentId does not belong to org (IDOR guard)', async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/')
      .send({ bodyMd: 'note', documentId: 'cltest1234567890123456789' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/document not found/i);
  });

  it('returns 404 when contractVersionId does not belong to org (IDOR guard)', async () => {
    mockPrisma.contractVersion.findFirst.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/')
      .send({ bodyMd: 'note', contractVersionId: 'cltest1234567890123456789' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/contract version not found/i);
  });

  it('creates comment with authorId and organizationId', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'matter-1' }); // org owns it
    mockPrisma.comment.create.mockResolvedValue({ ...sampleComment });
    const res = await request(buildApp('org-1', 'user-7'))
      .post('/')
      .send({ bodyMd: '# Note', matterId: 'cltest1234567890123456789' });
    expect(res.status).toBe(201);
    expect(mockPrisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorId: 'user-7', organizationId: 'org-1' }),
      })
    );
  });
});

describe('PATCH /api/comments/:id', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).patch('/comment-1').send({ bodyMd: 'x' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when comment not found or not authored by user', async () => {
    mockPrisma.comment.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).patch('/comment-99').send({ bodyMd: 'Updated' });
    expect(res.status).toBe(404);
  });

  it('updates comment body and sets editedAt', async () => {
    mockPrisma.comment.findFirst.mockResolvedValue(sampleComment);
    mockPrisma.comment.update.mockResolvedValue({ ...sampleComment, bodyMd: 'Updated', editedAt: new Date() });
    const res = await request(buildApp()).patch('/comment-1').send({ bodyMd: 'Updated' });
    expect(res.status).toBe(200);
    expect(mockPrisma.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bodyMd: 'Updated', editedAt: expect.any(Date) }),
      })
    );
  });

  it('returns 400 for empty bodyMd', async () => {
    const res = await request(buildApp()).patch('/comment-1').send({ bodyMd: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/comments/:id', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).delete('/comment-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when comment not found', async () => {
    mockPrisma.comment.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).delete('/comment-99');
    expect(res.status).toBe(404);
  });

  it('deletes comment and returns 204', async () => {
    mockPrisma.comment.findFirst.mockResolvedValue(sampleComment);
    mockPrisma.comment.delete.mockResolvedValue(sampleComment);
    const res = await request(buildApp()).delete('/comment-1');
    expect(res.status).toBe(204);
    expect(mockPrisma.comment.delete).toHaveBeenCalledWith({ where: { id: 'comment-1' } });
  });
});

describe('error propagation via next(err)', () => {
  function buildAppWithErrorHandler(orgId = 'org-1') {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'user-1', organizationId: orgId }; next(); });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: err.message }); });
    return app;
  }

  it('GET / propagates DB errors', async () => {
    mockPrisma.comment.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildAppWithErrorHandler()).get('/?contractId=c1');
    expect(res.status).toBe(500);
  });

  it('POST / propagates DB errors', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx' });
    mockPrisma.comment.create.mockRejectedValue(new Error('DB'));
    const res = await request(buildAppWithErrorHandler())
      .post('/').send({ matterId: 'clxxxxxxxxxxxxxxxxxxxx', bodyMd: 'hi' });
    expect(res.status).toBe(500);
  });

  it('PATCH /:id propagates DB errors', async () => {
    mockPrisma.comment.findFirst.mockResolvedValue({ id: 'c1', authorId: 'user-1' });
    mockPrisma.comment.update.mockRejectedValue(new Error('DB'));
    const res = await request(buildAppWithErrorHandler()).patch('/c1').send({ bodyMd: 'x' });
    expect(res.status).toBe(500);
  });

  it('DELETE /:id propagates DB errors', async () => {
    mockPrisma.comment.findFirst.mockResolvedValue({ id: 'c1', authorId: 'user-1' });
    mockPrisma.comment.delete.mockRejectedValue(new Error('DB'));
    const res = await request(buildAppWithErrorHandler()).delete('/c1');
    expect(res.status).toBe(500);
  });
});
