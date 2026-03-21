/**
 * Integration tests for /api/billing.
 *
 * POST /api/billing/invoice  requires authentication (protect middleware is
 * applied inline on the route).  The Stripe webhook is intentionally public —
 * it is protected by HMAC signature verification instead.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

afterEach(() => cleanDb(db));
afterAll(() => db.$disconnect());

// ── POST /api/billing/invoice ────────────────────────────────────────────────

describe('POST /api/billing/invoice', () => {
  it('returns 401 when request is not authenticated', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/billing/invoice')
      .send({ amount_cents: 5000, currency: 'usd' });

    expect(res.status).toBe(401);
  });

  it('returns 501 when Stripe is not configured (authenticated user)', async () => {
    if (process.env['STRIPE_SECRET_KEY']) return; // skip if Stripe is live

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

// ── POST /api/billing/webhooks/stripe ────────────────────────────────────────

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
    // Without any auth, the webhook endpoint is reachable (responds with 4xx/5xx
    // based on Stripe config, NOT 401).
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).not.toBe(401);
  });
});
