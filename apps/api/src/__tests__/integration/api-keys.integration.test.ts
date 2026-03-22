/**
 * Integration tests for /api/organizations/:orgId/api-keys.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

function keyUrl(orgId: string, keyId?: string) {
  const base = `/api/organizations/${orgId}/api-keys`;
  return keyId ? `${base}/${keyId}` : base;
}

// ─── GET /api/organizations/:orgId/api-keys ──────────────────────────────────
describe('GET /api/organizations/:orgId/api-keys', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/organizations/any/api-keys');
    expect(res.status).toBe(401);
  });

  it('returns 403 for MEMBER role', async () => {
    const { authHeader, orgHeader, userId, email } = await seedAuth(app);

    // Downgrade to MEMBER
    await db.organizationMember.updateMany({
      where: { userId, organizationId: orgHeader },
      data:  { role: 'MEMBER' },
    });

    // Re-login to pick up the updated role
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Password1!' });
    const memberHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .get(keyUrl(orgHeader))
      .set('Authorization', memberHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(403);
  });

  it('returns 403 when requesting keys for a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const res = await request(app)
      .get(keyUrl(b.orgHeader))
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader);

    expect(res.status).toBe(403);
  });

  it('returns empty list when no keys exist', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get(keyUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(0);
  });
});

// ─── POST /api/organizations/:orgId/api-keys ─────────────────────────────────
describe('POST /api/organizations/:orgId/api-keys', () => {
  it('creates an API key and returns rawKey', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post(keyUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ name: 'CI Token' });

    expect(res.status).toBe(201);
    expect(res.body.key).toBeDefined();
    expect(res.body.key.name).toBe('CI Token');
    expect(res.body.key.rawKey).toMatch(/^cc_live_/);
    expect(res.body.key.prefix).toBeDefined();
    expect(res.body.key.id).toBeDefined();

    // Verify persisted in DB
    const dbKey = await db.apiKey.findUnique({ where: { id: res.body.key.id } });
    expect(dbKey).not.toBeNull();
    expect(dbKey!.revokedAt).toBeNull();
  });

  it('returns 400 for missing name', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post(keyUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 for empty name', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post(keyUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
  });

  it('created key appears in GET list', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    await request(app)
      .post(keyUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ name: 'First Key' });

    await request(app)
      .post(keyUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ name: 'Second Key' });

    const res = await request(app)
      .get(keyUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(2);
    // Ordered by createdAt desc — newest first
    expect(res.body.keys[0].name).toBe('Second Key');
    expect(res.body.keys[1].name).toBe('First Key');
  });
});

// ─── DELETE /api/organizations/:orgId/api-keys/:keyId ────────────────────────
describe('DELETE /api/organizations/:orgId/api-keys/:keyId', () => {
  it('revokes an API key (sets revokedAt)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(keyUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ name: 'Revoke Me' });

    const keyId = createRes.body.key.id;

    const res = await request(app)
      .delete(keyUrl(orgHeader, keyId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify revoked in DB
    const dbKey = await db.apiKey.findUnique({ where: { id: keyId } });
    expect(dbKey!.revokedAt).not.toBeNull();
  });

  it('revoked key no longer appears in GET list', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(keyUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ name: 'Temp Key' });

    const keyId = createRes.body.key.id;

    await request(app)
      .delete(keyUrl(orgHeader, keyId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    const listRes = await request(app)
      .get(keyUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(listRes.body.keys).toHaveLength(0);
  });

  it('returns 404 for non-existent key', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .delete(keyUrl(orgHeader, 'cuid1234567890abcdefghijk'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns 403 when revoking a key from a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    // Create key in org A
    const createRes = await request(app)
      .post(keyUrl(a.orgHeader))
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ name: 'Org A Key' });

    const keyId = createRes.body.key.id;

    // Try to delete from org B
    const res = await request(app)
      .delete(keyUrl(a.orgHeader, keyId))
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(403);
  });
});
