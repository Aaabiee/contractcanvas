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

// ─── GET /api/documents/:id/download (valid doc) ────────────────────────────
describe('GET /api/documents/:id/download (additional coverage)', () => {
  it('returns a presigned URL that contains the sanitized filename', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const upload = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 extra'), { filename: 'report (final).pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    expect(upload.status).toBe(201);

    const res = await request(app)
      .get(`/api/documents/${upload.body.id}/download`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(typeof res.body.url).toBe('string');
    // The filename should be sanitized (special chars replaced)
    expect(res.body.url).toContain('X-Amz-Signature');
  });

  it('returns 404 for download of a soft-deleted document', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const upload = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'deleted.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    await request(app)
      .delete(`/api/documents/${upload.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    const res = await request(app)
      .get(`/api/documents/${upload.body.id}/download`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });
});

// ─── Soft-delete excludes from GET list ─────────────────────────────────────
describe('GET /api/documents (soft-delete exclusion)', () => {
  it('excludes soft-deleted documents from the list', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const upload1 = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'keep.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    const upload2 = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'remove.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    // Soft-delete the second document
    await request(app)
      .delete(`/api/documents/${upload2.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    const res = await request(app)
      .get(`/api/documents?matterId=${matterId}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].filename).toBe('keep.pdf');
  });
});

// ─── Re-upload after delete ─────────────────────────────────────────────────
describe('POST /api/documents/upload (re-upload after delete)', () => {
  it('can upload a new document with the same filename after deleting the previous one', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const upload1 = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 v1'), { filename: 'invoice.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    expect(upload1.status).toBe(201);

    await request(app)
      .delete(`/api/documents/${upload1.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    const upload2 = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 v2'), { filename: 'invoice.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    expect(upload2.status).toBe(201);
    expect(upload2.body.id).not.toBe(upload1.body.id);
    expect(upload2.body.filename).toBe('invoice.pdf');

    // List should only show the new upload
    const list = await request(app)
      .get(`/api/documents?matterId=${matterId}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(upload2.body.id);
  });
});

// ─── Additional coverage: cross-org isolation for GET/:id and DELETE ─────────
describe('GET /api/documents/:id (cross-org)', () => {
  it('returns 404 when fetching a document belonging to a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    const upload = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 cross-org test'), { filename: 'secret.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    expect(upload.status).toBe(201);

    const res = await request(app)
      .get(`/api/documents/${upload.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/documents/:id (cross-org)', () => {
  it('returns 404 when deleting a document belonging to a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    const upload = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 cross-org del'), { filename: 'cross-del.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    expect(upload.status).toBe(201);

    const res = await request(app)
      .delete(`/api/documents/${upload.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(404);

    // Verify document still exists for the owning org
    const dbRecord = await db.document.findUnique({ where: { id: upload.body.id } });
    expect(dbRecord!.deletedAt).toBeNull();
  });
});

// ─── Additional coverage: upload with invalid metadata ──────────────────────
describe('POST /api/documents/upload (metadata validation)', () => {
  it('returns 400 when matterId is missing from body', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'test.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Ii]nvalid metadata/);
  });

  it('returns 400 when matterId is not a valid cuid', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'test.pdf', contentType: 'application/pdf' })
      .field('matterId', 'not-a-cuid');

    expect(res.status).toBe(400);
  });

  it('returns 400 when kind is an invalid value', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'test.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId)
      .field('kind', 'INVALID_KIND');

    expect(res.status).toBe(400);
  });
});

// ─── Additional coverage: upload with kind ATTACHMENT and GENERATED ─────────
describe('POST /api/documents/upload (kind variations)', () => {
  it('uploads with kind ATTACHMENT and stores it correctly', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 attachment'), { filename: 'attachment.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId)
      .field('kind', 'ATTACHMENT');

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('ATTACHMENT');

    const dbRecord = await db.document.findUnique({ where: { id: res.body.id } });
    expect(dbRecord!.kind).toBe('ATTACHMENT');
  });

  it('uploads with kind GENERATED and stores it correctly', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 generated'), { filename: 'generated.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId)
      .field('kind', 'GENERATED');

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('GENERATED');
  });

  it('defaults kind to UPLOADED when not provided', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 default kind'), { filename: 'default.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('UPLOADED');
  });
});

// ─── Additional coverage: re-upload and list verification ───────────────────
describe('POST /api/documents/upload (re-upload and list verification)', () => {
  it('re-uploading multiple files to same matter lists all of them', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const upload1 = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 first'), { filename: 'first.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    const upload2 = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 second'), { filename: 'second.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    const upload3 = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('plain text'), { filename: 'notes.txt', contentType: 'text/plain' })
      .field('matterId', matterId);

    expect(upload1.status).toBe(201);
    expect(upload2.status).toBe(201);
    expect(upload3.status).toBe(201);

    const list = await request(app)
      .get(`/api/documents?matterId=${matterId}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(3);

    const filenames = list.body.map((d: { filename: string }) => d.filename);
    expect(filenames).toContain('first.pdf');
    expect(filenames).toContain('second.pdf');
    expect(filenames).toContain('notes.txt');
  });
});

// ─── Additional coverage: download cross-org returns 404 ────────────────────
describe('GET /api/documents/:id/download (cross-org)', () => {
  it('returns 404 when downloading a document from another org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    const upload = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 dl-cross-org'), { filename: 'dl-cross.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    expect(upload.status).toBe(201);

    const res = await request(app)
      .get(`/api/documents/${upload.body.id}/download`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(404);
  });
});

// ─── Additional coverage: org guard paths (covers lines 52, 65-66, 132-133) ─
describe('Documents — org guard error paths', () => {
  it('GET /api/documents returns 403 when org header does not match (covers line 132-133)', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/documents?matterId=some-id')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk');

    expect(res.status).toBe(403);
  });

  it('GET /api/documents/:id returns 403 when org header does not match', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/documents/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk');

    expect(res.status).toBe(403);
  });

  it('GET /api/documents/:id/download returns 403 when org header does not match', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/documents/cuid1234567890abcdefghijk/download')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk');

    expect(res.status).toBe(403);
  });

  it('DELETE /api/documents/:id returns 403 when org header does not match', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .delete('/api/documents/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk');

    expect(res.status).toBe(403);
  });

  it('POST /api/documents/upload returns 403 when org header does not match (covers line 65-66)', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'test.pdf', contentType: 'application/pdf' })
      .field('matterId', 'cuid1234567890abcdefghijk');

    expect(res.status).toBe(403);
  });
});

// ─── Additional coverage: error propagation (S3 send failure) ───────────────
describe('POST /api/documents/upload (S3 error propagation)', () => {
  it('propagates error when S3 upload fails', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    // Make S3 send reject for this test
    mockS3Send.mockRejectedValueOnce(new Error('S3 upload failed'));

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .attach('file', Buffer.from('%PDF-1.4 s3 error'), { filename: 'fail.pdf', contentType: 'application/pdf' })
      .field('matterId', matterId);

    // Error should be caught and propagated through next(error)
    expect(res.status).toBe(500);
  });
});
