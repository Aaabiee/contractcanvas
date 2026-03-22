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

// ─── POST /api/billing/subscribe ────────────────────────────────────────────
describe('POST /api/billing/subscribe', () => {
  it('returns 401 without auth', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/billing/subscribe')
      .send({ tier: 'STARTER', priceId: 'price_test' });

    expect(res.status).toBe(401);
  });

  it('returns 501 when Stripe is not configured', async () => {
    if (process.env['STRIPE_SECRET_KEY']) return;

    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/billing/subscribe')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ tier: 'STARTER', priceId: 'price_test' });

    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/billing is not configured/i);
  });
});

// ─── POST /api/billing/portal-session ───────────────────────────────────────
describe('POST /api/billing/portal-session', () => {
  it('returns 401 without auth', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/billing/portal-session');

    expect(res.status).toBe(401);
  });

  it('returns 501 when Stripe is not configured', async () => {
    if (process.env['STRIPE_SECRET_KEY']) return;

    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post('/api/billing/portal-session')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/billing is not configured/i);
  });
});

// ─── requireActiveSubscription middleware ────────────────────────────────────
describe('requireActiveSubscription middleware', () => {
  /**
   * Build a dedicated mini-app that places requireActiveSubscription in front of
   * a test route. We import the middleware and wire it up manually to avoid
   * interference from the full buildApp() route table.
   */
  async function buildSubTestApp() {
    const express = await import('express');
    const { protect } = await import('../../middleware/auth.js');
    const { requireActiveSubscription } = await import('../../routes/billing.js');
    const { router: authRouter } = await import('../../routes/auth.js');

    const testApp = express.default();
    testApp.use(express.default.json());
    // Auth routes so we can register/login
    testApp.use('/api/auth', authRouter);
    // Test route behind protect + requireActiveSubscription
    testApp.get('/api/sub-test', protect, requireActiveSubscription, (_req: any, res: any) => {
      res.json({ ok: true });
    });
    return testApp;
  }

  it('returns 402 when no active subscription exists', async () => {
    const testApp = await buildSubTestApp();
    const { authHeader, orgHeader, orgId } = await seedAuth(testApp);

    // Registration auto-creates a trialing subscription — delete it
    await db.subscription.deleteMany({ where: { organizationId: orgId } });

    const res = await request(testApp)
      .get('/api/sub-test')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('subscription_required');
  });

  it('returns 200 when an active subscription exists', async () => {
    const testApp = await buildSubTestApp();
    const { authHeader, orgHeader, orgId } = await seedAuth(testApp);

    // Create an active subscription
    await db.subscription.create({
      data: {
        organizationId: orgId,
        tier: 'STARTER',
        status: 'active',
        stripeSubscriptionId: `sub_test_${Date.now()}`,
        stripeCustomerId: 'cus_test',
      },
    });

    const res = await request(testApp)
      .get('/api/sub-test')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 200 when a trialing subscription exists', async () => {
    const testApp = await buildSubTestApp();
    const { authHeader, orgHeader, orgId } = await seedAuth(testApp);

    await db.subscription.create({
      data: {
        organizationId: orgId,
        tier: 'PROFESSIONAL',
        status: 'trialing',
        stripeSubscriptionId: `sub_trial_${Date.now()}`,
        stripeCustomerId: 'cus_trial_test',
      },
    });

    const res = await request(testApp)
      .get('/api/sub-test')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
