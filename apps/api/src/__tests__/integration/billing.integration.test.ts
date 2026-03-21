import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

afterEach(() => cleanDb(db));
afterAll(() => db.$disconnect());

describe('POST /api/billing/invoice', () => {
  it('returns 401 when request is not authenticated', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/billing/invoice')
      .send({ amount_cents: 5000, currency: 'usd' });

    expect(res.status).toBe(401);
  });

  it('returns 501 when Stripe is not configured (authenticated user)', async () => {
    if (process.env['STRIPE_SECRET_KEY']) return;

    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/billing/invoice')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ amount_cents: 5000, currency: 'usd' });

    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/billing is not configured/i);
  });

  it('returns 400 for missing amount_cents when Stripe is active', async () => {
    const key = process.env['STRIPE_SECRET_KEY'];
    if (!key || key.includes('CONTRA_')) return;

    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/billing/invoice')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ currency: 'usd' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for non-positive amount_cents when Stripe is active', async () => {
    const key = process.env['STRIPE_SECRET_KEY'];
    if (!key || key.includes('CONTRA_')) return;

    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/billing/invoice')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ amount_cents: -100, currency: 'usd' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/billing/invoices', () => {
  it('returns 401 without auth', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/billing/invoices');
    expect(res.status).toBe(401);
  });

  it('returns empty list when no invoices exist', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/billing/invoices')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBe(0);
  });

  it('returns invoices scoped to the organization', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId } = await seedAuth(app);

    await db.invoice.create({
      data: { organizationId: orgId, amountCents: 10000, currency: 'usd', stripeId: 'pi_test_001' },
    });

    const res = await request(app)
      .get('/api/billing/invoices')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].amountCents).toBe(10000);
  });

  it('does not return invoices from another org', async () => {
    const app = buildApp();
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    await db.invoice.create({
      data: { organizationId: b.orgId, amountCents: 5000, currency: 'usd', stripeId: 'pi_test_002' },
    });

    const res = await request(app)
      .get('/api/billing/invoices')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('POST /api/billing/webhooks/stripe', () => {
  it('returns 501 when Stripe or webhook secret is not configured', async () => {
    if (process.env['STRIPE_SECRET_KEY'] && process.env['STRIPE_WEBHOOK_SECRET']) return;

    const app = buildApp();
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'test-sig')
      .send('{}');

    expect(res.status).toBe(501);
  });

  it('is publicly accessible (no Authorization header required)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).not.toBe(401);
  });

  it('returns 400 for missing stripe-signature header', async () => {
    const key = process.env['STRIPE_SECRET_KEY'];
    const wh  = process.env['STRIPE_WEBHOOK_SECRET'];
    if (!key || key.includes('CONTRA_') || !wh || wh.includes('YOUR_')) return;

    const app = buildApp();
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({}));

    expect(res.status).toBe(400);
  });
});
