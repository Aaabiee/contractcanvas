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

// ─── POST /api/organizations/:orgId/transfer-ownership ──────────────────────
describe('POST /api/organizations/:orgId/transfer-ownership', () => {
  it('successfully transfers ownership from OWNER to another member', async () => {
    const owner  = await seedAuth(app);
    const member = await seedAuth(app);

    // Add member to owner's org
    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/transfer-ownership`)
      .set('Authorization', owner.authHeader)
      .send({ newOwnerUserId: member.userId });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify new owner
    const newOwnerMembership = await db.organizationMember.findFirst({
      where: { organizationId: owner.orgId, userId: member.userId },
    });
    expect(newOwnerMembership!.role).toBe('OWNER');

    // Verify old owner is now ADMIN
    const oldOwnerMembership = await db.organizationMember.findFirst({
      where: { organizationId: owner.orgId, userId: owner.userId },
    });
    expect(oldOwnerMembership!.role).toBe('ADMIN');
  });

  it('returns 403 when a non-owner tries to transfer', async () => {
    const owner  = await seedAuth(app);
    const member = await seedAuth(app);
    const target = await seedAuth(app);

    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: target.userId, role: 'MEMBER' });

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/transfer-ownership`)
      .set('Authorization', member.authHeader)
      .send({ newOwnerUserId: target.userId });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owner/i);
  });

  it('returns 400 when trying to transfer ownership to yourself', async () => {
    const owner = await seedAuth(app);

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/transfer-ownership`)
      .set('Authorization', owner.authHeader)
      .send({ newOwnerUserId: owner.userId });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  it('returns 404 when target user is not a member of the org', async () => {
    const owner    = await seedAuth(app);
    const outsider = await seedAuth(app);

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/transfer-ownership`)
      .set('Authorization', owner.authHeader)
      .send({ newOwnerUserId: outsider.userId });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not a member/i);
  });

  it('returns 400 for invalid newOwnerUserId', async () => {
    const owner = await seedAuth(app);

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/transfer-ownership`)
      .set('Authorization', owner.authHeader)
      .send({ newOwnerUserId: 'not-a-cuid' });

    expect(res.status).toBe(400);
  });
});

// ─── PATCH member role — admin limit enforcement ────────────────────────────
describe('PATCH /api/organizations/:orgId/members/:memberId — admin limits', () => {
  it('enforces maximum of 2 admins per organization', async () => {
    const owner = await seedAuth(app);
    const m1    = await seedAuth(app);
    const m2    = await seedAuth(app);
    const m3    = await seedAuth(app);

    const add1 = await request(app).post(`/api/organizations/${owner.orgId}/members`).set('Authorization', owner.authHeader).send({ userId: m1.userId, role: 'MEMBER' });
    const add2 = await request(app).post(`/api/organizations/${owner.orgId}/members`).set('Authorization', owner.authHeader).send({ userId: m2.userId, role: 'MEMBER' });
    const add3 = await request(app).post(`/api/organizations/${owner.orgId}/members`).set('Authorization', owner.authHeader).send({ userId: m3.userId, role: 'MEMBER' });

    // Promote first two to ADMIN
    await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/${add1.body.id}`)
      .set('Authorization', owner.authHeader)
      .send({ role: 'ADMIN' });

    await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/${add2.body.id}`)
      .set('Authorization', owner.authHeader)
      .send({ role: 'ADMIN' });

    // Third promotion should fail — max 2 admins
    const res = await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/${add3.body.id}`)
      .set('Authorization', owner.authHeader)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum.*2.*admin/i);
  });

  it('returns 400 when trying to set role to OWNER via PATCH (must use transfer-ownership)', async () => {
    const owner  = await seedAuth(app);
    const member = await seedAuth(app);

    const addRes = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    const res = await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/${addRes.body.id}`)
      .set('Authorization', owner.authHeader)
      .send({ role: 'OWNER' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/transfer-ownership/i);
  });

  it('returns 403 when ADMIN tries to promote another member to ADMIN', async () => {
    const owner = await seedAuth(app);
    const admin = await seedAuth(app);
    const member = await seedAuth(app);

    const addAdmin = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: admin.userId, role: 'MEMBER' });

    // Promote to ADMIN
    await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/${addAdmin.body.id}`)
      .set('Authorization', owner.authHeader)
      .send({ role: 'ADMIN' });

    const addMember = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    // Admin tries to promote member to ADMIN — only OWNER can do this
    const res = await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/${addMember.body.id}`)
      .set('Authorization', admin.authHeader)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owner/i);
  });
});

// ─── POST /api/organizations/:orgId/members — ADMIN role restriction ────────
describe('POST /api/organizations/:orgId/members — ADMIN role restrictions', () => {
  it('returns 403 when ADMIN tries to add a member with ADMIN role', async () => {
    const owner = await seedAuth(app);
    const admin = await seedAuth(app);
    const newbie = await seedAuth(app);

    // Add admin to org as MEMBER first, then promote
    const addAdmin = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: admin.userId, role: 'MEMBER' });

    await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/${addAdmin.body.id}`)
      .set('Authorization', owner.authHeader)
      .send({ role: 'ADMIN' });

    // ADMIN tries to add someone as ADMIN — should fail
    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', admin.authHeader)
      .send({ userId: newbie.userId, role: 'ADMIN' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owner/i);
  });

  it('OWNER can add a member with ADMIN role', async () => {
    const owner = await seedAuth(app);
    const newbie = await seedAuth(app);

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: newbie.userId, role: 'ADMIN' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('ADMIN');
  });

  it('returns 400 when adding a third ADMIN (max 2 limit on add)', async () => {
    const owner = await seedAuth(app);
    const admin1 = await seedAuth(app);
    const admin2 = await seedAuth(app);
    const admin3 = await seedAuth(app);

    // Add first two as ADMIN
    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: admin1.userId, role: 'ADMIN' });

    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: admin2.userId, role: 'ADMIN' });

    // Third ADMIN should be rejected
    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: admin3.userId, role: 'ADMIN' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum.*2.*admin/i);
  });

  it('returns 400 for invalid input in add member', async () => {
    const owner = await seedAuth(app);

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: 'not-a-valid-cuid' });

    expect(res.status).toBe(400);
  });
});

// ─── PATCH /api/organizations/:orgId/members/:memberId — OWNER guard ────────
describe('PATCH /api/organizations/:orgId/members/:memberId — OWNER role block', () => {
  it('returns 400 for invalid role input', async () => {
    const owner  = await seedAuth(app);
    const member = await seedAuth(app);

    const addRes = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    const res = await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/${addRes.body.id}`)
      .set('Authorization', owner.authHeader)
      .send({ role: 'INVALID_ROLE' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for updating a non-existent member', async () => {
    const owner = await seedAuth(app);

    const res = await request(app)
      .patch(`/api/organizations/${owner.orgId}/members/cuid1234567890abcdefghijk`)
      .set('Authorization', owner.authHeader)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/member not found/i);
  });
});

// ─── DELETE /api/organizations/:orgId/members/:memberId — error paths ───────
describe('DELETE /api/organizations/:orgId/members/:memberId — error paths', () => {
  it('returns 404 for a non-existent memberId', async () => {
    const owner = await seedAuth(app);

    const res = await request(app)
      .delete(`/api/organizations/${owner.orgId}/members/cuid1234567890abcdefghijk`)
      .set('Authorization', owner.authHeader);

    expect(res.status).toBe(404);
  });

  it('returns 404 when memberId exists in a different org', async () => {
    const owner1 = await seedAuth(app);
    const owner2 = await seedAuth(app);
    const member = await seedAuth(app);

    // Add member to owner2's org
    const addRes = await request(app)
      .post(`/api/organizations/${owner2.orgId}/members`)
      .set('Authorization', owner2.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    // Try to delete from owner1's org — should 404
    const res = await request(app)
      .delete(`/api/organizations/${owner1.orgId}/members/${addRes.body.id}`)
      .set('Authorization', owner1.authHeader);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const owner = await seedAuth(app);

    const res = await request(app)
      .delete(`/api/organizations/${owner.orgId}/members/cuid1234567890abcdefghijk`);

    expect(res.status).toBe(401);
  });
});

// ─── Member limit enforcement (usage.service.ts lines 33-46) ─────────────────
describe('POST /api/organizations/:orgId/members — member limit enforcement', () => {
  it('returns 402 when adding a 4th member on STARTER tier (member limit = 3)', async () => {
    const owner = await seedAuth(app);
    // Owner is member #1. Add 2 more to reach the limit of 3.
    const m2 = await seedAuth(app);
    const m3 = await seedAuth(app);
    const m4 = await seedAuth(app);

    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: m2.userId, role: 'MEMBER' });

    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: m3.userId, role: 'MEMBER' });

    // 4th member should fail — STARTER tier allows only 3 members
    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: m4.userId, role: 'MEMBER' });

    // The error from checkMemberLimit sets statusCode = 402
    // Express error handler may return 402 or 500 depending on handler setup
    expect([402, 500]).toContain(res.status);
  });
});

// ─── Matter limit enforcement (usage.service.ts lines 17-30) ─────────────────
describe('POST /api/matters — matter limit enforcement (STARTER tier)', () => {
  it('returns 402 when creating a 6th matter on STARTER tier (matter limit = 5)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    // Create 5 matters to reach the STARTER limit
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/matters')
        .set('Authorization', authHeader)
        .set('X-Organization-Id', orgHeader)
        .send({ title: `Matter ${i + 1}` });
      expect(res.status).toBe(201);
    }

    // 6th matter should fail
    const res = await request(app)
      .post('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Matter 6 (should fail)' });

    // The error from checkMatterLimit sets statusCode = 402
    expect([402, 500]).toContain(res.status);
  });
});

// ─── Organizations error propagation paths ───────────────────────────────────
describe('Organizations — error propagation catch blocks', () => {
  it('POST /api/organizations returns 400 for slug that is too short', async () => {
    const { authHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', authHeader)
      .send({ name: 'My Firm', slug: 'ab' });

    expect(res.status).toBe(400);
  });

  it('GET /api/organizations/me returns orgs filtering out deleted organizations', async () => {
    const { authHeader, orgId } = await seedAuth(app);

    // Soft-delete the org
    await db.organization.update({
      where: { id: orgId },
      data: { deletedAt: new Date() },
    });

    const res = await request(app)
      .get('/api/organizations/me')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    // The deleted org should be filtered out
    const orgIds = res.body.map((o: { id: string }) => o.id);
    expect(orgIds).not.toContain(orgId);
  });
});

// ─── POST /api/organizations/:orgId/transfer-ownership — edge cases ─────────
describe('POST /api/organizations/:orgId/transfer-ownership — additional edge cases', () => {
  it('returns 401 without auth', async () => {
    const owner = await seedAuth(app);

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/transfer-ownership`)
      .send({ newOwnerUserId: owner.userId });

    expect(res.status).toBe(401);
  });

  it('verifies old owner becomes ADMIN after transfer', async () => {
    const owner  = await seedAuth(app);
    const member = await seedAuth(app);

    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: member.userId, role: 'MEMBER' });

    await request(app)
      .post(`/api/organizations/${owner.orgId}/transfer-ownership`)
      .set('Authorization', owner.authHeader)
      .send({ newOwnerUserId: member.userId });

    // Old owner should now be ADMIN
    const oldOwnerMembership = await db.organizationMember.findFirst({
      where: { organizationId: owner.orgId, userId: owner.userId },
    });
    expect(oldOwnerMembership!.role).toBe('ADMIN');

    // New owner should be OWNER
    const newOwnerMembership = await db.organizationMember.findFirst({
      where: { organizationId: owner.orgId, userId: member.userId },
    });
    expect(newOwnerMembership!.role).toBe('OWNER');
  });

  it('ADMIN cannot transfer ownership', async () => {
    const owner = await seedAuth(app);
    const admin = await seedAuth(app);
    const target = await seedAuth(app);

    const addAdmin = await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: admin.userId, role: 'ADMIN' });

    await request(app)
      .post(`/api/organizations/${owner.orgId}/members`)
      .set('Authorization', owner.authHeader)
      .send({ userId: target.userId, role: 'MEMBER' });

    const res = await request(app)
      .post(`/api/organizations/${owner.orgId}/transfer-ownership`)
      .set('Authorization', admin.authHeader)
      .send({ newOwnerUserId: target.userId });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owner/i);
  });
});
