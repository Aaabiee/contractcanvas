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
