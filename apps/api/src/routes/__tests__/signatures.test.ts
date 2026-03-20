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
  contract: { findFirst: vi.fn() },
  signatureEnvelope: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const { router } = await import('../signatures.js');

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

const validPayload = {
  contractId: 'clxxxxxxxxxxxxxxxxxxxx',
  provider: 'docusign',
  recipients: [{ email: 'a@b.com', name: 'Alice', role: 'signer' }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/signatures', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).post('/').send(validPayload);
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing contractId', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ provider: 'docusign', recipients: [{ email: 'a@b.com', name: 'A', role: 'signer' }] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid provider', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ ...validPayload, provider: 'invalidprovider' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when recipients array is empty', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ ...validPayload, recipients: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for recipient with invalid email', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ ...validPayload, recipients: [{ email: 'not-an-email', name: 'A', role: 'signer' }] });
    expect(res.status).toBe(400);
  });

  it('returns 404 when contract not found in org', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).post('/').send(validPayload);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Contract not found');
  });

  it('creates envelope with fake provider ID when contract found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx' });
    const newEnvelope = {
      id: 'env-1',
      contractId: 'clxxxxxxxxxxxxxxxxxxxx',
      provider: 'docusign',
      status: 'CREATED',
    };
    mockPrisma.signatureEnvelope.create.mockResolvedValue(newEnvelope);
    const app = buildApp();
    const res = await request(app).post('/').send(validPayload);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('env-1');
    expect(mockPrisma.signatureEnvelope.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          contractId: expect.any(String),
          provider: 'docusign',
          status: 'CREATED',
        }),
      })
    );
  });

  it('creates envelope for hellosign provider too', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx' });
    mockPrisma.signatureEnvelope.create.mockResolvedValue({ id: 'env-2', provider: 'hellosign', status: 'CREATED' });
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ ...validPayload, provider: 'hellosign' });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/signatures', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/?contractId=clxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(403);
  });

  it('returns 400 when contractId query param is missing', async () => {
    const app = buildApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contractId/i);
  });

  it('returns list of envelopes for the contract', async () => {
    const envelopes = [{ id: 'env-1', contractId: 'clxxxxxxxxxxxxxxxxxxxx', status: 'CREATED' }];
    mockPrisma.signatureEnvelope.findMany.mockResolvedValue(envelopes);
    const app = buildApp();
    const res = await request(app).get('/?contractId=clxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mockPrisma.signatureEnvelope.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contractId: 'clxxxxxxxxxxxxxxxxxxxx', organizationId: 'org-1' }),
      })
    );
  });
});

describe('GET /api/signatures/:id', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/env-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when envelope not found', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/env-999');
    expect(res.status).toBe(404);
  });

  it('returns the envelope', async () => {
    const envelope = { id: 'env-1', contractId: 'c1', organizationId: 'org-1', status: 'CREATED' };
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(envelope);
    const app = buildApp();
    const res = await request(app).get('/env-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('env-1');
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

  it('POST / propagates DB errors', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.signatureEnvelope.create.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler())
      .post('/').send({ contractId: 'clxxxxxxxxxxxxxxxxxxxx', provider: 'docusign', recipients: [{ email: 'a@b.com', name: 'A', role: 'signer' }] });
    expect(res.status).toBe(500);
  });

  it('GET / propagates DB errors', async () => {
    mockPrisma.signatureEnvelope.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/?contractId=c1');
    expect(res.status).toBe(500);
  });

  it('GET /:id propagates DB errors', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/env-1');
    expect(res.status).toBe(500);
  });
});
