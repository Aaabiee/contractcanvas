/**
 * Integration tests for /api/clauses.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

// ─── GET /api/clauses ────────────────────────────────────────────────────────
describe('GET /api/clauses', () => {
  it('returns 401 without auth', async () => {
    expect((await request(app).get('/api/clauses')).status).toBe(401);
  });

  it('returns empty list when no clauses exist', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/clauses')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns clauses belonging to the org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    await request(app)
      .post('/api/clauses')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Org A Clause', bodyMd: 'Content of clause A', tags: ['nda'] });

    // Org B should not see org A's private clause
    const res = await request(app)
      .get('/api/clauses')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.body.data).toHaveLength(0);
  });

  it('includes public clauses from other orgs', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    await request(app)
      .post('/api/clauses')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Public NDA Clause', bodyMd: 'Standard NDA terms', isPublic: true });

    const res = await request(app)
      .get('/api/clauses')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Public NDA Clause');
  });

  it('filters clauses by search query (title match)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    await request(app).post('/api/clauses').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'Limitation of Liability', bodyMd: 'Content A' });
    await request(app).post('/api/clauses').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'Indemnification Clause', bodyMd: 'Content B' });

    const res = await request(app)
      .get('/api/clauses?q=liability')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Limitation of Liability');
  });

  it('filters clauses by search query (body match, case-insensitive)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    await request(app).post('/api/clauses').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'General Terms', bodyMd: 'This clause covers INDEMNIFICATION matters.' });
    await request(app).post('/api/clauses').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'Another Clause', bodyMd: 'Unrelated content here.' });

    const res = await request(app)
      .get('/api/clauses?q=indemnification')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('General Terms');
  });
});

// ─── POST /api/clauses ───────────────────────────────────────────────────────
describe('POST /api/clauses', () => {
  it('creates a clause and persists it in DB', async () => {
    const { authHeader, orgHeader, orgId } = await seedAuth(app);

    const res = await request(app)
      .post('/api/clauses')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        title:    'Force Majeure',
        bodyMd:   'Neither party shall be liable for...',
        tags:     ['standard', 'force-majeure'],
        isPublic: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Force Majeure');
    expect(res.body.organizationId).toBe(orgId);
    expect(res.body.tags).toEqual(['standard', 'force-majeure']);

    const dbRecord = await db.clause.findUnique({ where: { id: res.body.id } });
    expect(dbRecord).not.toBeNull();
  });

  it('defaults tags to [] and isPublic to false', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/clauses')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Minimal', bodyMd: 'Body text here.' });

    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual([]);
    expect(res.body.isPublic).toBe(false);
  });

  it('returns 400 for missing title', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/clauses')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ bodyMd: 'Missing title' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing bodyMd', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/clauses')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Title only' });

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/clauses/:id ────────────────────────────────────────────────────
describe('GET /api/clauses/:id', () => {
  it('returns the clause by id', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const create = await request(app)
      .post('/api/clauses')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Get Me', bodyMd: 'Retrieve this clause.' });

    const res = await request(app)
      .get(`/api/clauses/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Get Me');
  });

  it('returns 404 for non-existent clause', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/clauses/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns 404 for a private clause from another org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const create = await request(app)
      .post('/api/clauses')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Private', bodyMd: 'Secret terms.', isPublic: false });

    const res = await request(app)
      .get(`/api/clauses/${create.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns a public clause from another org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const create = await request(app)
      .post('/api/clauses')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Public Clause', bodyMd: 'Shared terms.', isPublic: true });

    const res = await request(app)
      .get(`/api/clauses/${create.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Public Clause');
  });
});

// ─── PATCH /api/clauses/:id ──────────────────────────────────────────────────
describe('PATCH /api/clauses/:id', () => {
  it('updates title, body and tags', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const create = await request(app)
      .post('/api/clauses')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Original', bodyMd: 'Old body.' });

    const res = await request(app)
      .patch(`/api/clauses/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Revised', bodyMd: 'New body.', tags: ['updated'] });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Revised');
    expect(res.body.bodyMd).toBe('New body.');
    expect(res.body.tags).toEqual(['updated']);
  });

  it("returns 404 when patching a different org's clause", async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const create = await request(app)
      .post('/api/clauses')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Org A clause', bodyMd: 'Content.' });

    const res = await request(app)
      .patch(`/api/clauses/${create.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({ title: 'Hijacked' });

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/clauses/:id ─────────────────────────────────────────────────
describe('DELETE /api/clauses/:id', () => {
  it('permanently deletes the clause', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const create = await request(app)
      .post('/api/clauses')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Delete Me', bodyMd: 'Gone soon.' });

    const res = await request(app)
      .delete(`/api/clauses/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(204);

    const dbRecord = await db.clause.findUnique({ where: { id: create.body.id } });
    expect(dbRecord).toBeNull();
  });

  it('returns 404 when deleting a clause from another org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const create = await request(app)
      .post('/api/clauses')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Private Clause', bodyMd: 'Content.' });

    const res = await request(app)
      .delete(`/api/clauses/${create.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns 404 when clause does not exist', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .delete('/api/clauses/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });
});
