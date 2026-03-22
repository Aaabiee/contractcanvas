/**
 * Integration tests for /api/users.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

// ─── GET /api/users/me ──────────────────────────────────────────────────────
describe('GET /api/users/me', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('returns the authenticated user profile', async () => {
    const { authHeader, userId, email } = await seedAuth(app);

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(userId);
    expect(res.body.email).toBe(email);
    expect(res.body).toHaveProperty('firstName');
    expect(res.body).toHaveProperty('lastName');
    expect(res.body).toHaveProperty('role');
    expect(res.body).toHaveProperty('onboardingStep');
    expect(res.body).toHaveProperty('createdAt');
  });
});

// ─── PATCH /api/users/me ────────────────────────────────────────────────────
describe('PATCH /api/users/me', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .send({ firstName: 'Hacker' });
    expect(res.status).toBe(401);
  });

  it('updates firstName and lastName', async () => {
    const { authHeader, userId } = await seedAuth(app);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', authHeader)
      .send({ firstName: 'Updated', lastName: 'Name' });

    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Updated');
    expect(res.body.lastName).toBe('Name');

    // Verify in DB
    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser!.firstName).toBe('Updated');
    expect(dbUser!.lastName).toBe('Name');
  });

  it('updates avatarUrl', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', authHeader)
      .send({ avatarUrl: 'https://example.com/avatar.jpg' });

    expect(res.status).toBe(200);
  });

  it('ignores unknown fields gracefully', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', authHeader)
      .send({ firstName: 'Valid', unknownField: 'ignored' });

    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Valid');
  });
});

// ─── PATCH /api/users/me/onboarding ─────────────────────────────────────────
describe('PATCH /api/users/me/onboarding', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch('/api/users/me/onboarding')
      .send({ step: 'DONE' });
    expect(res.status).toBe(401);
  });

  it('updates onboarding step to CUSTOMIZE_ORG', async () => {
    const { authHeader, userId } = await seedAuth(app);

    const res = await request(app)
      .patch('/api/users/me/onboarding')
      .set('Authorization', authHeader)
      .send({ step: 'CUSTOMIZE_ORG' });

    expect(res.status).toBe(200);
    expect(res.body.onboardingStep).toBe('CUSTOMIZE_ORG');

    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser!.onboardingStep).toBe('CUSTOMIZE_ORG');
  });

  it('updates onboarding step to DONE', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .patch('/api/users/me/onboarding')
      .set('Authorization', authHeader)
      .send({ step: 'DONE' });

    expect(res.status).toBe(200);
    expect(res.body.onboardingStep).toBe('DONE');
  });

  it('returns 400 for invalid step value', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .patch('/api/users/me/onboarding')
      .set('Authorization', authHeader)
      .send({ step: 'INVALID_STEP' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when step is missing', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .patch('/api/users/me/onboarding')
      .set('Authorization', authHeader)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/users/me/data-export ─────────────────────────────────────────
describe('POST /api/users/me/data-export', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/users/me/data-export');
    expect(res.status).toBe(401);
  });

  it('returns JSON data export with user profile and related data', async () => {
    const { authHeader, orgHeader, userId, email } = await seedAuth(app);

    const res = await request(app)
      .post('/api/users/me/data-export')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(/attachment.*data-export/);

    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('memberships');
    expect(res.body).toHaveProperty('matters');
    expect(res.body).toHaveProperty('comments');
    expect(res.body).toHaveProperty('notifications');
    expect(res.body).toHaveProperty('tasks');

    expect(res.body.user.id).toBe(userId);
    expect(res.body.user.email).toBe(email);
    expect(res.body.memberships.length).toBeGreaterThanOrEqual(1);
  });

  it('creates an audit log entry for data export', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);

    await request(app)
      .post('/api/users/me/data-export')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    const auditLog = await db.auditLog.findFirst({
      where: { actorId: userId, action: 'DATA_EXPORT', entity: 'User' },
    });
    expect(auditLog).not.toBeNull();
    expect(auditLog!.entityId).toBe(userId);
  });
});

// ─── DELETE /api/users/me ───────────────────────────────────────────────────
describe('DELETE /api/users/me', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .delete('/api/users/me')
      .send({ confirm: 'DELETE MY ACCOUNT' });
    expect(res.status).toBe(401);
  });

  it('returns 400 without confirmation text', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', authHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Cc]onfirmation required/);
  });

  it('returns 400 with wrong confirmation text', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', authHeader)
      .send({ confirm: 'delete my account' });

    expect(res.status).toBe(400);
  });

  it('deletes (anonymizes) the user account with correct confirmation', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);

    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ confirm: 'DELETE MY ACCOUNT' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify user is anonymized in DB
    const dbUser = await db.user.findUnique({ where: { id: userId } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.email).toMatch(/^deleted_.*@redacted\.invalid$/);
    expect(dbUser!.firstName).toBe('Deleted');
    expect(dbUser!.lastName).toBe('User');
    expect(dbUser!.deletedAt).not.toBeNull();
    expect(dbUser!.passwordHash).toBe('');
  });

  it('removes organization memberships after deletion', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);

    await request(app)
      .delete('/api/users/me')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ confirm: 'DELETE MY ACCOUNT' });

    const memberships = await db.organizationMember.findMany({ where: { userId } });
    expect(memberships).toHaveLength(0);
  });

  it('creates an audit log entry for account deletion', async () => {
    const { authHeader, orgHeader, userId } = await seedAuth(app);

    await request(app)
      .delete('/api/users/me')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ confirm: 'DELETE MY ACCOUNT' });

    const auditLog = await db.auditLog.findFirst({
      where: { actorId: userId, action: 'ACCOUNT_DELETED', entity: 'User' },
    });
    expect(auditLog).not.toBeNull();
  });
});
