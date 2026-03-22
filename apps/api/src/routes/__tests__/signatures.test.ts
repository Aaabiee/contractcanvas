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
  contract: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  signatureEnvelope: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));
vi.mock('../../lib/audit.js', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/signature-provider.js', () => ({
  getProvider: vi.fn().mockReturnValue({
    name: 'stub',
    createEnvelope: vi.fn().mockResolvedValue({ providerId: 'stub_123', status: 'sent', signingUrl: 'https://stub.local/sign/stub_123' }),
    voidEnvelope: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({ providerId: 'stub_123', status: 'sent', recipients: [] }),
    verifyWebhook: vi.fn().mockReturnValue(true),
  }),
}));

const { router, signatureWebhookRouter } = await import('../signatures.js');

function buildApp(orgId = 'org-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'user-1', organizationId: orgId };
    next();
  });
  app.use('/', router);
  app.use('/webhook', signatureWebhookRouter);
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

  it('creates envelope via provider when contract found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx', title: 'NDA' });
    const newEnvelope = { id: 'env-1', contractId: 'clxxxxxxxxxxxxxxxxxxxx', provider: 'docusign', status: 'SENT' };
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
          providerId: 'stub_123',
        }),
      })
    );
  });

  it('creates envelope for hellosign provider', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx', title: 'SLA' });
    mockPrisma.signatureEnvelope.create.mockResolvedValue({ id: 'env-2', provider: 'hellosign', status: 'SENT' });
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
  });

  it('returns list of envelopes for the contract', async () => {
    const envelopes = [{ id: 'env-1', contractId: 'clxxxxxxxxxxxxxxxxxxxx', status: 'SENT' }];
    mockPrisma.signatureEnvelope.findMany.mockResolvedValue(envelopes);
    const app = buildApp();
    const res = await request(app).get('/?contractId=clxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('GET /api/signatures/:id', () => {
  it('returns 404 when envelope not found', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/env-999');
    expect(res.status).toBe(404);
  });

  it('returns the envelope', async () => {
    const envelope = { id: 'env-1', contractId: 'c1', organizationId: 'org-1', status: 'SENT' };
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(envelope);
    const app = buildApp();
    const res = await request(app).get('/env-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('env-1');
  });
});

describe('POST /api/signatures/:id/void', () => {
  it('returns 404 when envelope not found', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).post('/env-1/void').send({ reason: 'cancelled' });
    expect(res.status).toBe(404);
  });

  it('returns 409 when envelope already completed', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue({ id: 'env-1', status: 'COMPLETED', provider: 'docusign', providerId: 'p1' });
    const app = buildApp();
    const res = await request(app).post('/env-1/void').send({ reason: 'cancelled' });
    expect(res.status).toBe(409);
  });

  it('voids envelope successfully', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue({ id: 'env-1', status: 'SENT', provider: 'docusign', providerId: 'p1' });
    mockPrisma.signatureEnvelope.update.mockResolvedValue({ id: 'env-1', status: 'VOIDED' });
    const app = buildApp();
    const res = await request(app).post('/env-1/void').send({ reason: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('VOIDED');
  });
});

describe('POST /api/signatures/:id/resend', () => {
  it('returns 404 when envelope not found', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).post('/env-1/resend');
    expect(res.status).toBe(404);
  });

  it('returns 409 when envelope already completed', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue({
      id: 'env-1', status: 'COMPLETED', provider: 'docusign', providerId: 'p1',
      recipients: [], contract: { title: 'NDA' },
    });
    const app = buildApp();
    const res = await request(app).post('/env-1/resend');
    expect(res.status).toBe(409);
  });

  it('resends envelope successfully', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue({
      id: 'env-1', status: 'SENT', provider: 'docusign', providerId: 'p1',
      recipients: [{ email: 'a@b.com', name: 'Alice', role: 'signer' }],
      contract: { title: 'NDA' },
    });
    mockPrisma.signatureEnvelope.update.mockResolvedValue({ id: 'env-1', status: 'SENT', providerId: 'stub_123' });
    const app = buildApp();
    const res = await request(app).post('/env-1/resend');
    expect(res.status).toBe(200);
  });
});

describe('POST /webhook/:provider', () => {
  it('returns 400 for unknown provider', async () => {
    const app = buildApp();
    const res = await request(app).post('/webhook/unknown').send({});
    expect(res.status).toBe(400);
  });

  it('ignores webhook with missing providerId', async () => {
    const app = buildApp();
    const res = await request(app).post('/webhook/docusign').send({ event: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
  });

  it('updates envelope status on valid docusign webhook', async () => {
    const envelope = { id: 'env-1', provider: 'docusign', providerId: 'ds_123', status: 'SENT', metadata: {} };
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(envelope);
    mockPrisma.signatureEnvelope.update.mockResolvedValue({ ...envelope, status: 'COMPLETED' });
    const app = buildApp();
    const res = await request(app).post('/webhook/docusign').send({
      event: 'completed',
      data: { envelopeId: 'ds_123' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPrisma.signatureEnvelope.update).toHaveBeenCalled();
  });

  it('updates envelope status on valid hellosign webhook', async () => {
    const envelope = { id: 'env-2', provider: 'hellosign', providerId: 'hs_456', status: 'SENT', metadata: {} };
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(envelope);
    mockPrisma.signatureEnvelope.update.mockResolvedValue({ ...envelope, status: 'COMPLETED' });
    const app = buildApp();
    const res = await request(app).post('/webhook/hellosign').send({
      event: { event_type: 'signature_request_signed' },
      signature_request: { signature_request_id: 'hs_456', signatures: [] },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('ignores webhook for unknown envelope', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).post('/webhook/docusign').send({
      event: 'completed',
      data: { envelopeId: 'unknown_id' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
  });
});

describe('POST /api/signatures — sender as recipient', () => {
  it('returns 400 when sender email matches a recipient', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx', title: 'NDA' });
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', organizationId: 'org-1', email: 'a@b.com' };
      next();
    });
    app.use('/', router);
    app.use('/webhook', signatureWebhookRouter);
    const res = await request(app)
      .post('/')
      .send({
        contractId: 'clxxxxxxxxxxxxxxxxxxxx',
        provider: 'docusign',
        recipients: [{ email: 'a@b.com', name: 'Alice', role: 'signer' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/segregation/i);
  });
});

describe('POST /api/signatures/:id/void — additional statuses', () => {
  it('returns 409 when envelope already voided', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue({
      id: 'env-1', status: 'VOIDED', provider: 'docusign', providerId: 'p1',
    });
    const app = buildApp();
    const res = await request(app).post('/env-1/void').send({ reason: 'test' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/VOIDED/);
  });

  it('returns 409 when envelope is declined', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue({
      id: 'env-1', status: 'DECLINED', provider: 'docusign', providerId: 'p1',
    });
    const app = buildApp();
    const res = await request(app).post('/env-1/void').send({ reason: 'test' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/DECLINED/);
  });
});

describe('POST /api/signatures/:id/resend — additional statuses', () => {
  it('returns 409 when envelope is voided', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue({
      id: 'env-1', status: 'VOIDED', provider: 'docusign', providerId: 'p1',
      recipients: [], contract: { title: 'NDA' },
    });
    const app = buildApp();
    const res = await request(app).post('/env-1/resend');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/VOIDED/);
  });

  it('returns 409 when envelope is declined', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue({
      id: 'env-1', status: 'DECLINED', provider: 'docusign', providerId: 'p1',
      recipients: [], contract: { title: 'NDA' },
    });
    const app = buildApp();
    const res = await request(app).post('/env-1/resend');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/DECLINED/);
  });
});

describe('POST /webhook/:provider — COMPLETED event updates contract', () => {
  it('updates contract status to EXECUTED on COMPLETED webhook', async () => {
    const envelope = {
      id: 'env-1', provider: 'docusign', providerId: 'ds_123',
      status: 'SENT', contractId: 'c1', metadata: {},
    };
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(envelope);
    mockPrisma.signatureEnvelope.update.mockResolvedValue({ ...envelope, status: 'COMPLETED' });
    mockPrisma.contract.update.mockResolvedValue({ id: 'c1', status: 'EXECUTED' });

    const app = buildApp();
    const res = await request(app).post('/webhook/docusign').send({
      event: 'completed',
      data: { envelopeId: 'ds_123' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPrisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'EXECUTED' },
    });
  });

  it('handles contract update failure gracefully on COMPLETED webhook', async () => {
    const envelope = {
      id: 'env-1', provider: 'docusign', providerId: 'ds_456',
      status: 'SENT', contractId: 'c2', metadata: {},
    };
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(envelope);
    mockPrisma.signatureEnvelope.update.mockResolvedValue({ ...envelope, status: 'COMPLETED' });
    mockPrisma.contract.update.mockRejectedValue(new Error('contract update failed'));

    const app = buildApp();
    const res = await request(app).post('/webhook/docusign').send({
      event: 'completed',
      data: { envelopeId: 'ds_456' },
    });
    // Should still return 200 because the contract.update error is caught
    expect(res.status).toBe(200);
  });

  it('includes completedAt in metadata on COMPLETED event', async () => {
    const envelope = {
      id: 'env-1', provider: 'docusign', providerId: 'ds_789',
      status: 'SENT', contractId: 'c3', metadata: { signingUrl: 'https://sign.url' },
    };
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(envelope);
    mockPrisma.signatureEnvelope.update.mockResolvedValue({ ...envelope, status: 'COMPLETED' });
    mockPrisma.contract.update.mockResolvedValue({});

    const app = buildApp();
    await request(app).post('/webhook/docusign').send({
      event: 'completed',
      data: { envelopeId: 'ds_789' },
    });

    expect(mockPrisma.signatureEnvelope.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          metadata: expect.objectContaining({
            signingUrl: 'https://sign.url',
            completedAt: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('handles hellosign webhook with recipient signatures', async () => {
    const envelope = {
      id: 'env-2', provider: 'hellosign', providerId: 'hs_999',
      status: 'SENT', contractId: 'c4', metadata: {},
    };
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue(envelope);
    mockPrisma.signatureEnvelope.update.mockResolvedValue({ ...envelope, status: 'SIGNED' });

    const app = buildApp();
    const res = await request(app).post('/webhook/hellosign').send({
      event: { event_type: 'signature_request_signed' },
      signature_request: {
        signature_request_id: 'hs_999',
        signatures: [
          { signer_email_address: 'a@b.com', status_code: 'signed', signed_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(mockPrisma.signatureEnvelope.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipients: [
            { email: 'a@b.com', status: 'signed', signedAt: '2026-01-01T00:00:00Z' },
          ],
        }),
      }),
    );
  });
});

describe('error propagation — void and resend', () => {
  it('POST /:id/void propagates provider errors', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue({
      id: 'env-1', status: 'SENT', provider: 'docusign', providerId: 'p1',
    });
    const { getProvider } = await import('../../services/signature-provider.js');
    (getProvider as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      voidEnvelope: vi.fn().mockRejectedValue(new Error('provider error')),
    });

    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'user-1', organizationId: 'org-1' }; next(); });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: err.message }); });

    const res = await request(app).post('/env-1/void').send({ reason: 'test' });
    expect(res.status).toBe(500);
  });

  it('POST /:id/resend propagates provider errors', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockResolvedValue({
      id: 'env-1', status: 'SENT', provider: 'docusign', providerId: 'p1',
      recipients: [{ email: 'a@b.com', name: 'A', role: 'signer' }],
      contract: { title: 'NDA' },
    });
    const { getProvider } = await import('../../services/signature-provider.js');
    (getProvider as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      createEnvelope: vi.fn().mockRejectedValue(new Error('resend failed')),
    });

    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'user-1', organizationId: 'org-1' }; next(); });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: err.message }); });

    const res = await request(app).post('/env-1/resend');
    expect(res.status).toBe(500);
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
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c1', title: 'NDA' });
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

/* ------------------------------------------------------------------ */
/*  Additional coverage: no-org branches for GET /:id, void, resend   */
/* ------------------------------------------------------------------ */

describe('GET /api/signatures/:id — no organization', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/env-1');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/signatures/:id/void — no organization', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).post('/env-1/void').send({ reason: 'test' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/signatures/:id/resend — no organization', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).post('/env-1/resend');
    expect(res.status).toBe(403);
  });
});

describe('POST /webhook/:provider — webhook next(error) propagation', () => {
  it('propagates errors from webhook handler via next(error)', async () => {
    mockPrisma.signatureEnvelope.findFirst.mockRejectedValue(new Error('DB failure'));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', organizationId: 'org-1' };
      next();
    });
    app.use('/webhook', signatureWebhookRouter);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: err.message });
    });

    const res = await request(app).post('/webhook/docusign').send({
      event: 'completed',
      data: { envelopeId: 'ds_123' },
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /webhook/:provider — production signature verification', () => {
  it('returns 401 when webhook signature is invalid in production', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { getProvider } = await import('../../services/signature-provider.js');
      (getProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        name: 'stub',
        createEnvelope: vi.fn(),
        voidEnvelope: vi.fn(),
        getStatus: vi.fn(),
        verifyWebhook: vi.fn().mockReturnValue(false),
      });

      const app = express();
      app.use(express.json());
      app.use('/webhook', signatureWebhookRouter);

      const res = await request(app)
        .post('/webhook/docusign')
        .set('x-docusign-signature-1', 'invalid')
        .send({ event: 'completed', data: { envelopeId: 'ds_123' } });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid webhook signature/i);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});
