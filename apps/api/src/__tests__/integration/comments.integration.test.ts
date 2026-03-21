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
