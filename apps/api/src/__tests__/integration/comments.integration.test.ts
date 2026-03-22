/**
 * Integration tests for /api/comments.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

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
    .send({ title: 'Comment Matter' });
  return res.body.id as string;
}

// ─── GET /api/comments ───────────────────────────────────────────────────────
describe('GET /api/comments', () => {
  it('returns 401 without auth', async () => {
    expect((await request(app).get('/api/comments')).status).toBe(401);
  });

  it('returns empty list when no comments exist', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/comments')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('filters comments by matterId', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const m1 = await seedMatter(authHeader, orgHeader);
    const m2 = await seedMatter(authHeader, orgHeader);

    await request(app).post('/api/comments').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ bodyMd: 'On M1', matterId: m1 });
    await request(app).post('/api/comments').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ bodyMd: 'On M2', matterId: m2 });

    const res = await request(app)
      .get(`/api/comments?matterId=${m1}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].bodyMd).toBe('On M1');
  });

  it('scopes comments to the org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    await request(app).post('/api/comments').set('Authorization', a.authHeader).set('X-Organization-Id', a.orgHeader).send({ bodyMd: 'Org A comment', matterId });

    const res = await request(app)
      .get('/api/comments')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.body.data).toHaveLength(0);
  });
});

// ─── POST /api/comments ──────────────────────────────────────────────────────
describe('POST /api/comments', () => {
  it('creates a comment on a matter', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: '**Important** note here', matterId });

    expect(res.status).toBe(201);
    expect(res.body.bodyMd).toBe('**Important** note here');
    expect(res.body.authorId).toBe(userId);

    const dbRecord = await db.comment.findUnique({ where: { id: res.body.id } });
    expect(dbRecord).not.toBeNull();
  });

  it('returns 400 when no resource id is provided', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: 'Orphan comment' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for empty bodyMd', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: '', matterId });

    expect(res.status).toBe(400);
  });
});

// ─── PATCH /api/comments/:id ─────────────────────────────────────────────────
describe('PATCH /api/comments/:id', () => {
  it('updates the comment body and sets editedAt', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/comments')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: 'Original text', matterId });

    const res = await request(app)
      .patch(`/api/comments/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: 'Edited text' });

    expect(res.status).toBe(200);
    expect(res.body.bodyMd).toBe('Edited text');
    expect(res.body.editedAt).not.toBeNull();
  });

  it("returns 404 when trying to edit another user's comment", async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    const create = await request(app)
      .post('/api/comments')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ bodyMd: 'User A comment', matterId });

    const res = await request(app)
      .patch(`/api/comments/${create.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({ bodyMd: 'Hijacked' });

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/comments/:id ────────────────────────────────────────────────
describe('DELETE /api/comments/:id', () => {
  it('deletes own comment', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/comments')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: 'Delete me', matterId });

    const res = await request(app)
      .delete(`/api/comments/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(204);

    const dbRecord = await db.comment.findUnique({ where: { id: create.body.id } });
    expect(dbRecord).toBeNull();
  });

  it("returns 404 when deleting another user's comment", async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    const create = await request(app)
      .post('/api/comments')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ bodyMd: 'User A only', matterId });

    const res = await request(app)
      .delete(`/api/comments/${create.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/comments — other resource types ─────────────────────────────
describe('POST /api/comments (contract / contractVersion / document)', () => {
  async function seedContract(authHeader: string, orgHeader: string) {
    const matterId = await seedMatter(authHeader, orgHeader);
    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Comment Contract', matterId });
    return { matterId, contractId: res.body.id as string };
  }

  it('creates a comment on a contract', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const { contractId } = await seedContract(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: 'Contract note', contractId });

    expect(res.status).toBe(201);
    expect(res.body.contractId).toBe(contractId);
  });

  it('creates a comment on a contractVersion', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const { contractId } = await seedContract(authHeader, orgHeader);

    // Create a version via the contracts route
    const vRes = await request(app)
      .post(`/api/contracts/${contractId}/versions`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ storageKey: 'orgs/test/v1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 });
    const versionId = vRes.body.id as string;

    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: 'Version note', contractVersionId: versionId });

    expect(res.status).toBe(201);
    expect(res.body.contractVersionId).toBe(versionId);
  });

  it('creates a comment on a document', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    // Seed a document directly
    const doc = await db.document.create({
      data: {
        organizationId: orgHeader,
        matterId,
        filename: 'test.pdf',
        storageKey: 'fake/key.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      },
    });

    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: 'Document note', documentId: doc.id });

    expect(res.status).toBe(201);
    expect(res.body.documentId).toBe(doc.id);
  });

  it('returns 404 when contractId belongs to another org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const { contractId } = await seedContract(a.authHeader, a.orgHeader);

    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({ bodyMd: 'Stolen', contractId });

    expect(res.status).toBe(404);
  });

  it('returns 404 when documentId belongs to another org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);
    const doc = await db.document.create({
      data: {
        organizationId: a.orgHeader,
        matterId,
        filename: 'secret.pdf',
        storageKey: 'fake/secret.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 50,
      },
    });

    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({ bodyMd: 'Stolen', documentId: doc.id });

    expect(res.status).toBe(404);
  });

  it('returns 404 when contractVersionId belongs to another org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const { contractId } = await seedContract(a.authHeader, a.orgHeader);

    const vRes = await request(app)
      .post(`/api/contracts/${contractId}/versions`)
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ storageKey: 'orgs/test/v1.pdf', mimeType: 'application/pdf', sizeBytes: 1024 });
    const versionId = vRes.body.id as string;

    const res = await request(app)
      .post('/api/comments')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({ bodyMd: 'Stolen', contractVersionId: versionId });

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/comments/:id — error paths ──────────────────────────────────
describe('PATCH /api/comments/:id (error paths)', () => {
  it('returns 400 for empty bodyMd', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/comments')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: 'Original', matterId });

    const res = await request(app)
      .patch(`/api/comments/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: '' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent comment id', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .patch('/api/comments/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: 'Does not exist' });

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/comments/:id — error paths ─────────────────────────────────
describe('DELETE /api/comments/:id (error paths)', () => {
  it('returns 404 for non-existent comment id', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .delete('/api/comments/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });
});
