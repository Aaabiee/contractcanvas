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
  matter:   { findMany: vi.fn() },
  contract: { findMany: vi.fn() },
  document: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const { default: router } = await import('../search.js');

function buildApp(orgId = 'org-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'user-1', organizationId: orgId };
    next();
  });
  app.use('/', router);
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
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset all mock implementations (clearAllMocks only clears calls/results, not implementations)
  mockPrisma.matter.findMany.mockReset();
  mockPrisma.contract.findMany.mockReset();
  mockPrisma.document.findMany.mockReset();
  mockPrisma.$queryRaw.mockReset();
});

describe('GET /api/search', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).get('/?q=test');
    expect(res.status).toBe(403);
  });

  it('returns 400 when q is missing', async () => {
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(400);
  });

  it('returns 400 when q is empty', async () => {
    const res = await request(buildApp()).get('/?q=');
    expect(res.status).toBe(400);
  });

  it('returns search results using ILIKE fallback', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('no tsvector'));
    mockPrisma.matter.findMany.mockResolvedValue([{ id: 'm1', title: 'Test Matter', status: 'OPEN' }]);
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.document.findMany.mockResolvedValue([]);

    const res = await request(buildApp()).get('/?q=test&mode=like');
    expect(res.status).toBe(200);
    expect(res.body.q).toBe('test');
    expect(res.body.total).toBe(1);
    expect(res.body.matters).toHaveLength(1);
    expect(res.body.contracts).toHaveLength(0);
    expect(res.body.documents).toHaveLength(0);
  });

  it('returns empty results when nothing matches', async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.document.findMany.mockResolvedValue([]);

    const res = await request(buildApp()).get('/?q=nonexistent&mode=like');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('respects limit parameter', async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.document.findMany.mockResolvedValue([]);

    const res = await request(buildApp()).get('/?q=test&limit=5&mode=like');
    expect(res.status).toBe(200);
    expect(mockPrisma.matter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    );
  });

  it('rejects limit above 50', async () => {
    const res = await request(buildApp()).get('/?q=test&limit=999&mode=like');
    expect(res.status).toBe(400);
  });

  it('accepts limit at max boundary (50)', async () => {
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.document.findMany.mockResolvedValue([]);

    const res = await request(buildApp()).get('/?q=test&limit=50&mode=like');
    expect(res.status).toBe(200);
    expect(mockPrisma.matter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it('propagates errors via next()', async () => {
    mockPrisma.matter.findMany.mockRejectedValue(new Error('DB error'));
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'u1', organizationId: 'org-1' }; next(); });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: err.message }));

    const res = await request(app).get('/?q=test&mode=like');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/search — FTS mode', () => {
  it('uses FTS when hasTsvector returns true and mode=fts', async () => {
    // The first $queryRaw call checks for tsvector column existence
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ '1': 1 }]);
    // The next three $queryRaw calls are the FTS queries
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'm1', title: 'FTS Matter', description: 'desc', status: 'OPEN', createdAt: new Date() }]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'c1', title: 'FTS Contract', status: 'DRAFT', matterId: 'm1', createdAt: new Date() }]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get('/?q=test&mode=fts');
    expect(res.status).toBe(200);
    expect(res.body.matters).toHaveLength(1);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.documents).toHaveLength(0);
    expect(res.body.total).toBe(2);
  });

  it('returns empty results when query becomes empty after special char stripping (FTS)', async () => {
    // hasTsvector is already cached as true from previous test
    const res = await request(buildApp()).get('/?q=!!!&mode=fts');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.matters).toHaveLength(0);
    expect(res.body.contracts).toHaveLength(0);
    expect(res.body.documents).toHaveLength(0);
  });

  it('uses FTS with multi-word query (toTsQuery joins with &)', async () => {
    // useFts is cached as true from first FTS test
    // Set up 3 $queryRaw calls for the FTS queries
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'm1', title: 'Test Matter', description: 'd', status: 'OPEN', createdAt: new Date() }]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get('/?q=hello%20world&mode=fts');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('defaults to fts mode when mode param not specified', async () => {
    // useFts is cached as true
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get('/?q=test');
    expect(res.status).toBe(200);
    // Should use FTS path (no findMany calls on prisma models)
    expect(mockPrisma.matter.findMany).not.toHaveBeenCalled();
  });
});
