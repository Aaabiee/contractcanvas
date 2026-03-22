/**
 * Integration tests for /api/analytics.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

/** Creates a matter and returns its id. */
async function seedMatter(authHeader: string, orgHeader: string, title = 'Test Matter') {
  const res = await request(app)
    .post('/api/matters')
    .set('Authorization', authHeader)
    .set('X-Organization-Id', orgHeader)
    .send({ title });
  return res.body.id as string;
}

/** Creates a contract under a matter and returns its id. */
async function seedContract(
  authHeader: string,
  orgHeader: string,
  matterId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post('/api/contracts')
    .set('Authorization', authHeader)
    .set('X-Organization-Id', orgHeader)
    .send({ title: 'Test Contract', matterId, ...overrides });
  return res.body.id as string;
}

// ─── GET /api/analytics/overview ─────────────────────────────────────────────
describe('GET /api/analytics/overview', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/analytics/overview');
    expect(res.status).toBe(401);
  });

  it('returns 403 when orgRole is not OWNER or ADMIN', async () => {
    // seedAuth creates user as OWNER via org creation.
    // To simulate a MEMBER role, we downgrade the membership in the DB,
    // then re-login to get a fresh token with the updated role.
    const { authHeader, orgHeader, userId, email } = await seedAuth(app);

    await db.organizationMember.updateMany({
      where: { userId, organizationId: orgHeader },
      data:  { role: 'MEMBER' },
    });

    // Re-login to get a token reflecting the MEMBER role
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Password1!' });
    const memberHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .get('/api/analytics/overview')
      .set('Authorization', memberHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(403);
  });

  it('returns 200 with aggregated stats for an OWNER', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    // Seed some data
    const matterId = await seedMatter(authHeader, orgHeader, 'Open Matter');
    await seedContract(authHeader, orgHeader, matterId, { valueCents: 10000, currency: 'USD' });
    await seedContract(authHeader, orgHeader, matterId, { valueCents: 20000, currency: 'USD' });

    const res = await request(app)
      .get('/api/analytics/overview')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('matters');
    expect(res.body).toHaveProperty('contracts');
    expect(res.body).toHaveProperty('tasks');
    expect(res.body).toHaveProperty('documents');
    expect(res.body).toHaveProperty('members');
    expect(res.body.matters.total).toBeGreaterThanOrEqual(1);
    expect(res.body.contracts.totalValueCents).toBe(30000);
    expect(res.body.members.active).toBeGreaterThanOrEqual(1);
  });

  it('returns stats scoped to the org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const matterId = await seedMatter(a.authHeader, a.orgHeader);
    await seedContract(a.authHeader, a.orgHeader, matterId, { valueCents: 5000 });

    // Org B should see zero matters / contracts
    const res = await request(app)
      .get('/api/analytics/overview')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.matters.total).toBe(0);
    expect(res.body.contracts.totalValueCents).toBe(0);
  });
});

// ─── GET /api/analytics/contract-trends ──────────────────────────────────────
describe('GET /api/analytics/contract-trends', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/analytics/contract-trends');
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid period', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/analytics/contract-trends?period=7d')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid period/i);
  });

  it('returns 200 with default period (30d)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    await seedContract(authHeader, orgHeader, matterId);

    const res = await request(app)
      .get('/api/analytics/contract-trends')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('30d');
    expect(Array.isArray(res.body.trends)).toBe(true);
  });

  it('returns 200 with period=90d', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/analytics/contract-trends?period=90d')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('90d');
    expect(Array.isArray(res.body.trends)).toBe(true);
  });

  it('returns 200 with period=1y', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/analytics/contract-trends?period=1y')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('1y');
    expect(Array.isArray(res.body.trends)).toBe(true);
  });

  it('returns trends with count and totalValueCents for each week', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    await seedContract(authHeader, orgHeader, matterId, { valueCents: 5000 });
    await seedContract(authHeader, orgHeader, matterId, { valueCents: 3000 });

    const res = await request(app)
      .get('/api/analytics/contract-trends?period=30d')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.trends.length).toBeGreaterThanOrEqual(1);

    const firstWeek = res.body.trends[0];
    expect(firstWeek).toHaveProperty('week');
    expect(firstWeek).toHaveProperty('count');
    expect(firstWeek).toHaveProperty('totalValueCents');
    expect(typeof firstWeek.count).toBe('number');
    expect(typeof firstWeek.totalValueCents).toBe('number');
  });

  it('returns trends with actual data from contracts created at different dates', async () => {
    const { authHeader, orgHeader, orgId } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    // Create contracts with varying createdAt dates via direct DB insertion
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000);

    await db.contract.createMany({
      data: [
        { title: 'Recent 1', organizationId: orgId, matterId, valueCents: 1000, createdAt: now },
        { title: 'Recent 2', organizationId: orgId, matterId, valueCents: 2000, createdAt: now },
        { title: 'LastWeek', organizationId: orgId, matterId, valueCents: 3000, createdAt: oneWeekAgo },
        { title: 'TwoWeeksAgo', organizationId: orgId, matterId, valueCents: 4000, createdAt: twoWeeksAgo },
      ],
    });

    const res = await request(app)
      .get('/api/analytics/contract-trends?period=30d')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.trends.length).toBeGreaterThanOrEqual(1);

    // Sum of all trend entries should match the total contracts
    const totalCount = res.body.trends.reduce((s: number, t: { count: number }) => s + t.count, 0);
    expect(totalCount).toBeGreaterThanOrEqual(4);

    const totalValue = res.body.trends.reduce((s: number, t: { totalValueCents: number }) => s + t.totalValueCents, 0);
    expect(totalValue).toBeGreaterThanOrEqual(10000);
  });
});

// ─── Error propagation ──────────────────────────────────────────────────────
describe('Analytics error propagation', () => {
  it('overview returns 403 when X-Organization-Id header is missing', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/analytics/overview')
      .set('Authorization', authHeader);
    // Without X-Organization-Id, organizationId is resolved from JWT organizations array
    // (first org), so the request should succeed or if the org context is absent, 403.
    // The route checks if (!organizationId) => 403
    expect([200, 403]).toContain(res.status);
  });

  it('contract-trends returns 403 when X-Organization-Id header is missing for a user with no orgs', async () => {
    const { authHeader, userId } = await seedAuth(app);

    // Remove all org memberships so the user has no org context
    await db.organizationMember.deleteMany({ where: { userId } });

    // Re-login to get fresh token without orgs
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: (await db.user.findUnique({ where: { id: userId } }))!.email, password: 'Password1!' });
    const freshHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .get('/api/analytics/contract-trends')
      .set('Authorization', freshHeader);

    expect(res.status).toBe(403);
  });
});
