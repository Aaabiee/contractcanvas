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
  auditLog: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const { default: router } = await import('../audit-logs.js');

function buildApp(orgId = 'org-1', userId = 'user-1', orgRole = 'ADMIN') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: userId, organizationId: orgId, orgRole };
    next();
  });
  app.use('/', router);
  return app;
}

function buildAppNoOrg(orgRole = 'ADMIN') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', orgRole };
    next();
  });
  app.use('/', router);
  return app;
}

function buildAppWithRole(orgRole: string) {
  return buildApp('org-1', 'user-1', orgRole);
}

const sampleLog = {
  id: 'log-1',
  organizationId: 'org-1',
  actorId: 'user-1',
  entity: 'CONTRACT',
  entityId: 'contract-1',
  action: 'CREATE',
  ip: '127.0.0.1',
  userAgent: 'test-agent',
  createdAt: new Date('2026-03-20T10:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

/* ---------- requireAdminOrOwner middleware ---------- */
describe('requireAdminOrOwner middleware', () => {
  it('returns 403 when user role is MEMBER', async () => {
    const app = buildAppWithRole('MEMBER');
    const res = await request(app).get('/');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('returns 403 when user role is undefined', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', organizationId: 'org-1' };
      next();
    });
    app.use('/', router);
    const res = await request(app).get('/');
    expect(res.status).toBe(403);
  });

  it('allows ADMIN role', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildAppWithRole('ADMIN');
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  it('allows OWNER role', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildAppWithRole('OWNER');
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });
});

/* ---------- GET / (list audit logs) ---------- */
describe('GET /', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/organization/i);
  });

  it('returns paginated list of audit logs', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([sampleLog]);
    mockPrisma.auditLog.count.mockResolvedValue(1);
    const app = buildApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(0);
  });

  it('respects limit and offset query params', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildApp();
    const res = await request(app).get('/?limit=10&offset=20');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(20);
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });

  it('caps limit at 100', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildApp();
    const res = await request(app).get('/?limit=500');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
  });

  it('filters by entity query param', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildApp();
    await request(app).get('/?entity=CONTRACT');
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entity: 'CONTRACT' }),
      })
    );
  });

  it('filters by actorId query param', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildApp();
    await request(app).get('/?actorId=user-5');
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ actorId: 'user-5' }),
      })
    );
  });

  it('filters by action query param', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildApp();
    await request(app).get('/?action=DELETE');
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ action: 'DELETE' }),
      })
    );
  });

  it('filters by date range (from and to)', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildApp();
    await request(app).get('/?from=2026-01-01&to=2026-03-31');
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        }),
      })
    );
  });

  it('filters by from only', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildApp();
    await request(app).get('/?from=2026-01-01');
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: expect.any(Date) },
        }),
      })
    );
  });

  it('filters by to only', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildApp();
    await request(app).get('/?to=2026-12-31');
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { lte: expect.any(Date) },
        }),
      })
    );
  });

  it('combines multiple filters', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    const app = buildApp();
    await request(app).get('/?entity=MATTER&action=UPDATE&actorId=user-2');
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          entity: 'MATTER',
          action: 'UPDATE',
          actorId: 'user-2',
        }),
      })
    );
  });
});

/* ---------- GET /export.csv ---------- */
describe('GET /export.csv', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/export.csv');
    expect(res.status).toBe(403);
  });

  it('returns CSV with correct headers and content-type', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([sampleLog]);
    const app = buildApp();
    const res = await request(app).get('/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('audit-logs.csv');

    const lines = res.text.split('\r\n');
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + at least 1 data row
    // CSV header row
    expect(lines[0]).toContain('"id"');
    expect(lines[0]).toContain('"organizationId"');
    expect(lines[0]).toContain('"actorId"');
    expect(lines[0]).toContain('"entity"');
    expect(lines[0]).toContain('"action"');
  });

  it('returns only headers row when no data', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app).get('/export.csv');
    expect(res.status).toBe(200);
    const lines = res.text.split('\r\n');
    expect(lines).toHaveLength(1); // header only, no data rows
  });

  it('escapes CSV injection characters', async () => {
    const maliciousLog = {
      ...sampleLog,
      entity: '=cmd|/C calc|D',
      action: '+MALICIOUS',
      ip: '-danger',
      userAgent: '@formula',
    };
    mockPrisma.auditLog.findMany.mockResolvedValue([maliciousLog]);
    const app = buildApp();
    const res = await request(app).get('/export.csv');
    expect(res.status).toBe(200);
    // The escaped values should have a leading single-quote before the injection char
    expect(res.text).toContain("'=cmd");
    expect(res.text).toContain("'+MALICIOUS");
    expect(res.text).toContain("'-danger");
    expect(res.text).toContain("'@formula");
  });

  it('escapes double quotes in values', async () => {
    const logWithQuotes = {
      ...sampleLog,
      userAgent: 'Mozilla "Firefox"',
    };
    mockPrisma.auditLog.findMany.mockResolvedValue([logWithQuotes]);
    const app = buildApp();
    const res = await request(app).get('/export.csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain('""Firefox""');
  });

  it('handles null/undefined values as empty strings', async () => {
    const logWithNulls = {
      ...sampleLog,
      ip: null,
      userAgent: undefined,
    };
    mockPrisma.auditLog.findMany.mockResolvedValue([logWithNulls]);
    const app = buildApp();
    const res = await request(app).get('/export.csv');
    expect(res.status).toBe(200);
    // null/undefined should produce empty quoted strings
    expect(res.text).toContain('""');
  });

  it('respects limit, offset, and filters for export', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    const app = buildApp();
    await request(app).get('/export.csv?limit=25&offset=5&entity=CONTRACT');
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', entity: 'CONTRACT' }),
        skip: 5,
        take: 25,
      })
    );
  });
});

/* ---------- error propagation via next(err) ---------- */
describe('error propagation via next(err)', () => {
  function buildWithErrHandler(orgId = 'org-1', orgRole = 'ADMIN') {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', organizationId: orgId, orgRole };
      next();
    });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: err.message }); });
    return app;
  }

  it('GET / propagates DB errors', async () => {
    mockPrisma.auditLog.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/');
    expect(res.status).toBe(500);
  });

  it('GET /export.csv propagates DB errors', async () => {
    mockPrisma.auditLog.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/export.csv');
    expect(res.status).toBe(500);
  });
});
