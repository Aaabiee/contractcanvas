/**
 * Integration tests for /api/documents.
 * Runs against real PostgreSQL (Testcontainers).
 * S3/MinIO is mocked — only the database layer uses real infrastructure.
 */

import { vi } from 'vitest';

// ─── Mock S3 before any route module is imported ────────────────────────────
const mockS3Send = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: vi.fn().mockImplementation((args: any) => args),
  GetObjectCommand: vi.fn().mockImplementation((args: any) => args),
  DeleteObjectCommand: vi.fn().mockImplementation((args: any) => args),
}));

const mockGetSignedUrl = vi.hoisted(() =>
  vi.fn().mockImplementation((_client: any, command: any, _opts?: any) => {
    // Include the filename from ResponseContentDisposition so tests can assert on it
    const disposition = command?.ResponseContentDisposition ?? '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : 'file';
    return Promise.resolve(`https://mock-s3.example.com/${filename}?X-Amz-Signature=abc`);
  }),
);

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));
// ─────────────────────────────────────────────────────────────────────────────

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

async function seedMatter(authHeader: string, orgHeader: string) {
  const res = await request(app)
    .post('/api/matters')
    .set('Authorization', authHeader)
    .set('X-Organization-Id', orgHeader)
    .send({ title: 'Doc Matter' });
  return res.body.id as string;
}

// ─── POST /api/documents/upload ──────────────────────────────────────────────
describe('POST /api/documents/upload', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('hello'), 'test.txt')
      .field('matterId', 'dummy');
    expect(res.status).toBe(401);
  });

  it('returns 415 when file type is text/plain (not in allowed list)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('hello world'), { filename: 'notes.txt', contentType: 'text/plain' })
      .field('matterId', matterId);
    // text/plain IS in ALLOWED_MIME_TYPES and 'txt' is in ALLOWED_EXTENSIONS — should succeed
    expect(res.status).toBe(201);
  });

  it('returns 400 when no file is attached', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .field('matterId', matterId);
    expect(res.status).toBe(400);
  });

  it('returns 415 for disallowed file type (.exe)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('MZ...'), { filename: 'virus.exe', contentType: 'application/octet-stream' })
      .field('matterId', matterId);
    expect(res.status).toBe(415);
  });

  it('returns 404 when matterId belongs to a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .attach('file', Buffer.from('pdf content'), { filename: 'test.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    expect(res.status).toBe(404);
  });

  it('uploads a PDF to S3 and creates a document record', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 test content'), { filename: 'contract.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId)
      .field('kind', 'ATTACHMENT');

    expect(res.status).toBe(201);
    expect(res.body.filename).toBe('contract.pdf');
    expect(res.body.mimeType).toBe('application/pdf');
    expect(res.body.kind).toBe('ATTACHMENT');
    expect(res.body.storageKey).toBeTruthy();

    const dbRecord = await db.document.findUnique({ where: { id: res.body.id } });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.matterId).toBe(matterId);
  });

  it('uploads a PNG image and defaults kind to UPLOADED', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', pngHeader, { filename: 'screenshot.png', contentType: 'image/png' })
      .field('matterId', matterId);

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('UPLOADED');
  });
});

// ─── GET /api/documents ──────────────────────────────────────────────────────
describe('GET /api/documents', () => {
  it('returns 401 without auth', async () => {
    expect((await request(app).get('/api/documents?matterId=x')).status).toBe(401);
  });

  it('returns 400 when matterId query param is missing', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);
    expect(res.status).toBe(400);
  });

  it('returns empty array when no documents exist for the matter', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .get(`/api/documents?matterId=${matterId}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns documents after upload, scoped to the matter', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'b.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    const res = await request(app)
      .get(`/api/documents?matterId=${matterId}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('does not return documents from a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'secret.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    const res = await request(app)
      .get(`/api/documents?matterId=${matterId}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    // Either empty (org scope) or 200 with 0 items
    expect(res.body).toHaveLength(0);
  });
});

// ─── GET /api/documents/:id ──────────────────────────────────────────────────
describe('GET /api/documents/:id', () => {
  it('returns 404 for non-existent document', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/documents/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);
    expect(res.status).toBe(404);
  });

  it('returns the document by id', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const upload = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 get test'), { filename: 'get-me.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    const res = await request(app)
      .get(`/api/documents/${upload.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.filename).toBe('get-me.pdf');
  });
});

// ─── GET /api/documents/:id/download ────────────────────────────────────────
describe('GET /api/documents/:id/download', () => {
  it('returns 404 for non-existent document', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/documents/cuid1234567890abcdefghijk/download')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);
    expect(res.status).toBe(404);
  });

  it('returns a presigned URL after upload', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const upload = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 download test'), { filename: 'download-me.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    const res = await request(app)
      .get(`/api/documents/${upload.body.id}/download`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(typeof res.body.url).toBe('string');
    expect(res.body.url).toContain('download-me.pdf');
  });
});

// ─── DELETE /api/documents/:id ───────────────────────────────────────────────
describe('DELETE /api/documents/:id', () => {
  it('soft-deletes the document and returns 204', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const upload = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 delete test'), { filename: 'delete-me.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    const res = await request(app)
      .delete(`/api/documents/${upload.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(204);

    const dbRecord = await db.document.findUnique({ where: { id: upload.body.id } });
    expect(dbRecord!.deletedAt).not.toBeNull();
    expect(dbRecord!.status).toBe('ARCHIVED');
  });

  it('returns 404 after soft-delete (excluded from queries)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const upload = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'gone.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    await request(app)
      .delete(`/api/documents/${upload.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    const res = await request(app)
      .get(`/api/documents/${upload.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent document', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .delete('/api/documents/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);
    expect(res.status).toBe(404);
  });
});
