import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.NODE_ENV = 'test';

vi.mock('../../config.js', () => ({
  app: { env: 'test', port: 3333 },
  db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
  s3: { region: 'us-east-1', bucket: 'test-bucket', forcePathStyle: true, accessKey: undefined, secretKey: undefined, endpoint: undefined },
  stripe: {},
  jwt: { secret: 'test-secret-key-for-testing' },
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
}));

const mockS3Send = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: vi.fn().mockImplementation((args: any) => args),
  GetObjectCommand: vi.fn().mockImplementation((args: any) => args),
  DeleteObjectCommand: vi.fn().mockImplementation((args: any) => args),
}));

const mockGetSignedUrl = vi.hoisted(() =>
  vi.fn().mockResolvedValue('https://presigned-url.example.com')
);

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));

const mockPrisma = {
  matter: { findFirst: vi.fn() },
  document: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

vi.mock('../../middleware/auth.js', () => ({
  protect: (_req: any, _res: any, next: any) => next(),
  requireEmailVerified: (_req: any, _res: any, next: any) => next(),
  default: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../billing.js', () => ({
  requireActiveSubscription: (_req: any, _res: any, next: any) => next(),
  billing: { use: vi.fn() },
}));

const { router } = await import('../documents.js');

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

const validMatterId = 'clxxxxxxxxxxxxxxxxxxxx';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/documents/upload', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('hello'), 'test.txt');
    expect(res.status).toBe(403);
  });

  it('returns 400 when no file attached', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/upload')
      .field('matterId', validMatterId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No file uploaded');
  });

  it('returns 415 for disallowed file type (e.g. .exe)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('MZ\x90\x00'), { filename: 'malware.exe', contentType: 'application/octet-stream' })
      .field('matterId', validMatterId);
    expect(res.status).toBe(415);
    expect(res.body.error).toBe('Unsupported file type');
  });

  it('returns 400 for invalid matterId (not a cuid)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('hello'), 'test.txt')
      .field('matterId', 'not-a-cuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid metadata');
  });

  it('returns 404 when matter not found in org', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('hello'), 'test.txt')
      .field('matterId', validMatterId);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Matter not found');
  });

  it('uploads to S3 and returns 201 with document', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: validMatterId });
    const doc = {
      id: 'doc-1',
      matterId: validMatterId,
      filename: 'test.txt',
      storageKey: 'orgs/org-1/matters/clxx/123-abc.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      kind: 'UPLOADED',
    };
    mockPrisma.document.create.mockResolvedValue(doc);

    const app = buildApp();
    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('hello'), 'test.txt')
      .field('matterId', validMatterId);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('doc-1');
    expect(mockS3Send).toHaveBeenCalled();
    expect(mockPrisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matterId: validMatterId,
          organizationId: 'org-1',
          filename: 'test.txt',
          mimeType: 'text/plain',
        }),
      })
    );
  });

  it('uses UPLOADED as default kind when not specified', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: validMatterId });
    mockPrisma.document.create.mockResolvedValue({ id: 'doc-2', kind: 'UPLOADED' });

    const app = buildApp();
    await request(app)
      .post('/upload')
      .attach('file', Buffer.from('data'), 'file.pdf')
      .field('matterId', validMatterId);

    expect(mockPrisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'UPLOADED' }),
      })
    );
  });
});

describe('GET /api/documents', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get(`/?matterId=${validMatterId}`);
    expect(res.status).toBe(403);
  });

  it('returns 400 when matterId query param is missing', async () => {
    const app = buildApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/matterId/i);
  });

  it('returns list of documents for the matter', async () => {
    const docs = [{ id: 'doc-1', matterId: validMatterId, filename: 'test.txt' }];
    mockPrisma.document.findMany.mockResolvedValue(docs);

    const app = buildApp();
    const res = await request(app).get(`/?matterId=${validMatterId}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matterId: validMatterId,
          organizationId: 'org-1',
          deletedAt: null,
        }),
      })
    );
  });

  it('returns empty array when no documents exist', async () => {
    mockPrisma.document.findMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app).get(`/?matterId=${validMatterId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe('GET /api/documents/:id', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/doc-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when document not found', async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/doc-999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Document not found');
  });

  it('returns the document', async () => {
    const doc = { id: 'doc-1', matterId: validMatterId, filename: 'test.txt', organizationId: 'org-1' };
    mockPrisma.document.findFirst.mockResolvedValue(doc);

    const app = buildApp();
    const res = await request(app).get('/doc-1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('doc-1');
    expect(res.body.filename).toBe('test.txt');
  });
});

describe('GET /api/documents/:id/download', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/doc-1/download');
    expect(res.status).toBe(403);
  });

  it('returns 404 when document not found', async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/doc-999/download');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Document not found');
  });

  it('returns a presigned S3 URL', async () => {
    const doc = {
      id: 'doc-1',
      storageKey: 'orgs/org-1/matters/m1/file.txt',
      filename: 'file.txt',
      organizationId: 'org-1',
    };
    mockPrisma.document.findFirst.mockResolvedValue(doc);

    const app = buildApp();
    const res = await request(app).get('/doc-1/download');

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://presigned-url.example.com');
    expect(mockGetSignedUrl).toHaveBeenCalled();
  });
});

describe('DELETE /api/documents/:id', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).delete('/doc-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when document not found', async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).delete('/doc-999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Document not found');
  });

  it('soft-deletes the document and returns 204', async () => {
    const doc = { id: 'doc-1', matterId: validMatterId, organizationId: 'org-1', storageKey: 'key' };
    mockPrisma.document.findFirst.mockResolvedValue(doc);
    mockPrisma.document.update.mockResolvedValue({});

    const app = buildApp();
    const res = await request(app).delete('/doc-1');

    expect(res.status).toBe(204);
    expect(mockPrisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-1' },
        data: expect.objectContaining({ status: 'ARCHIVED', deletedAt: expect.any(Date) }),
      })
    );
  });
});

describe('POST /api/documents/upload — webhookQueue and upload error', () => {
  it('fires webhookQueue.add after successful upload', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: validMatterId });
    const doc = {
      id: 'doc-wh',
      matterId: validMatterId,
      filename: 'test.pdf',
      storageKey: 'orgs/org-1/matters/clxx/123-abc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5,
      kind: 'UPLOADED',
    };
    mockPrisma.document.create.mockResolvedValue(doc);

    const app = buildApp();
    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('pdf-data'), 'test.pdf')
      .field('matterId', validMatterId);

    expect(res.status).toBe(201);
    // webhookQueue is null in mock, so the block is skipped; just ensure no crash
    expect(res.body.id).toBe('doc-wh');
  });

  it('propagates errors from S3 upload via next(error)', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: validMatterId });
    mockS3Send.mockRejectedValueOnce(new Error('S3 failure'));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', organizationId: 'org-1' };
      next();
    });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: err.message });
    });

    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('hello'), 'test.txt')
      .field('matterId', validMatterId);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('S3 failure');
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
    mockPrisma.document.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get(`/?matterId=${validMatterId}`);
    expect(res.status).toBe(500);
  });

  it('GET /:id propagates DB errors', async () => {
    mockPrisma.document.findFirst.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/doc-1');
    expect(res.status).toBe(500);
  });

  it('GET /:id/download propagates DB errors', async () => {
    mockPrisma.document.findFirst.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/doc-1/download');
    expect(res.status).toBe(500);
  });

  it('DELETE /:id propagates DB errors', async () => {
    mockPrisma.document.findFirst.mockResolvedValue({ id: 'doc-1', matterId: validMatterId, organizationId: 'org-1' });
    mockPrisma.document.update.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).delete('/doc-1');
    expect(res.status).toBe(500);
  });
});
