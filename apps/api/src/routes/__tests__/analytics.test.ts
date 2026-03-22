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
  matter: {
    groupBy: vi.fn(),
  },
  contract: {
    groupBy: vi.fn(),
  },
  task: {
    count: vi.fn(),
  },
  document: {
    aggregate: vi.fn(),
  },
  organizationMember: {
    count: vi.fn(),
  },
  $queryRaw: vi.fn(),
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const { router } = await import('../analytics.js');

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

function buildAppWithRole(orgRole: string) {
  return buildApp('org-1', 'user-1', orgRole);
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ---------- GET /overview ---------- */
describe('GET /overview', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/overview');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/organization/i);
  });

  it('returns 403 when user is not ADMIN or OWNER', async () => {
    const app = buildAppWithRole('MEMBER');
    const res = await request(app).get('/overview');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('allows OWNER role', async () => {
    mockPrisma.matter.groupBy.mockResolvedValue([]);
    mockPrisma.contract.groupBy.mockResolvedValue([]);
    mockPrisma.task.count.mockResolvedValue(0);
    mockPrisma.document.aggregate.mockResolvedValue({ _count: { id: 0 }, _sum: { sizeBytes: null } });
    mockPrisma.organizationMember.count.mockResolvedValue(1);

    const app = buildAppWithRole('OWNER');
    const res = await request(app).get('/overview');
    expect(res.status).toBe(200);
  });

  it('allows ADMIN role', async () => {
    mockPrisma.matter.groupBy.mockResolvedValue([]);
    mockPrisma.contract.groupBy.mockResolvedValue([]);
    mockPrisma.task.count.mockResolvedValue(0);
    mockPrisma.document.aggregate.mockResolvedValue({ _count: { id: 0 }, _sum: { sizeBytes: null } });
    mockPrisma.organizationMember.count.mockResolvedValue(1);

    const app = buildAppWithRole('ADMIN');
    const res = await request(app).get('/overview');
    expect(res.status).toBe(200);
  });

  it('returns correct overview with populated data', async () => {
    mockPrisma.matter.groupBy.mockResolvedValue([
      { status: 'OPEN', _count: 5 },
      { status: 'ON_HOLD', _count: 2 },
      { status: 'CLOSED', _count: 3 },
    ]);
    mockPrisma.contract.groupBy.mockResolvedValue([
      { status: 'DRAFT', _count: { status: 4 }, _sum: { valueCents: 100000 } },
      { status: 'EXECUTED', _count: { status: 2 }, _sum: { valueCents: 250000 } },
    ]);
    mockPrisma.task.count.mockResolvedValue(7);
    mockPrisma.document.aggregate.mockResolvedValue({ _count: { id: 12 }, _sum: { sizeBytes: 5242880 } });
    mockPrisma.organizationMember.count.mockResolvedValue(8);

    const app = buildApp();
    const res = await request(app).get('/overview');
    expect(res.status).toBe(200);

    // matters
    expect(res.body.matters.open).toBe(5);
    expect(res.body.matters.on_hold).toBe(2);
    expect(res.body.matters.closed).toBe(3);
    expect(res.body.matters.total).toBe(10);

    // contracts
    expect(res.body.contracts.byStatus.DRAFT).toBe(4);
    expect(res.body.contracts.byStatus.EXECUTED).toBe(2);
    expect(res.body.contracts.byStatus.NEGOTIATION).toBe(0);
    expect(res.body.contracts.totalValueCents).toBe(350000);

    // tasks
    expect(res.body.tasks.overdue).toBe(7);

    // documents
    expect(res.body.documents.count).toBe(12);
    expect(res.body.documents.totalSizeBytes).toBe(5242880);

    // members
    expect(res.body.members.active).toBe(8);
  });

  it('returns zero defaults when groupBy returns empty arrays', async () => {
    mockPrisma.matter.groupBy.mockResolvedValue([]);
    mockPrisma.contract.groupBy.mockResolvedValue([]);
    mockPrisma.task.count.mockResolvedValue(0);
    mockPrisma.document.aggregate.mockResolvedValue({ _count: { id: 0 }, _sum: { sizeBytes: null } });
    mockPrisma.organizationMember.count.mockResolvedValue(0);

    const app = buildApp();
    const res = await request(app).get('/overview');
    expect(res.status).toBe(200);
    expect(res.body.matters.total).toBe(0);
    expect(res.body.contracts.totalValueCents).toBe(0);
    expect(res.body.documents.totalSizeBytes).toBe(0);
  });

  it('handles null valueCents in contract groups', async () => {
    mockPrisma.matter.groupBy.mockResolvedValue([]);
    mockPrisma.contract.groupBy.mockResolvedValue([
      { status: 'DRAFT', _count: { status: 1 }, _sum: { valueCents: null } },
    ]);
    mockPrisma.task.count.mockResolvedValue(0);
    mockPrisma.document.aggregate.mockResolvedValue({ _count: { id: 0 }, _sum: { sizeBytes: null } });
    mockPrisma.organizationMember.count.mockResolvedValue(0);

    const app = buildApp();
    const res = await request(app).get('/overview');
    expect(res.status).toBe(200);
    expect(res.body.contracts.totalValueCents).toBe(0);
  });
});

/* ---------- GET /contract-trends ---------- */
describe('GET /contract-trends', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/contract-trends');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/organization/i);
  });

  it('returns 403 when user is not ADMIN or OWNER', async () => {
    const app = buildAppWithRole('MEMBER');
    const res = await request(app).get('/contract-trends');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 400 for invalid period', async () => {
    const app = buildApp();
    const res = await request(app).get('/contract-trends?period=7d');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid period/);
  });

  it('defaults to 30d period when none provided', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app).get('/contract-trends');
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('30d');
  });

  it('accepts 30d period and returns trends', async () => {
    const week = new Date('2026-03-16');
    mockPrisma.$queryRaw.mockResolvedValue([
      { week, count: BigInt(3), totalValueCents: BigInt(50000) },
    ]);
    const app = buildApp();
    const res = await request(app).get('/contract-trends?period=30d');
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('30d');
    expect(res.body.trends).toHaveLength(1);
    expect(res.body.trends[0].count).toBe(3);
    expect(res.body.trends[0].totalValueCents).toBe(50000);
  });

  it('accepts 90d period', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app).get('/contract-trends?period=90d');
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('90d');
  });

  it('accepts 1y period', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app).get('/contract-trends?period=1y');
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('1y');
  });

  it('returns empty trends array when no rows', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app).get('/contract-trends?period=30d');
    expect(res.status).toBe(200);
    expect(res.body.trends).toEqual([]);
  });

  it('converts bigint values to numbers', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { week: new Date('2026-03-02'), count: BigInt(10), totalValueCents: BigInt(999999) },
      { week: new Date('2026-03-09'), count: BigInt(5), totalValueCents: BigInt(123456) },
    ]);
    const app = buildApp();
    const res = await request(app).get('/contract-trends?period=90d');
    expect(res.status).toBe(200);
    expect(res.body.trends).toHaveLength(2);
    expect(typeof res.body.trends[0].count).toBe('number');
    expect(typeof res.body.trends[0].totalValueCents).toBe('number');
    expect(res.body.trends[1].count).toBe(5);
    expect(res.body.trends[1].totalValueCents).toBe(123456);
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

  it('GET /overview propagates DB errors', async () => {
    mockPrisma.matter.groupBy.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/overview');
    expect(res.status).toBe(500);
  });

  it('GET /contract-trends propagates DB errors', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/contract-trends?period=30d');
    expect(res.status).toBe(500);
  });
});
