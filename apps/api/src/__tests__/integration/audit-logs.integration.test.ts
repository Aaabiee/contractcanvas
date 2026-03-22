/**
 * Integration tests for /api/organizations/:orgId/audit-logs.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

function logsUrl(orgId: string, path = '') {
  return `/api/organizations/${orgId}/audit-logs${path}`;
}

/** Seed a few audit-log rows directly in the DB. */
async function seedAuditLogs(orgId: string, actorId: string, count = 3) {
  const rows = Array.from({ length: count }, (_, i) => ({
    organizationId: orgId,
    actorId,
    entity:         'Contract',
    entityId:       `entity-${i}`,
    action:         i % 2 === 0 ? 'CREATE' : 'UPDATE',
    ip:             '127.0.0.1',
    userAgent:      'test-agent',
  }));
  await db.auditLog.createMany({ data: rows });
}

// ─── GET /api/organizations/:orgId/audit-logs ────────────────────────────────
describe('GET /api/organizations/:orgId/audit-logs', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/organizations/any/audit-logs');
    expect(res.status).toBe(401);
  });

  it('returns 403 for MEMBER role', async () => {
    const { authHeader, orgHeader, userId, email } = await seedAuth(app);

    await db.organizationMember.updateMany({
      where: { userId, organizationId: orgHeader },
      data:  { role: 'MEMBER' },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Password1!' });
    const memberHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .get(logsUrl(orgHeader))
      .set('Authorization', memberHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(403);
  });

  it('returns 200 with paginated audit logs for an OWNER', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);
    await seedAuditLogs(orgHeader, userId, 5);

    const res = await request(app)
      .get(logsUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('limit');
    expect(res.body).toHaveProperty('offset');
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
  });

  it('supports limit and offset pagination', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);
    await seedAuditLogs(orgHeader, userId, 10);

    const page1 = await request(app)
      .get(logsUrl(orgHeader, '?limit=3&offset=0'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(3);
    expect(page1.body.limit).toBe(3);
    expect(page1.body.offset).toBe(0);

    const page2 = await request(app)
      .get(logsUrl(orgHeader, '?limit=3&offset=3'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(3);
    expect(page2.body.offset).toBe(3);

    // Different pages should return different records
    const ids1 = page1.body.data.map((d: { id: string }) => d.id);
    const ids2 = page2.body.data.map((d: { id: string }) => d.id);
    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('filters by entity', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);

    await db.auditLog.createMany({
      data: [
        { organizationId: orgHeader, actorId: userId, entity: 'Contract', entityId: 'c1', action: 'CREATE' },
        { organizationId: orgHeader, actorId: userId, entity: 'Matter',   entityId: 'm1', action: 'CREATE' },
      ],
    });

    const res = await request(app)
      .get(logsUrl(orgHeader, '?entity=Contract'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.every((d: { entity: string }) => d.entity === 'Contract')).toBe(true);
  });

  it('filters by action', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);

    await db.auditLog.createMany({
      data: [
        { organizationId: orgHeader, actorId: userId, entity: 'Contract', entityId: 'c1', action: 'CREATE' },
        { organizationId: orgHeader, actorId: userId, entity: 'Contract', entityId: 'c2', action: 'DELETE' },
      ],
    });

    const res = await request(app)
      .get(logsUrl(orgHeader, '?action=DELETE'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.every((d: { action: string }) => d.action === 'DELETE')).toBe(true);
  });

  it('filters by actorId', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    // Add user B to org A so we can have two different actors in the same org
    await db.organizationMember.create({
      data: { organizationId: a.orgHeader, userId: b.userId, role: 'MEMBER' },
    });

    await db.auditLog.createMany({
      data: [
        { organizationId: a.orgHeader, actorId: a.userId, entity: 'Contract', entityId: 'c1', action: 'CREATE' },
        { organizationId: a.orgHeader, actorId: b.userId, entity: 'Contract', entityId: 'c2', action: 'CREATE' },
      ],
    });

    const res = await request(app)
      .get(logsUrl(a.orgHeader, `?actorId=${a.userId}`))
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader);

    expect(res.status).toBe(200);
    // Should only return logs where actorId matches user A
    const contractLogs = res.body.data.filter(
      (d: { entity: string }) => d.entity === 'Contract',
    );
    expect(contractLogs.every((d: { actorId: string }) => d.actorId === a.userId)).toBe(true);
  });

  it('returns logs scoped to the org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    await seedAuditLogs(a.orgHeader, a.userId, 3);

    const res = await request(app)
      .get(logsUrl(b.orgHeader))
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(200);
    // Org B should not see Org A logs (may see registration-related audit logs from seedAuth)
    const orgALogs = res.body.data.filter(
      (d: { entity: string }) => d.entity === 'Contract',
    );
    expect(orgALogs).toHaveLength(0);
  });
});

// ─── GET /api/organizations/:orgId/audit-logs/export.csv ─────────────────────
describe('GET /api/organizations/:orgId/audit-logs/export.csv', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/organizations/any/audit-logs/export.csv');
    expect(res.status).toBe(401);
  });

  it('returns 403 for MEMBER role', async () => {
    const { authHeader, orgHeader, userId, email } = await seedAuth(app);

    await db.organizationMember.updateMany({
      where: { userId, organizationId: orgHeader },
      data:  { role: 'MEMBER' },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Password1!' });
    const memberHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .get(logsUrl(orgHeader, '/export.csv'))
      .set('Authorization', memberHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(403);
  });

  it('returns CSV with correct content-type and headers', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);
    await seedAuditLogs(orgHeader, userId, 2);

    const res = await request(app)
      .get(logsUrl(orgHeader, '/export.csv'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment.*audit-logs\.csv/);

    // CSV should have a header row + data rows
    const lines = res.text.split('\r\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3); // header + at least 2 data rows
    expect(lines[0]).toContain('"id"');
    expect(lines[0]).toContain('"action"');
  });

  it('returns CSV with only header row when no logs exist', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get(logsUrl(orgHeader, '/export.csv'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    const lines = res.text.split('\r\n').filter(Boolean);
    // At minimum, the CSV header row exists
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain('"id"');
  });
});
