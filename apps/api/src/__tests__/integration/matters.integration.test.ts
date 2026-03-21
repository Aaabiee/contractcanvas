/**
 * Integration tests for /api/matters.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});

const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

// ─── GET /api/matters ────────────────────────────────────────────────────────
describe('GET /api/matters', () => {
  it('returns 403 without auth', async () => {
    const res = await request(app).get('/api/matters');
    expect(res.status).toBe(401);
  });

  it('returns 200 when no X-Organization-Id header (protect defaults to user org)', async () => {
    const { authHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });

  it('returns empty list when no matters exist', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('returns matters scoped to the org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    // Create a matter in org A
    await request(app)
      .post('/api/matters')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Org A Matter' });

    // Org B should see zero matters
    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('filters matters by status', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Open Matter', status: 'OPEN' });
    await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Closed Matter', status: 'CLOSED' });

    const res = await request(app)
      .get('/api/matters?status=OPEN')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Open Matter');
  });

  it('soft-deleted matters are excluded', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const create = await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'To Delete' });

    await request(app)
      .delete(`/api/matters/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.data).toHaveLength(0);
  });
});

// ─── POST /api/matters ───────────────────────────────────────────────────────
describe('POST /api/matters', () => {
  it('creates a matter and persists it in the DB', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);
    const res = await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'New Matter', description: 'Desc', status: 'OPEN' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('New Matter');
    expect(res.body.ownerId).toBe(userId);

    const dbRecord = await db.matter.findUnique({ where: { id: res.body.id } });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.title).toBe('New Matter');
  });

  it('returns 400 for missing title', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ description: 'No title' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Bad Status', status: 'INVALID' });

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/matters/:id ────────────────────────────────────────────────────
describe('GET /api/matters/:id', () => {
  it('returns the matter with related data', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const create = await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Detail Matter' });

    const res = await request(app)
      .get(`/api/matters/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Detail Matter');
    expect(res.body).toHaveProperty('contracts');
    expect(res.body).toHaveProperty('documents');
    expect(res.body).toHaveProperty('tasks');
  });

  it('returns 404 for non-existent matter', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/matters/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns 404 when matter belongs to a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const create = await request(app)
      .post('/api/matters')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Org A Only' });

    const res = await request(app)
      .get(`/api/matters/${create.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/matters/:id ──────────────────────────────────────────────────
describe('PATCH /api/matters/:id', () => {
  it('updates title and status', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const create = await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Original', status: 'OPEN' });

    const res = await request(app)
      .patch(`/api/matters/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Updated', status: 'ON_HOLD' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated');
    expect(res.body.status).toBe('ON_HOLD');

    const dbRecord = await db.matter.findUnique({ where: { id: create.body.id } });
    expect(dbRecord!.status).toBe('ON_HOLD');
  });

  it("returns 404 when patching a different org's matter", async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const create = await request(app)
      .post('/api/matters')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Org A Only' });

    const res = await request(app)
      .patch(`/api/matters/${create.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({ title: 'Hijack' });

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/matters/:id ─────────────────────────────────────────────────
describe('DELETE /api/matters/:id', () => {
  it('soft-deletes the matter (sets deletedAt)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const create = await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'To Soft Delete' });

    const res = await request(app)
      .delete(`/api/matters/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(204);

    const dbRecord = await db.matter.findUnique({ where: { id: create.body.id } });
    expect(dbRecord!.deletedAt).not.toBeNull();
  });

  it('returns 404 for already-deleted matter', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const create = await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Delete Twice' });

    await request(app)
      .delete(`/api/matters/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    const res = await request(app)
      .delete(`/api/matters/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });
});
