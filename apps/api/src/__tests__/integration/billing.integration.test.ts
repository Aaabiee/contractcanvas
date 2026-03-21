/**
 * Integration tests for /api/billing.
 *
 * The billing router has NO protect middleware (public endpoints gated only by
 * the isStripeActive guard). When STRIPE_SECRET_KEY is absent every route
 * returns 501.  These tests cover:
 *   - 501 when Stripe is not configured (normal CI behaviour)
 *   - 400 validation errors when Stripe IS active
 */

import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { router as billingRouter } from '../../routes/billing.js';
import { cleanDb } from './helpers.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

// Billing has no protect middleware — mount it directly
function buildBillingApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/billing', billingRouter);
  return app;
}

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

describe('POST /api/billing/invoice', () => {
  it('returns 501 when Stripe is not configured', async () => {
    // In test env STRIPE_SECRET_KEY is not set — isStripeActive guard fires
    if (process.env['STRIPE_SECRET_KEY']) return; // skip if Stripe is configured

    const app = buildBillingApp();
    const res = await request(app)
      .post('/api/billing/invoice')
      .send({ amount_cents: 5000, currency: 'usd' });

    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/billing is not configured/i);
  });

  it('returns 400 for missing amount_cents when Stripe is active', async () => {
    const key = process.env['STRIPE_SECRET_KEY'];
    if (!key || key.includes('CONTRA_')) return; // skip if Stripe is not configured

    const app = buildBillingApp();
    const res = await request(app)
      .post('/api/billing/invoice')
      .send({ currency: 'usd' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for non-positive amount_cents when Stripe is active', async () => {
    const key = process.env['STRIPE_SECRET_KEY'];
    if (!key || key.includes('CONTRA_')) return;

    const app = buildBillingApp();
    const res = await request(app)
      .post('/api/billing/invoice')
      .send({ amount_cents: -100, currency: 'usd' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/billing/webhooks/stripe', () => {
  it('returns 501 when Stripe or webhook secret is not configured', async () => {
    if (process.env['STRIPE_SECRET_KEY'] && process.env['STRIPE_WEBHOOK_SECRET']) return;

    const app = buildBillingApp();
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'test-sig')
      .send('{}');

    expect(res.status).toBe(501);
  });

  it('returns 400 when stripe-signature header is missing and Stripe is active', async () => {
    const key = process.env['STRIPE_SECRET_KEY'];
    if (!key || key.includes('CONTRA_')) return;

    const app = buildBillingApp();
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(400);
  });
});
