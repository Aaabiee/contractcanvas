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
  contract: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  contractVersion: {
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
  matter: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const mockWebhookAdd = vi.fn().mockResolvedValue(undefined);
vi.mock('../../queues/index.js', () => ({
  webhookQueue: { add: mockWebhookAdd },
  emailQueue: null,
  pdfQueue: null,
  cleanupQueue: null,
}));

const { router } = await import('../contracts.js');

function buildApp(orgId = 'org-1', userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: userId, organizationId: orgId };
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

const sampleContract = {
  id: 'contract-1',
  title: 'Service Agreement',
  matterId: 'matter-1',
  organizationId: 'org-1',
  status: 'DRAFT',
  valueCents: null,
  currency: 'usd',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  currentVersionId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/contracts', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/');
    expect(res.status).toBe(403);
  });

  it('returns list of contracts', async () => {
    mockPrisma.contract.findMany.mockResolvedValue([sampleContract]);
    mockPrisma.contract.count.mockResolvedValue(1);
    const app = buildApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('filters by matterId when provided', async () => {
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.contract.count.mockResolvedValue(0);
    const app = buildApp();
    await request(app).get('/?matterId=matter-1');
    expect(mockPrisma.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ matterId: 'matter-1' }),
      })
    );
  });

  it('filters by status when provided', async () => {
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.contract.count.mockResolvedValue(0);
    const app = buildApp();
    await request(app).get('/?status=DRAFT');
    expect(mockPrisma.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'DRAFT' }),
      })
    );
  });
});

describe('POST /api/contracts', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).post('/').send({ title: 'T', matterId: 'c1234567890123456789012' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing title', async () => {
    const app = buildApp();
    const res = await request(app).post('/').send({ matterId: 'c1234567890123456789012' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid matterId (not cuid)', async () => {
    const app = buildApp();
    const res = await request(app).post('/').send({ title: 'Agreement', matterId: 'not-a-cuid' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when matter does not belong to org', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ title: 'Agreement', matterId: 'clxxxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Matter not found');
  });

  it('creates contract when matter belongs to org', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'matter-1' });
    mockPrisma.contract.create.mockResolvedValue(sampleContract);
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ title: 'Service Agreement', matterId: 'clxxxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(201);
    expect(mockPrisma.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', title: 'Service Agreement' }),
      })
    );
  });
});

describe('GET /api/contracts/:id', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/contract-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when contract not found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/contract-999');
    expect(res.status).toBe(404);
  });

  it('returns contract with related data', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(sampleContract);
    const app = buildApp();
    const res = await request(app).get('/contract-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('contract-1');
  });
});

describe('PATCH /api/contracts/:id', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).patch('/contract-1').send({ title: 'Updated' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when contract not found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).patch('/contract-999').send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status', async () => {
    const app = buildApp();
    const res = await request(app).patch('/contract-1').send({ status: 'BOGUS' });
    expect(res.status).toBe(400);
  });

  it('updates and returns the contract', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(sampleContract);
    mockPrisma.contract.update.mockResolvedValue({ ...sampleContract, title: 'Updated' });
    const app = buildApp();
    const res = await request(app).patch('/contract-1').send({ title: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated');
  });
});

describe('DELETE /api/contracts/:id', () => {
  it('returns 404 when contract not found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).delete('/contract-999');
    expect(res.status).toBe(404);
  });

  it('soft-deletes contract and returns 204', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(sampleContract);
    mockPrisma.contract.update.mockResolvedValue({ ...sampleContract, deletedAt: new Date() });
    const app = buildApp();
    const res = await request(app).delete('/contract-1');
    expect(res.status).toBe(204);
    expect(mockPrisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) })
    );
  });
});

describe('POST /api/contracts/:contractId/versions', () => {
  it('returns 404 when contract not found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/contract-999/versions')
      .send({ storageKey: 'orgs/org-1/matters/m1/file.pdf' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing storageKey', async () => {
    const app = buildApp();
    const res = await request(app).post('/contract-1/versions').send({});
    expect(res.status).toBe(400);
  });

  it('creates version via transaction with auto-incremented number', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(sampleContract);
    const mockVersion = { id: 'v1', contractId: 'contract-1', number: 1, storageKey: 'key' };
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        contractVersion: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(mockVersion),
        },
        contract: { update: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    const app = buildApp();
    const res = await request(app)
      .post('/contract-1/versions')
      .send({ storageKey: 'orgs/org-1/matters/m1/file.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.number).toBe(1);
  });

  it('auto-increments version number based on existing versions', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(sampleContract);
    const mockVersion = { id: 'v2', contractId: 'contract-1', number: 2, storageKey: 'key' };
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        contractVersion: {
          findFirst: vi.fn().mockResolvedValue({ number: 1 }),
          create: vi.fn().mockResolvedValue(mockVersion),
        },
        contract: { update: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    const app = buildApp();
    const res = await request(app)
      .post('/contract-1/versions')
      .send({ storageKey: 'orgs/org-1/matters/m1/file.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.number).toBe(2);
  });
});

describe('GET /api/contracts/:contractId/versions', () => {
  it('returns 404 when contract not found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/contract-999/versions');
    expect(res.status).toBe(404);
  });

  it('returns versions ordered by number descending', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(sampleContract);
    const versions = [{ id: 'v2', number: 2 }, { id: 'v1', number: 1 }];
    mockPrisma.contractVersion.findMany.mockResolvedValue(versions);
    const app = buildApp();
    const res = await request(app).get('/contract-1/versions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(mockPrisma.contractVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { number: 'desc' } })
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
    mockPrisma.contract.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/');
    expect(res.status).toBe(500);
  });

  it('POST / propagates DB errors', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx' });
    mockPrisma.contract.create.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler())
      .post('/').send({ matterId: 'clxxxxxxxxxxxxxxxxxxxx', title: 'T', status: 'DRAFT' });
    expect(res.status).toBe(500);
  });

  it('GET /:id propagates DB errors', async () => {
    mockPrisma.contract.findFirst.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/c1');
    expect(res.status).toBe(500);
  });

  it('PATCH /:id propagates DB errors', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'PENDING_SIGNATURE', updatedAt: new Date() });
    mockPrisma.contract.update.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).patch('/c1').send({ status: 'EXECUTED' });
    expect(res.status).toBe(500);
  });

  it('DELETE /:id propagates DB errors', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.contract.update.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).delete('/c1');
    expect(res.status).toBe(500);
  });

  it('POST /:contractId/versions propagates DB errors', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.$transaction.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler())
      .post('/c1/versions').send({ storageKey: 'orgs/x/y.pdf', mimeType: 'application/pdf', sizeBytes: 1024 });
    expect(res.status).toBe(500);
  });

  it('GET /:contractId/versions propagates DB errors', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.contractVersion.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/c1/versions');
    expect(res.status).toBe(500);
  });
});

// ── PATCH /:id — optimistic-lock conflict (409) ─────────────────────────────

describe('PATCH /api/contracts/:id — optimistic lock conflict', () => {
  it('returns 409 when updatedAt does not match server value', async () => {
    const serverTime = new Date('2026-01-01T00:00:00Z');
    const clientTime = new Date('2025-12-31T00:00:00Z');
    mockPrisma.contract.findFirst.mockResolvedValue({
      ...sampleContract,
      updatedAt: serverTime,
    });
    const app = buildApp();
    const res = await request(app)
      .patch('/contract-1')
      .send({ title: 'Updated', updatedAt: clientTime.toISOString() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('conflict');
  });
});

// ── PATCH /:id — invalid status transition (422) ────────────────────────────

describe('PATCH /api/contracts/:id — invalid status transition', () => {
  it('returns 422 when transitioning from EXECUTED to DRAFT', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({
      ...sampleContract,
      status: 'EXECUTED',
      updatedAt: new Date(),
    });
    const app = buildApp();
    const res = await request(app)
      .patch('/contract-1')
      .send({ status: 'DRAFT' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_transition');
    expect(res.body.allowed).toEqual(['ARCHIVED']);
  });

  it('returns 422 when transitioning from DRAFT to EXECUTED', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({
      ...sampleContract,
      status: 'DRAFT',
      updatedAt: new Date(),
    });
    const app = buildApp();
    const res = await request(app)
      .patch('/contract-1')
      .send({ status: 'EXECUTED' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_transition');
  });

  it('allows valid transition from DRAFT to NEGOTIATION', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({
      ...sampleContract,
      status: 'DRAFT',
      updatedAt: new Date(),
    });
    mockPrisma.contract.update.mockResolvedValue({ ...sampleContract, status: 'NEGOTIATION' });
    const app = buildApp();
    const res = await request(app)
      .patch('/contract-1')
      .send({ status: 'NEGOTIATION' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NEGOTIATION');
  });

  it('enqueues webhook via webhookQueue.add on valid status transition', async () => {
    mockWebhookAdd.mockClear();
    mockPrisma.contract.findFirst.mockResolvedValue({
      ...sampleContract,
      status: 'DRAFT',
      updatedAt: new Date(),
    });
    mockPrisma.contract.update.mockResolvedValue({ ...sampleContract, status: 'NEGOTIATION' });
    const app = buildApp();
    const res = await request(app)
      .patch('/contract-1')
      .send({ status: 'NEGOTIATION' });
    expect(res.status).toBe(200);
    expect(mockWebhookAdd).toHaveBeenCalledWith(
      'contract.status_changed',
      expect.objectContaining({
        organizationId: 'org-1',
        event: 'contract.status_changed',
        payload: expect.objectContaining({
          contractId: 'contract-1',
          oldStatus: 'DRAFT',
          newStatus: 'NEGOTIATION',
        }),
      })
    );
  });
});

// ── POST /:id/generate-pdf ──────────────────────────────────────────────────

vi.mock('../../services/pdf.service.js', () => ({
  generateContractPdf: vi.fn(),
}));
vi.mock('../billing.js', () => ({
  requireActiveSubscription: (_req: any, _res: any, next: any) => next(),
}));

describe('POST /api/contracts/:id/generate-pdf', () => {
  // Re-import router with new mocks
  let pdfRouter: typeof router;
  let mockGeneratePdf: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const pdfMod = await import('../../services/pdf.service.js');
    mockGeneratePdf = pdfMod.generateContractPdf as ReturnType<typeof vi.fn>;
    // The router is already imported at module level and uses the mocked modules
    pdfRouter = router;
  });

  function buildPdfApp(orgId = 'org-1', userId = 'user-1') {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: userId, organizationId: orgId };
      next();
    });
    app.use('/', pdfRouter);
    return app;
  }

  function buildPdfAppNoOrg() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: 'user-1' };
      next();
    });
    app.use('/', pdfRouter);
    return app;
  }

  it('returns 403 when no active organization', async () => {
    const app = buildPdfAppNoOrg();
    const res = await request(app).post('/contract-1/generate-pdf');
    expect(res.status).toBe(403);
  });

  it('returns 404 when contract not found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const app = buildPdfApp();
    const res = await request(app).post('/contract-999/generate-pdf');
    expect(res.status).toBe(404);
  });

  it('returns PDF buffer on success', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({
      ...sampleContract,
      organization: { name: 'Acme' },
      currentVersion: { number: 1, title: 'Draft' },
    });
    const pdfBuf = Buffer.from('%PDF-1.4 mock');
    mockGeneratePdf.mockResolvedValue(pdfBuf);

    const app = buildPdfApp();
    const res = await request(app).post('/contract-1/generate-pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('returns PDF on success when contract has no currentVersion (version undefined)', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({
      ...sampleContract,
      organization: { name: 'Acme' },
      currentVersion: null,
    });
    const pdfBuf = Buffer.from('%PDF-1.4 mock');
    mockGeneratePdf.mockResolvedValue(pdfBuf);

    const app = buildPdfApp();
    const res = await request(app).post('/contract-1/generate-pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    // generateContractPdf should have been called with version: undefined
    expect(mockGeneratePdf).toHaveBeenCalledWith(
      expect.objectContaining({ version: undefined })
    );
  });

  it('returns 503 when generateContractPdf throws "puppeteer not installed"', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({
      ...sampleContract,
      organization: { name: 'Acme' },
      currentVersion: { number: 1, title: 'Draft' },
    });
    mockGeneratePdf.mockRejectedValue(new Error('puppeteer not installed'));

    const app = buildPdfApp();
    const res = await request(app).post('/contract-1/generate-pdf');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('pdf_unavailable');
    expect(res.body.message).toMatch(/not configured/i);
  });

  it('propagates non-puppeteer errors from generateContractPdf via next()', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({
      ...sampleContract,
      organization: { name: 'Acme' },
      currentVersion: { number: 1, title: 'Draft' },
    });
    mockGeneratePdf.mockRejectedValue(new Error('unexpected PDF error'));

    function buildPdfAppWithErrHandler() {
      const app = express();
      app.use(express.json());
      app.use((req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', organizationId: 'org-1' };
        next();
      });
      app.use('/', pdfRouter);
      app.use((err: any, _req: any, res: any, _next: any) => {
        res.status(500).json({ error: err.message });
      });
      return app;
    }

    const app = buildPdfAppWithErrHandler();
    const res = await request(app).post('/contract-1/generate-pdf');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('unexpected PDF error');
  });
});
