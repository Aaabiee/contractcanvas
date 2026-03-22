/**
 * Integration tests for /api/signatures.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 *
 * The signature provider falls back to StubProvider when no real
 * DocuSign/HelloSign credentials are present, which makes these tests
 * work without external API keys.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

/** Creates a matter and returns its id. */
async function seedMatter(authHeader: string, orgHeader: string, title = 'Sig Matter') {
  const res = await request(app)
    .post('/api/matters')
    .set('Authorization', authHeader)
    .set('X-Organization-Id', orgHeader)
    .send({ title });
  return res.body.id as string;
}

/** Creates a contract and returns its id. */
async function seedContract(authHeader: string, orgHeader: string, matterId: string, title = 'Sig Contract') {
  const res = await request(app)
    .post('/api/contracts')
    .set('Authorization', authHeader)
    .set('X-Organization-Id', orgHeader)
    .send({ title, matterId });
  return res.body.id as string;
}

// ─── POST /api/signatures (create envelope) ─────────────────────────────────
describe('POST /api/signatures', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/signatures').send({});
    expect(res.status).toBe(401);
  });

  it('creates a signature envelope with recipients', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const res = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [
          { email: 'signer@example.com', name: 'Bob Signer', role: 'signer' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.contractId).toBe(contractId);
    expect(res.body.provider).toBe('docusign');
    expect(res.body.status).toBe('SENT');

    // Verify persisted in DB
    const dbEnvelope = await db.signatureEnvelope.findUnique({ where: { id: res.body.id } });
    expect(dbEnvelope).not.toBeNull();
    expect(dbEnvelope!.contractId).toBe(contractId);
  });

  it('creates envelope with hellosign provider', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const res = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'hellosign',
        recipients: [
          { email: 'alice@example.com', name: 'Alice', role: 'signer' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe('hellosign');
  });

  it('returns 400 for missing contractId', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        provider:   'docusign',
        recipients: [{ email: 'a@b.com', name: 'A', role: 'signer' }],
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for empty recipients array', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const res = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [],
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid provider name', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const res = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'invalid-provider',
        recipients: [{ email: 'a@b.com', name: 'A', role: 'signer' }],
      });

    expect(res.status).toBe(400);
  });

  it('returns 404 when contractId belongs to a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId   = await seedMatter(a.authHeader, a.orgHeader);
    const contractId = await seedContract(a.authHeader, a.orgHeader, matterId);

    const res = await request(app)
      .post('/api/signatures')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    expect(res.status).toBe(404);
  });

  it('returns 400 when sender is also a recipient (segregation of duty)', async () => {
    const { authHeader, orgHeader, email } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const res = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email, name: 'Self', role: 'signer' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/segregation/i);
  });

  it('creates envelope with multiple recipients and optional message', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const res = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [
          { email: 'a@example.com', name: 'Alice', role: 'signer' },
          { email: 'b@example.com', name: 'Bob',   role: 'witness' },
        ],
        message: 'Please review and sign this NDA.',
      });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.recipients)).toBe(true);
    expect(res.body.recipients).toHaveLength(2);
  });
});

// ─── GET /api/signatures (list by contractId) ───────────────────────────────
describe('GET /api/signatures', () => {
  it('returns 401 without auth', async () => {
    expect((await request(app).get('/api/signatures?contractId=abc')).status).toBe(401);
  });

  it('returns 400 when contractId query param is missing', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contractId/i);
  });

  it('returns empty list when no envelopes exist for contract', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const res = await request(app)
      .get(`/api/signatures?contractId=${contractId}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns envelopes scoped to contractId and org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId   = await seedMatter(a.authHeader, a.orgHeader);
    const contractId = await seedContract(a.authHeader, a.orgHeader, matterId);

    // Create an envelope in org A
    await request(app)
      .post('/api/signatures')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    // Org A should see it
    const resA = await request(app)
      .get(`/api/signatures?contractId=${contractId}`)
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader);
    expect(resA.body).toHaveLength(1);

    // Org B should not see it
    const resB = await request(app)
      .get(`/api/signatures?contractId=${contractId}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);
    expect(resB.body).toHaveLength(0);
  });

  it('returns multiple envelopes ordered newest-first', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'first@example.com', name: 'First', role: 'signer' }],
      });

    await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'hellosign',
        recipients: [{ email: 'second@example.com', name: 'Second', role: 'signer' }],
      });

    const res = await request(app)
      .get(`/api/signatures?contractId=${contractId}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body).toHaveLength(2);
    // newest first
    expect(new Date(res.body[0].createdAt).getTime())
      .toBeGreaterThanOrEqual(new Date(res.body[1].createdAt).getTime());
  });
});

// ─── GET /api/signatures/:id ────────────────────────────────────────────────
describe('GET /api/signatures/:id', () => {
  it('returns envelope by id', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    const res = await request(app)
      .get(`/api/signatures/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(create.body.id);
    expect(res.body.contractId).toBe(contractId);
  });

  it('returns 404 for unknown envelope id', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/signatures/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns 404 when envelope belongs to a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId   = await seedMatter(a.authHeader, a.orgHeader);
    const contractId = await seedContract(a.authHeader, a.orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    const res = await request(app)
      .get(`/api/signatures/${create.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/signatures/:id/void ──────────────────────────────────────────
describe('POST /api/signatures/:id/void', () => {
  it('voids a SENT envelope', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    const res = await request(app)
      .post(`/api/signatures/${create.body.id}/void`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ reason: 'Terms changed' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('VOIDED');

    // Verify DB
    const dbEnvelope = await db.signatureEnvelope.findUnique({ where: { id: create.body.id } });
    expect(dbEnvelope!.status).toBe('VOIDED');
  });

  it('returns 404 for unknown envelope', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/signatures/cuid1234567890abcdefghijk/void')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ reason: 'test' });

    expect(res.status).toBe(404);
  });

  it('returns 409 when trying to void a VOIDED envelope', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    // Void once
    await request(app)
      .post(`/api/signatures/${create.body.id}/void`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ reason: 'First void' });

    // Void again
    const res = await request(app)
      .post(`/api/signatures/${create.body.id}/void`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ reason: 'Second void' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot void/i);
  });

  it('returns 409 when trying to void a COMPLETED envelope', async () => {
    const { authHeader, orgHeader, orgId } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    // Manually set status to COMPLETED in DB
    await db.signatureEnvelope.update({
      where: { id: create.body.id },
      data:  { status: 'COMPLETED' },
    });

    const res = await request(app)
      .post(`/api/signatures/${create.body.id}/void`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ reason: 'Cannot void completed' });

    expect(res.status).toBe(409);
  });

  it('voids with a default reason when none provided', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    const res = await request(app)
      .post(`/api/signatures/${create.body.id}/void`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('VOIDED');
  });
});

// ─── POST /api/signatures/:id/resend ────────────────────────────────────────
describe('POST /api/signatures/:id/resend', () => {
  it('resends a SENT envelope', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    const res = await request(app)
      .post(`/api/signatures/${create.body.id}/resend`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SENT');
    // providerId should be updated (stub generates a new one)
    expect(res.body.providerId).toBeTruthy();
  });

  it('returns 404 for unknown envelope', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .post('/api/signatures/cuid1234567890abcdefghijk/resend')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send();

    expect(res.status).toBe(404);
  });

  it('returns 409 when trying to resend a VOIDED envelope', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    // Void it first
    await request(app)
      .post(`/api/signatures/${create.body.id}/void`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ reason: 'void it' });

    const res = await request(app)
      .post(`/api/signatures/${create.body.id}/resend`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send();

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot resend/i);
  });

  it('returns 409 when trying to resend a COMPLETED envelope', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    // Manually set to COMPLETED
    await db.signatureEnvelope.update({
      where: { id: create.body.id },
      data:  { status: 'COMPLETED' },
    });

    const res = await request(app)
      .post(`/api/signatures/${create.body.id}/resend`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send();

    expect(res.status).toBe(409);
  });

  it('returns 409 when trying to resend a DECLINED envelope', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    // Manually set to DECLINED
    await db.signatureEnvelope.update({
      where: { id: create.body.id },
      data:  { status: 'DECLINED' },
    });

    const res = await request(app)
      .post(`/api/signatures/${create.body.id}/resend`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send();

    expect(res.status).toBe(409);
  });
});

// ─── Signatures — 403 with non-matching org header ──────────────────────────
describe('Signatures — invalid X-Organization-Id header', () => {
  it('GET /api/signatures/:id returns 403 with non-matching org header', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    // Request with a non-matching org header
    const res = await request(app)
      .get(`/api/signatures/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/organization/i);
  });

  it('POST /api/signatures returns 403 with non-matching org header', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk')
      .send({
        contractId: 'cuid1234567890abcdefghijk',
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    expect(res.status).toBe(403);
  });

  it('GET /api/signatures returns 403 with non-matching org header', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/signatures?contractId=some-id')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk');

    expect(res.status).toBe(403);
  });

  it('POST /api/signatures/:id/void returns 403 with non-matching org header', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/signatures/cuid1234567890abcdefghijk/void')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk')
      .send({ reason: 'test' });

    expect(res.status).toBe(403);
  });

  it('POST /api/signatures/:id/resend returns 403 with non-matching org header', async () => {
    const { authHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/signatures/cuid1234567890abcdefghijk/resend')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', 'cuid1234567890abcdefghijk')
      .send();

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/signatures/webhook/:provider — webhook handler ──────────────
describe('POST /api/signatures/webhook/:provider', () => {
  it('returns 400 for an unknown provider', async () => {
    const res = await request(app)
      .post('/api/signatures/webhook/unknown-provider')
      .send({ event: 'completed' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown provider/i);
  });

  it('returns 200 with ignored:true when payload has no providerId', async () => {
    const res = await request(app)
      .post('/api/signatures/webhook/docusign')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
  });

  it('returns 200 with ignored:true for unknown envelope providerId', async () => {
    const res = await request(app)
      .post('/api/signatures/webhook/docusign')
      .send({
        event: 'completed',
        data: { envelopeId: 'non-existent-provider-id' },
      });

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
  });

  it('updates envelope status via docusign webhook', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    // Create an envelope
    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    const envelope = await db.signatureEnvelope.findUnique({ where: { id: create.body.id } });

    // Send webhook to update status to completed
    const res = await request(app)
      .post('/api/signatures/webhook/docusign')
      .send({
        event: 'completed',
        data: { envelopeId: envelope!.providerId },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify status updated in DB
    const updated = await db.signatureEnvelope.findUnique({ where: { id: create.body.id } });
    expect(updated!.status).toBe('COMPLETED');
  });

  it('transitions contract to EXECUTED when envelope completes', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'docusign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    const envelope = await db.signatureEnvelope.findUnique({ where: { id: create.body.id } });

    // First transition contract to PENDING_SIGNATURE (valid for EXECUTED)
    const h = { Authorization: authHeader, 'X-Organization-Id': orgHeader };
    await request(app).patch(`/api/contracts/${contractId}`).set(h).send({ status: 'NEGOTIATION' });
    await request(app).patch(`/api/contracts/${contractId}`).set(h).send({ status: 'PENDING_SIGNATURE' });

    // Send completed webhook
    await request(app)
      .post('/api/signatures/webhook/docusign')
      .send({
        event: 'completed',
        data: { envelopeId: envelope!.providerId },
      });

    // Contract should be EXECUTED
    const contract = await db.contract.findUnique({ where: { id: contractId } });
    expect(contract!.status).toBe('EXECUTED');
  });

  it('updates envelope status via hellosign webhook', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'hellosign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    const envelope = await db.signatureEnvelope.findUnique({ where: { id: create.body.id } });

    const res = await request(app)
      .post('/api/signatures/webhook/hellosign')
      .send({
        event: { event_type: 'signature_request_signed' },
        signature_request: {
          signature_request_id: envelope!.providerId,
          signatures: [
            { signer_email_address: 'signer@example.com', status_code: 'signed', signed_at: new Date().toISOString() },
          ],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const updated = await db.signatureEnvelope.findUnique({ where: { id: create.body.id } });
    expect(updated!.status).toBe('SIGNED');
  });

  it('handles hellosign webhook without signatures array', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId   = await seedMatter(authHeader, orgHeader);
    const contractId = await seedContract(authHeader, orgHeader, matterId);

    const create = await request(app)
      .post('/api/signatures')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        contractId,
        provider:   'hellosign',
        recipients: [{ email: 'signer@example.com', name: 'Signer', role: 'signer' }],
      });

    const envelope = await db.signatureEnvelope.findUnique({ where: { id: create.body.id } });

    const res = await request(app)
      .post('/api/signatures/webhook/hellosign')
      .send({
        event: { event_type: 'signature_request_sent' },
        signature_request: {
          signature_request_id: envelope!.providerId,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
