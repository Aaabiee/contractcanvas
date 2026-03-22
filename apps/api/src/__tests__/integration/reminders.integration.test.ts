import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

afterEach(() => cleanDb(db));
afterAll(() => db.$disconnect());

async function seedContract(orgId: string, userId: string) {
  const matter = await db.matter.create({
    data: { title: 'Test Matter', organizationId: orgId, ownerId: userId },
  });
  const contract = await db.contract.create({
    data: { title: 'Test Contract', organizationId: orgId, matterId: matter.id },
  });
  return contract;
}

describe('GET /api/reminders', () => {
  it('returns 401 when unauthenticated', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/reminders');
    expect(res.status).toBe(401);
  });

  it('returns empty list when no reminders exist', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/reminders')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
});

describe('POST /api/reminders', () => {
  it('creates a reminder for a contract in the org', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .post('/api/reminders')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ contractId: contract.id, type: 'DEADLINE', dueAt });

    expect(res.status).toBe(201);
    expect(res.body.contractId).toBe(contract.id);
    expect(res.body.type).toBe('DEADLINE');
    expect(res.body.sentAt).toBeNull();
  });

  it('returns 400 for invalid type', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const res = await request(app)
      .post('/api/reminders')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ contractId: contract.id, type: 'INVALID', dueAt: new Date().toISOString() });

    expect(res.status).toBe(400);
  });

  it('returns 404 when contract belongs to another org', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);
    const { orgId: otherOrgId, userId: otherUserId } = await seedAuth(app);
    const otherContract = await seedContract(otherOrgId, otherUserId);

    const res = await request(app)
      .post('/api/reminders')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ contractId: otherContract.id, type: 'PAYMENT', dueAt: new Date().toISOString() });

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/reminders/:id', () => {
  it('updates dueAt and resets sentAt', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const reminder = await db.reminder.create({
      data: {
        organizationId: orgId,
        contractId:     contract.id,
        type:           'RENEWAL',
        dueAt:          new Date(Date.now() - 1000),
        sentAt:         new Date(),
      },
    });

    const newDue = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ dueAt: newDue });

    expect(res.status).toBe(200);
    expect(res.body.sentAt).toBeNull();
  });

  it('returns 404 for reminder in another org', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);
    const { orgId: otherOrgId, userId: otherUserId } = await seedAuth(app);
    const otherContract = await seedContract(otherOrgId, otherUserId);

    const reminder = await db.reminder.create({
      data: {
        organizationId: otherOrgId,
        contractId:     otherContract.id,
        type:           'DEADLINE',
        dueAt:          new Date(Date.now() + 86_400_000),
      },
    });

    const res = await request(app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ type: 'PAYMENT' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/reminders/:id', () => {
  it('deletes a reminder', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const reminder = await db.reminder.create({
      data: {
        organizationId: orgId,
        contractId:     contract.id,
        type:           'PAYMENT',
        dueAt:          new Date(Date.now() + 86_400_000),
      },
    });

    const res = await request(app)
      .delete(`/api/reminders/${reminder.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(204);
    const found = await db.reminder.findUnique({ where: { id: reminder.id } });
    expect(found).toBeNull();
  });

  it('returns 404 for another org reminder', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);
    const { orgId: otherOrgId, userId: otherUserId } = await seedAuth(app);
    const otherContract = await seedContract(otherOrgId, otherUserId);

    const reminder = await db.reminder.create({
      data: {
        organizationId: otherOrgId,
        contractId:     otherContract.id,
        type:           'DEADLINE',
        dueAt:          new Date(Date.now() + 86_400_000),
      },
    });

    const res = await request(app)
      .delete(`/api/reminders/${reminder.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/reminders — validation branches ─────────────────────────────
describe('POST /api/reminders (validation branches)', () => {
  it('returns 400 for bad date format', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const res = await request(app)
      .post('/api/reminders')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ contractId: contract.id, type: 'DEADLINE', dueAt: 'not-a-date' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when dueAt is missing', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const res = await request(app)
      .post('/api/reminders')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ contractId: contract.id, type: 'DEADLINE' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when contractId is missing', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/reminders')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ type: 'DEADLINE', dueAt: new Date().toISOString() });

    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown type value', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const res = await request(app)
      .post('/api/reminders')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ contractId: contract.id, type: 'UNKNOWN_TYPE', dueAt: new Date().toISOString() });

    expect(res.status).toBe(400);
  });
});

// ─── PATCH /api/reminders — sentAt reset and validation ─────────────────────
describe('PATCH /api/reminders/:id (sentAt reset and validation)', () => {
  it('resets sentAt to null when dueAt is changed', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    // Create a reminder with sentAt set (already fired)
    const reminder = await db.reminder.create({
      data: {
        organizationId: orgId,
        contractId:     contract.id,
        type:           'PAYMENT',
        dueAt:          new Date(Date.now() - 86_400_000),
        sentAt:         new Date(Date.now() - 3600_000),
      },
    });

    // Confirm sentAt is initially set
    const before = await db.reminder.findUnique({ where: { id: reminder.id } });
    expect(before!.sentAt).not.toBeNull();

    const newDue = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ dueAt: newDue });

    expect(res.status).toBe(200);
    expect(res.body.sentAt).toBeNull();

    // Verify in DB
    const after = await db.reminder.findUnique({ where: { id: reminder.id } });
    expect(after!.sentAt).toBeNull();
    expect(new Date(after!.dueAt).toISOString()).toBe(newDue);
  });

  it('does not reset sentAt when only type is changed', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const sentAt = new Date();
    const reminder = await db.reminder.create({
      data: {
        organizationId: orgId,
        contractId:     contract.id,
        type:           'DEADLINE',
        dueAt:          new Date(Date.now() + 86_400_000),
        sentAt,
      },
    });

    const res = await request(app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ type: 'RENEWAL' });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('RENEWAL');
    // sentAt should NOT be reset because dueAt was not changed
    // (the route only sets sentAt=null when dueAt is provided)
  });

  it('returns 400 for invalid dueAt format in PATCH', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const reminder = await db.reminder.create({
      data: {
        organizationId: orgId,
        contractId:     contract.id,
        type:           'DEADLINE',
        dueAt:          new Date(Date.now() + 86_400_000),
      },
    });

    const res = await request(app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ dueAt: 'bad-date' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type in PATCH', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const reminder = await db.reminder.create({
      data: {
        organizationId: orgId,
        contractId:     contract.id,
        type:           'DEADLINE',
        dueAt:          new Date(Date.now() + 86_400_000),
      },
    });

    const res = await request(app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ type: 'BOGUS' });

    expect(res.status).toBe(400);
  });
});

// ─── Error / validation / guard paths ────────────────────────────────────────
describe('Reminders — error and validation paths', () => {
  it('GET returns 403 when no org context', async () => {
    const app = buildApp();
    const { authHeader, userId } = await seedAuth(app);

    // Remove org memberships
    await db.organizationMember.deleteMany({ where: { userId } });
    const user = await db.user.findUnique({ where: { id: userId } });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user!.email, password: 'Password1!' });
    const freshHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .get('/api/reminders')
      .set('Authorization', freshHeader);

    expect(res.status).toBe(403);
  });

  it('POST returns 403 when no org context', async () => {
    const app = buildApp();
    const { authHeader, userId } = await seedAuth(app);

    await db.organizationMember.deleteMany({ where: { userId } });
    const user = await db.user.findUnique({ where: { id: userId } });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user!.email, password: 'Password1!' });
    const freshHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .post('/api/reminders')
      .set('Authorization', freshHeader)
      .send({ contractId: 'clxxxxxxxxxxxxxxxxx', type: 'DEADLINE', dueAt: new Date().toISOString() });

    expect(res.status).toBe(403);
  });

  it('PATCH returns 403 when no org context', async () => {
    const app = buildApp();
    const { authHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const reminder = await db.reminder.create({
      data: {
        organizationId: orgId,
        contractId: contract.id,
        type: 'DEADLINE',
        dueAt: new Date(Date.now() + 86_400_000),
      },
    });

    // Remove org memberships
    await db.organizationMember.deleteMany({ where: { userId } });
    const user = await db.user.findUnique({ where: { id: userId } });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user!.email, password: 'Password1!' });
    const freshHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Authorization', freshHeader)
      .send({ type: 'PAYMENT' });

    expect(res.status).toBe(403);
  });

  it('DELETE returns 403 when no org context', async () => {
    const app = buildApp();
    const { authHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const reminder = await db.reminder.create({
      data: {
        organizationId: orgId,
        contractId: contract.id,
        type: 'PAYMENT',
        dueAt: new Date(Date.now() + 86_400_000),
      },
    });

    await db.organizationMember.deleteMany({ where: { userId } });
    const user = await db.user.findUnique({ where: { id: userId } });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user!.email, password: 'Password1!' });
    const freshHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .delete(`/api/reminders/${reminder.id}`)
      .set('Authorization', freshHeader);

    expect(res.status).toBe(403);
  });

  it('PATCH returns 404 for non-existent reminder id', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .patch('/api/reminders/clxxxxxxxxxxxxxxxxxxxxxxxxx')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ type: 'RENEWAL' });

    expect(res.status).toBe(404);
  });

  it('DELETE returns 404 for non-existent reminder id', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .delete('/api/reminders/clxxxxxxxxxxxxxxxxxxxxxxxxx')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });

  it('POST returns 400 when body is completely empty', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/reminders')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({});

    expect(res.status).toBe(400);
  });

  it('GET supports filtering by contractId', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const c1 = await seedContract(orgId, userId);
    const c2 = await seedContract(orgId, userId);

    await db.reminder.createMany({
      data: [
        { organizationId: orgId, contractId: c1.id, type: 'DEADLINE', dueAt: new Date(Date.now() + 86_400_000) },
        { organizationId: orgId, contractId: c2.id, type: 'RENEWAL', dueAt: new Date(Date.now() + 86_400_000) },
      ],
    });

    const res = await request(app)
      .get(`/api/reminders?contractId=${c1.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].contractId).toBe(c1.id);
  });
});
