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
  clause: {
    findMany:  vi.fn(),
    findFirst: vi.fn(),
    create:    vi.fn(),
    update:    vi.fn(),
    delete:    vi.fn(),
    count:     vi.fn(),
  },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

// Passthrough spy so existing assertions see the exact string they send.
// XSS stripping is unit-tested in sanitize.test.ts.
vi.mock('../../lib/sanitize.js', () => ({
  sanitizeMarkdown: vi.fn().mockImplementation((s: string) => s),
}));

const { default: router } = await import('../clauses.js');

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

const sampleClause = {
  id:             'clause-1',
  organizationId: 'org-1',
  title:          'Liability Cap',
  bodyMd:         '## Liability\n\nMax liability is **$1M**.',
  tags:           ['liability'],
  isPublic:       false,
  createdAt:      new Date(),
  updatedAt:      new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET / ────────────────────────────────────────────────────────────────────

describe('GET /api/clauses', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).get('/');
    expect(res.status).toBe(403);
  });

  it('returns paginated clauses', async () => {
    mockPrisma.clause.findMany.mockResolvedValue([sampleClause]);
    mockPrisma.clause.count.mockResolvedValue(1);
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('applies search query to title and bodyMd', async () => {
    mockPrisma.clause.findMany.mockResolvedValue([]);
    mockPrisma.clause.count.mockResolvedValue(0);
    await request(buildApp()).get('/?q=liability');
    expect(mockPrisma.clause.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ OR: expect.arrayContaining([
              expect.objectContaining({ title: expect.objectContaining({ contains: 'liability' }) }),
            ]) }),
          ]),
        }),
      })
    );
  });

  it('caps limit at 100', async () => {
    mockPrisma.clause.findMany.mockResolvedValue([]);
    mockPrisma.clause.count.mockResolvedValue(0);
    await request(buildApp()).get('/?limit=999');
    expect(mockPrisma.clause.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });
});

// ── GET /:id ─────────────────────────────────────────────────────────────────

describe('GET /api/clauses/:id', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).get('/clause-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when clause not found', async () => {
    mockPrisma.clause.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).get('/clause-99');
    expect(res.status).toBe(404);
  });

  it('returns the clause when found', async () => {
    mockPrisma.clause.findFirst.mockResolvedValue(sampleClause);
    const res = await request(buildApp()).get('/clause-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('clause-1');
  });
});

// ── POST / ───────────────────────────────────────────────────────────────────

describe('POST /api/clauses', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg())
      .post('/').send({ title: 'T', bodyMd: 'B' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(buildApp()).post('/').send({ title: 'T' });
    expect(res.status).toBe(400);
  });

  it('creates clause and returns 201', async () => {
    mockPrisma.clause.create.mockResolvedValue(sampleClause);
    const res = await request(buildApp())
      .post('/').send({ title: 'Liability Cap', bodyMd: '## Liability', tags: ['liability'] });
    expect(res.status).toBe(201);
    expect(mockPrisma.clause.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Liability Cap', organizationId: 'org-1' }),
      })
    );
  });

  it('passes bodyMd through sanitizeMarkdown before persisting', async () => {
    const { sanitizeMarkdown } = await import('../../lib/sanitize.js');
    mockPrisma.clause.create.mockResolvedValue(sampleClause);
    await request(buildApp()).post('/').send({ title: 'T', bodyMd: '<script>xss</script>' });
    expect(sanitizeMarkdown).toHaveBeenCalledWith('<script>xss</script>');
  });
});

// ── PATCH /:id ───────────────────────────────────────────────────────────────

describe('PATCH /api/clauses/:id', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).patch('/clause-1').send({ bodyMd: 'x' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when clause not found in org', async () => {
    mockPrisma.clause.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).patch('/clause-99').send({ bodyMd: 'x' });
    expect(res.status).toBe(404);
  });

  it('updates clause and returns updated record', async () => {
    const updated = { ...sampleClause, bodyMd: 'Updated body' };
    mockPrisma.clause.findFirst.mockResolvedValue(sampleClause);
    mockPrisma.clause.update.mockResolvedValue(updated);
    const res = await request(buildApp()).patch('/clause-1').send({ bodyMd: 'Updated body' });
    expect(res.status).toBe(200);
    expect(res.body.bodyMd).toBe('Updated body');
  });

  it('passes bodyMd through sanitizeMarkdown on update', async () => {
    const { sanitizeMarkdown } = await import('../../lib/sanitize.js');
    mockPrisma.clause.findFirst.mockResolvedValue(sampleClause);
    mockPrisma.clause.update.mockResolvedValue(sampleClause);
    await request(buildApp()).patch('/clause-1').send({ bodyMd: '<img src=x onerror=alert(1)>' });
    expect(sanitizeMarkdown).toHaveBeenCalledWith('<img src=x onerror=alert(1)>');
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('DELETE /api/clauses/:id', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).delete('/clause-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when clause not found', async () => {
    mockPrisma.clause.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).delete('/clause-99');
    expect(res.status).toBe(404);
  });

  it('deletes clause and returns 204', async () => {
    mockPrisma.clause.findFirst.mockResolvedValue(sampleClause);
    mockPrisma.clause.delete.mockResolvedValue(sampleClause);
    const res = await request(buildApp()).delete('/clause-1');
    expect(res.status).toBe(204);
    expect(mockPrisma.clause.delete).toHaveBeenCalledWith({ where: { id: 'clause-1' } });
  });
});

// ── Error propagation via next(error) ────────────────────────────────────────

describe('error propagation via next(error)', () => {
  function buildAppWithErrorHandler(orgId = 'org-1') {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', organizationId: orgId };
      next();
    });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: err.message });
    });
    return app;
  }

  it('GET / propagates DB errors via next()', async () => {
    mockPrisma.clause.findMany.mockRejectedValue(new Error('DB failure'));
    const res = await request(buildAppWithErrorHandler()).get('/');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB failure');
  });

  it('GET /:id propagates DB errors via next()', async () => {
    mockPrisma.clause.findFirst.mockRejectedValue(new Error('DB failure'));
    const res = await request(buildAppWithErrorHandler()).get('/clause-1');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB failure');
  });

  it('POST / propagates DB errors via next()', async () => {
    mockPrisma.clause.create.mockRejectedValue(new Error('DB failure'));
    const res = await request(buildAppWithErrorHandler())
      .post('/')
      .send({ title: 'T', bodyMd: 'B' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB failure');
  });

  it('PATCH /:id propagates DB errors via next()', async () => {
    mockPrisma.clause.findFirst.mockResolvedValue(sampleClause);
    mockPrisma.clause.update.mockRejectedValue(new Error('DB failure'));
    const res = await request(buildAppWithErrorHandler())
      .patch('/clause-1')
      .send({ bodyMd: 'updated' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB failure');
  });

  it('DELETE /:id propagates DB errors via next()', async () => {
    mockPrisma.clause.findFirst.mockResolvedValue(sampleClause);
    mockPrisma.clause.delete.mockRejectedValue(new Error('DB failure'));
    const res = await request(buildAppWithErrorHandler()).delete('/clause-1');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB failure');
  });
});
