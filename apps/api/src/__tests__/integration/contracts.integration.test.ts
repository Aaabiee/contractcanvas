/**
 * Integration tests for /api/contracts.
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

// ─── GET /api/contracts ──────────────────────────────────────────────────────
describe('GET /api/contracts', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/contracts');
    expect(res.status).toBe(401);
  });

  it('returns empty list when no contracts exist', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns contracts scoped to the org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    await request(app)
      .post('/api/contracts')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Org A Contract', matterId });

    const res = await request(app)
      .get('/api/contracts')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.body.data).toHaveLength(0);
  });

  it('filters by matterId', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const m1 = await seedMatter(authHeader, orgHeader, 'Matter 1');
    const m2 = await seedMatter(authHeader, orgHeader, 'Matter 2');

    await request(app).post('/api/contracts').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'C1', matterId: m1 });
    await request(app).post('/api/contracts').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'C2', matterId: m2 });

    const res = await request(app)
      .get(`/api/contracts?matterId=${m1}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('C1');
  });

  it('filters by status', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Draft Contract', matterId });

    // Walk through valid status transitions: DRAFT → NEGOTIATION → PENDING_SIGNATURE → EXECUTED
    const patchHeaders = { Authorization: authHeader, 'X-Organization-Id': orgHeader };
    await request(app).patch(`/api/contracts/${create.body.id}`).set(patchHeaders).send({ status: 'NEGOTIATION' });
    await request(app).patch(`/api/contracts/${create.body.id}`).set(patchHeaders).send({ status: 'PENDING_SIGNATURE' });
    await request(app).patch(`/api/contracts/${create.body.id}`).set(patchHeaders).send({ status: 'EXECUTED' });

    await request(app).post('/api/contracts').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'Still Draft', matterId });

    const res = await request(app)
      .get('/api/contracts?status=EXECUTED')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Draft Contract');
  });
});

// ─── POST /api/contracts ─────────────────────────────────────────────────────
describe('POST /api/contracts', () => {
  it('creates a contract and persists it', async () => {
    const { authHeader, orgHeader, orgId } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'NDA', matterId, valueCents: 50000, currency: 'USD' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('NDA');
    expect(res.body.organizationId).toBe(orgId);
    expect(res.body.valueCents).toBe(50000);

    const dbRecord = await db.contract.findUnique({ where: { id: res.body.id } });
    expect(dbRecord).not.toBeNull();
  });

  it('returns 400 for missing title', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ matterId });
    expect(res.status).toBe(400);
  });

  it('returns 404 when matterId belongs to a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({ title: 'Hijack', matterId });

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/contracts/:id ──────────────────────────────────────────────────
describe('GET /api/contracts/:id', () => {
  it('returns contract with related data', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Detail Test', matterId });

    const res = await request(app)
      .get(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Detail Test');
    expect(res.body).toHaveProperty('versions');
    expect(res.body).toHaveProperty('matter');
  });

  it('returns 404 for unknown contract', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/contracts/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/contracts/:id ────────────────────────────────────────────────
describe('PATCH /api/contracts/:id', () => {
  it('updates status and title', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Original', matterId });

    const res = await request(app)
      .patch(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Revised', status: 'NEGOTIATION' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Revised');
    expect(res.body.status).toBe('NEGOTIATION');
  });

  it('returns 400 for invalid status', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Contract', matterId });

    const res = await request(app)
      .patch(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ status: 'BOGUS' });

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/contracts/:id ───────────────────────────────────────────────
describe('DELETE /api/contracts/:id', () => {
  it('soft-deletes contract (sets deletedAt)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'To Delete', matterId });

    const res = await request(app)
      .delete(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(204);

    const dbRecord = await db.contract.findUnique({ where: { id: create.body.id } });
    expect(dbRecord!.deletedAt).not.toBeNull();
  });
});

// ─── Contract versions ───────────────────────────────────────────────────────
describe('POST /api/contracts/:contractId/versions', () => {
  it('creates a version and updates currentVersionId', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const contract = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Versioned Contract', matterId });

    const v1 = await request(app)
      .post(`/api/contracts/${contract.body.id}/versions`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ storageKey: 'orgs/o1/v1.pdf', mimeType: 'application/pdf' });

    expect(v1.status).toBe(201);
    expect(v1.body.number).toBe(1);

    const v2 = await request(app)
      .post(`/api/contracts/${contract.body.id}/versions`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ storageKey: 'orgs/o1/v2.pdf' });

    expect(v2.body.number).toBe(2);

    const dbContract = await db.contract.findUnique({ where: { id: contract.body.id } });
    expect(dbContract!.currentVersionId).toBe(v2.body.id);
  });

  it('returns 400 when storageKey is missing', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const contract = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'C', matterId });

    const res = await request(app)
      .post(`/api/contracts/${contract.body.id}/versions`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /api/contracts/:contractId/versions', () => {
  it('returns versions ordered newest-first', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const contract = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Multi-version', matterId });

    await request(app).post(`/api/contracts/${contract.body.id}/versions`).set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ storageKey: 'k1' });
    await request(app).post(`/api/contracts/${contract.body.id}/versions`).set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ storageKey: 'k2' });

    const res = await request(app)
      .get(`/api/contracts/${contract.body.id}/versions`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].number).toBe(2);
    expect(res.body[1].number).toBe(1);
  });
});

// ─── PATCH /api/contracts/:id — optimistic lock conflict (409) ──────────────
describe('PATCH /api/contracts/:id — optimistic lock', () => {
  it('returns 409 when updatedAt does not match (conflict)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Lock Test', matterId });

    // First update succeeds — advances updatedAt
    await request(app)
      .patch(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Updated Title' });

    // Second update sends stale updatedAt — should conflict
    const res = await request(app)
      .patch(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Stale Update', updatedAt: create.body.updatedAt });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('conflict');
    expect(res.body).toHaveProperty('serverUpdatedAt');
  });

  it('succeeds when updatedAt matches current server value', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Lock OK', matterId });

    const res = await request(app)
      .patch(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Fresh Update', updatedAt: create.body.updatedAt });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Fresh Update');
  });
});

// ─── PATCH /api/contracts/:id — invalid status transitions (422) ────────────
describe('PATCH /api/contracts/:id — status transitions', () => {
  it('returns 422 for DRAFT -> EXECUTED (invalid transition)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Transition Test', matterId });

    expect(create.body.status).toBe('DRAFT');

    const res = await request(app)
      .patch(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ status: 'EXECUTED' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_transition');
    expect(res.body.message).toMatch(/DRAFT.*EXECUTED/);
    expect(Array.isArray(res.body.allowed)).toBe(true);
  });

  it('returns 422 for EXECUTED -> DRAFT (invalid transition)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Exec Test', matterId });

    // Walk to EXECUTED: DRAFT -> NEGOTIATION -> PENDING_SIGNATURE -> EXECUTED
    const h = { Authorization: authHeader, 'X-Organization-Id': orgHeader };
    await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'NEGOTIATION' });
    await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'PENDING_SIGNATURE' });
    await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'EXECUTED' });

    const res = await request(app)
      .patch(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ status: 'DRAFT' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_transition');
  });

  it('walks through valid state machine: DRAFT -> NEGOTIATION -> PENDING_SIGNATURE -> EXECUTED -> ARCHIVED', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Full Walk', matterId });

    const h = { Authorization: authHeader, 'X-Organization-Id': orgHeader };

    // DRAFT -> NEGOTIATION
    let res = await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'NEGOTIATION' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NEGOTIATION');

    // NEGOTIATION -> PENDING_SIGNATURE
    res = await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'PENDING_SIGNATURE' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING_SIGNATURE');

    // PENDING_SIGNATURE -> EXECUTED
    res = await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'EXECUTED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EXECUTED');

    // EXECUTED -> ARCHIVED
    res = await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'ARCHIVED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ARCHIVED');
  });

  it('allows ARCHIVED -> DRAFT (reactivation)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Archive Test', matterId });

    const h = { Authorization: authHeader, 'X-Organization-Id': orgHeader };

    // DRAFT -> ARCHIVED
    await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'ARCHIVED' });

    // ARCHIVED -> DRAFT
    const res = await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'DRAFT' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DRAFT');
  });

  it('allows NEGOTIATION -> DRAFT (back to draft)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Back to Draft', matterId });

    const h = { Authorization: authHeader, 'X-Organization-Id': orgHeader };

    await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'NEGOTIATION' });

    const res = await request(app).patch(`/api/contracts/${create.body.id}`).set(h).send({ status: 'DRAFT' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DRAFT');
  });
});

// ─── POST /api/contracts/:id/generate-pdf ───────────────────────────────────
describe('POST /api/contracts/:id/generate-pdf', () => {
  it('returns 404 for unknown contract', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/contracts/cuid1234567890abcdefghijk/generate-pdf')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    // Could be 402 (no subscription) or 404 depending on middleware order
    expect([402, 404]).toContain(res.status);
  });

  it('returns 402 or 503 for a valid contract (subscription/puppeteer guard)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'PDF Test', matterId });

    const res = await request(app)
      .post(`/api/contracts/${create.body.id}/generate-pdf`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    // In test environment, either:
    // - 402 if no active subscription (requireActiveSubscription guard)
    // - 503 if puppeteer is not installed
    // - 200 if PDF generation succeeds
    expect([200, 402, 503]).toContain(res.status);
  });
});

// ─── POST /api/contracts — valueCents and currency ──────────────────────────
describe('POST /api/contracts — valueCents and currency', () => {
  it('creates a contract with valueCents and currency', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Currency Contract', matterId, valueCents: 100000, currency: 'EUR' });

    expect(res.status).toBe(201);
    expect(res.body.valueCents).toBe(100000);
    expect(res.body.currency).toBe('EUR');
  });

  it('creates a contract without valueCents (defaults to null)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'No Value', matterId });

    expect(res.status).toBe(201);
    expect(res.body.valueCents).toBeNull();
  });

  it('returns 400 for an invalid currency code', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Bad Currency', matterId, currency: 'invalid' });

    expect(res.status).toBe(400);
  });
});

// ─── PATCH /api/contracts/:id — valueCents nullable ─────────────────────────
describe('PATCH /api/contracts/:id — valueCents update', () => {
  it('updates valueCents to a new value', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Value Update', matterId, valueCents: 50000 });

    const res = await request(app)
      .patch(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ valueCents: 75000 });

    expect(res.status).toBe(200);
    expect(res.body.valueCents).toBe(75000);
  });

  it('sets valueCents to null', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Clear Value', matterId, valueCents: 50000 });

    const res = await request(app)
      .patch(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ valueCents: null });

    expect(res.status).toBe(200);
    expect(res.body.valueCents).toBeNull();
  });

  it('returns 404 for patching a non-existent contract', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .patch('/api/contracts/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/contracts/:id — 404 for non-existent ───────────────────────
describe('DELETE /api/contracts/:id — error cases', () => {
  it('returns 404 for a non-existent contract', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .delete('/api/contracts/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns 404 when deleting an already-deleted contract', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Double Delete', matterId });

    // First delete succeeds
    await request(app)
      .delete(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    // Second delete should return 404
    const res = await request(app)
      .delete(`/api/contracts/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/contracts/:contractId/versions — with sizeBytes ──────────────
describe('POST /api/contracts/:contractId/versions — sizeBytes', () => {
  it('creates a version with sizeBytes persisted', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const contract = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'SizeBytes Contract', matterId });

    const res = await request(app)
      .post(`/api/contracts/${contract.body.id}/versions`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ storageKey: 'orgs/o1/v1.pdf', mimeType: 'application/pdf', sizeBytes: 102400 });

    expect(res.status).toBe(201);
    expect(res.body.sizeBytes).toBe(102400);
  });

  it('returns 404 for version on a non-existent contract', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/contracts/cuid1234567890abcdefghijk/versions')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ storageKey: 'k1' });

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/contracts/:contractId/versions — 404 for unknown contract ─────
describe('GET /api/contracts/:contractId/versions — error cases', () => {
  it('returns 404 for versions of a non-existent contract', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/contracts/cuid1234567890abcdefghijk/versions')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });
});

// ─── Org guard — 403 when X-Organization-Id does not match user membership ──
describe('Contracts — invalid X-Organization-Id header', () => {
  it('GET /api/contracts returns 403 with non-matching org header', async () => {
    const { authHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/organization/i);
  });

  it('POST /api/contracts returns 403 with non-matching org header', async () => {
    const { authHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk')
      .send({ title: 'No Org', matterId: 'cuid1234567890abcdefghijk' });

    expect(res.status).toBe(403);
  });

  it('DELETE /api/contracts/:id returns 403 with non-matching org header', async () => {
    const { authHeader } = await seedAuth(app);
    const res = await request(app)
      .delete('/api/contracts/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk');

    expect(res.status).toBe(403);
  });
});
