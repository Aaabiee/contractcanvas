/**
 * Integration tests for /api/organizations.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

// ─── POST /api/organizations ─────────────────────────────────────────────────
describe('POST /api/organizations', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/organizations')
      .send({ name: 'Test', slug: 'test' });
    expect(res.status).toBe(401);
  });

  it('creates org and makes requester OWNER', async () => {
    const { authHeader, userId } = await seedAuth(app);
    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', authHeader)
      .send({ name: 'Second Firm', slug: 'second-firm' });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('second-firm');

    const membership = await db.organizationMember.findFirst({
      where: { organizationId: res.body.id, userId },
    });
    expect(membership?.role).toBe('OWNER');
  });

  it('returns 409 when slug is already taken', async () => {
    const { authHeader } = await seedAuth(app);
    await request(app)
      .post('/api/organizations')
      .set('Authorization', authHeader)
      .send({ name: 'Firm', slug: 'my-firm' });

    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', authHeader)
      .send({ name: 'Other Firm', slug: 'my-firm' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/slug/i);
  });

  it('returns 400 for missing name', async () => {
    const { authHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', authHeader)
      .send({ slug: 'valid-slug' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid slug (uppercase)', async () => {
    const { authHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', authHeader)
      .send({ name: 'My Firm', slug: 'My-Firm' });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/organizations/me ───────────────────────────────────────────────
describe('GET /api/organizations/me', () => {
  it('returns 401 without auth', async () => {
    expect((await request(app).get('/api/organizations/me')).status).toBe(401);
  });

  it('returns the orgs the current user belongs to', async () => {
    const { authHeader, orgId } = await seedAuth(app);
    const res = await request(app)
      .get('/api/organizations/me')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe(orgId);
    expect(res.body[0].userRole).toBe('OWNER');
  });

  it('returns multiple orgs when user belongs to several', async () => {
    const { authHeader } = await seedAuth(app);

    await request(app)
      .post('/api/organizations')
      .set('Authorization', authHeader)
      .send({ name: 'Second Org', slug: `second-org-${Date.now()}` });

    const res = await request(app)
      .get('/api/organizations/me')
      .set('Authorization', authHeader);

    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── GET /api/organizations/:orgId/members ───────────────────────────────────
describe('GET /api/organizations/:orgId/members', () => {
  it('returns 401 without auth', async () => {
    const { orgId } = await seedAuth(app);
    const res = await request(app).get(`/api/organizations/${orgId}/members`);
    expect(res.status).toBe(401);
  });

  it('returns members for the org', async () => {
    const { authHeader, orgId } = await seedAuth(app);
    const res = await request(app)
      .get(`/api/organizations/${orgId}/members`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].role).toBe('OWNER');
  });

  it('returns 403 when user is not a member', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const res = await request(app)
      .get(`/api/organizations/${a.orgId}/members`)
      .set('Authorization', b.authHeader);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/organizations/:orgId/members ──────────────────────────────────
describe('POST /api/organizations/:orgId/members', () => {
  it('allows an OWNER to add a member by userId', async () => {
    const owner  = await seedAuth(app);
    const newbie = await seedAuth(app);

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: newbie.userId, role: 'MEMBER' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('MEMBER');

    const membership = await db.organizationMember.findFirst({
      where: { organizationId: owner.orgId, userId: newbie.userId },
    });
    expect(membership).not.toBeNull();
  });

  it('returns 403 when a plain MEMBER tries to add someone', async () => {
    const owner  = await seedAuth(app);
    const member = await seedAuth(app);
    const newbie = await seedAuth(app);

    // Add member as MEMBER role
    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', member.authHeader)
      .send({ userId: newbie.userId, role: 'MEMBER' });

    expect(res.status).toBe(403);
  });

  it('returns 409 when user is already a member', async () => {
    const owner  = await seedAuth(app);
    const member = await seedAuth(app);

    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'ADMIN' });

    expect(res.status).toBe(409);
  });

  it('returns 404 when userId does not exist', async () => {
    const { authHeader, orgId } = await seedAuth(app);
    const res = await request(app)
      .post(`/api/organizations/${orgId}/members`)
      .set('Authorization', authHeader)
      .send({ userId: 'cuid1234567890abcdefghijk', role: 'MEMBER' });

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/organizations/:orgId/members/:memberId ───────────────────────
describe('PATCH /api/organizations/:orgId/members/:memberId', () => {
  it('OWNER can update a member role', async () => {
    const owner  = await seedAuth(app);
    const member = await seedAuth(app);

    const addRes = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    const memberId = addRes.body.id;

    const res = await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/${memberId}`)
      .set('Authorization', owner.authHeader)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ADMIN');
  });

  it('returns 403 when a plain MEMBER tries to update roles', async () => {
    const owner  = await seedAuth(app);
    const m1     = await seedAuth(app);
    const m2     = await seedAuth(app);

    const add1 = await request(app).post(`/api/organizations/${owner.orgId}/members`).set('Authorization', owner.authHeader).send({ userId: m1.userId, role: 'MEMBER' });
    const add2 = await request(app).post(`/api/organizations/${owner.orgId}/members`).set('Authorization', owner.authHeader).send({ userId: m2.userId, role: 'MEMBER' });

    const res = await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/${add2.body.id}`)
      .set('Authorization', m1.authHeader)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/organizations/:orgId/members/:memberId ──────────────────────
describe('DELETE /api/organizations/:orgId/members/:memberId', () => {
  it('OWNER can remove a member', async () => {
    const owner  = await seedAuth(app);
    const member = await seedAuth(app);

    const addRes = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    const res = await request(app)
      .delete(`/api/organizations/${owner.orgId}/members/${addRes.body.id}`)
      .set('Authorization', owner.authHeader);

    expect(res.status).toBe(204);

    const membership = await db.organizationMember.findUnique({ where: { id: addRes.body.id } });
    expect(membership).toBeNull();
  });

  it('user can remove themselves (self-removal)', async () => {
    const owner  = await seedAuth(app);
    const member = await seedAuth(app);

    const addRes = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    const res = await request(app)
      .delete(`/api/organizations/${owner.orgId}/members/${addRes.body.id}`)
      .set('Authorization', member.authHeader);

    expect(res.status).toBe(204);
  });

  it('returns 403 when non-admin tries to remove another member', async () => {
    const owner = await seedAuth(app);
    const m1    = await seedAuth(app);
    const m2    = await seedAuth(app);

    const add1 = await request(app).post(`/api/organizations/${owner.orgId}/members`).set('Authorization', owner.authHeader).send({ userId: m1.userId, role: 'MEMBER' });
    const add2 = await request(app).post(`/api/organizations/${owner.orgId}/members`).set('Authorization', owner.authHeader).send({ userId: m2.userId, role: 'MEMBER' });

    const res = await request(app)
      .delete(`/api/organizations/${owner.orgId}/members/${add2.body.id}`)
      .set('Authorization', m1.authHeader);

    expect(res.status).toBe(403);
  });
});
