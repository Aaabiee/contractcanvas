import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.NODE_ENV = 'test';

vi.mock('../../config.js', () => ({
  app: { env: 'test', port: 3333 },
  db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
  s3: { region: 'us-east-1', bucket: 'test', forcePathStyle: true },
  stripe: { secretKey: 'sk_test_real_key', webhookSecret: 'whsec_test_secret' },
  jwt: { secret: 'test-secret-key-for-testing' },
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
}));

const mockProtect = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
  req.user = {
    id: 'user-1',
    email: 'test@example.com',
    roles: ['LAWYER'],
    organizationId: 'org-1',
  };
  next();
}));

vi.mock('../../middleware/auth.js', () => ({
  protect: (...args: any[]) => mockProtect(...args),
  requireEmailVerified: (_req: any, _res: any, next: any) => { next(); },
  default: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: 'test@example.com', roles: ['LAWYER'], organizationId: 'org-1' };
    next();
  },
}));

const mockPrisma = {
  invoice: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  subscription: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  billingProfile: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  payment: {
    create: vi.fn(),
  },
  contract: {
    findFirst: vi.fn(),
  },
  organizationMember: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const mockStripePaymentIntents = { create: vi.fn() };
const mockStripeCustomers = { create: vi.fn() };
const mockStripeSubscriptions = { create: vi.fn() };
const mockStripeBillingPortalSessions = { create: vi.fn() };
const mockStripeWebhooks = { constructEvent: vi.fn() };

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      paymentIntents = mockStripePaymentIntents;
      customers = mockStripeCustomers;
      subscriptions = mockStripeSubscriptions;
      billingPortal = { sessions: mockStripeBillingPortalSessions };
      webhooks = mockStripeWebhooks;
    },
  };
});

vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/email.service.js', () => ({ sendEmail: mockSendEmail }));
vi.mock('../../queues/index.js', () => ({ emailQueue: null }));

const { router, requireActiveSubscription } = await import('../billing.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/billing', router);
  return app;
}

function buildAppNoOrg() {
  const app = express();
  app.use(express.json());

  // Override protect to simulate user with no org
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: 'test@example.com', roles: ['LAWYER'] };
    next();
  });

  // We need to manually mount the routes that don't use protect middleware
  // For testing endpoints that check organizationId inside the handler
  app.use('/billing', router);
  return app;
}

function buildAppWithErrHandler() {
  const app = express();
  app.use(express.json());
  app.use('/billing', router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/*  requireActiveSubscription middleware                               */
/* ------------------------------------------------------------------ */
describe('requireActiveSubscription', () => {
  it('returns 403 when no organizationId', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1' };
      next();
    });
    app.get('/test', requireActiveSubscription, (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_org');
  });

  it('returns 402 when no active subscription', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', organizationId: 'org-1' };
      next();
    });
    app.get('/test', requireActiveSubscription, (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('subscription_required');
    expect(res.body.upgradeUrl).toBe('/settings/billing');
  });

  it('passes when subscription is active', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', status: 'active' });
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', organizationId: 'org-1' };
      next();
    });
    app.get('/test', requireActiveSubscription, (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('passes when subscription is trialing', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', status: 'trialing' });
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', organizationId: 'org-1' };
      next();
    });
    app.get('/test', requireActiveSubscription, (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/*  POST /billing/invoice                                             */
/* ------------------------------------------------------------------ */
describe('POST /billing/invoice', () => {
  it('returns 400 for invalid input (missing amount)', async () => {
    const app = buildApp();
    const res = await request(app).post('/billing/invoice').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 400 for non-positive amount', async () => {
    const app = buildApp();
    const res = await request(app).post('/billing/invoice').send({ amount_cents: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid currency format', async () => {
    const app = buildApp();
    const res = await request(app).post('/billing/invoice').send({ amount_cents: 1000, currency: 'USDX' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when contractId is given but not found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/billing/invoice')
      .send({ amount_cents: 1000, contractId: 'clxxxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Contract not found');
  });

  it('creates invoice and returns 201 with client_secret', async () => {
    mockStripePaymentIntents.create.mockResolvedValue({
      id: 'pi_123',
      client_secret: 'pi_123_secret',
    });
    mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' });

    const app = buildApp();
    const res = await request(app)
      .post('/billing/invoice')
      .send({ amount_cents: 5000 });
    expect(res.status).toBe(201);
    expect(res.body.client_secret).toBe('pi_123_secret');
    expect(res.body.invoiceId).toBe('inv-1');
  });

  it('creates invoice with contractId when contract exists', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxxxx' });
    mockStripePaymentIntents.create.mockResolvedValue({ id: 'pi_123', client_secret: 'secret' });
    mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' });

    const app = buildApp();
    const res = await request(app)
      .post('/billing/invoice')
      .send({ amount_cents: 5000, contractId: 'clxxxxxxxxxxxxxxxxxxxxxx' });
    expect(res.status).toBe(201);
    expect(mockStripePaymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ contractId: 'clxxxxxxxxxxxxxxxxxxxxxx' }),
      })
    );
  });

  it('returns 400 when Stripe throws a typed error', async () => {
    const stripeErr: any = new Error('Card declined');
    stripeErr.type = 'card_error';
    mockStripePaymentIntents.create.mockRejectedValue(stripeErr);

    const app = buildApp();
    const res = await request(app)
      .post('/billing/invoice')
      .send({ amount_cents: 5000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Card declined');
  });
});

/* ------------------------------------------------------------------ */
/*  GET /billing/invoices                                             */
/* ------------------------------------------------------------------ */
describe('GET /billing/invoices', () => {
  it('returns list of invoices', async () => {
    const invoices = [
      { id: 'inv-1', amountCents: 5000, status: 'PAID', payments: [] },
    ];
    mockPrisma.invoice.findMany.mockResolvedValue(invoices);

    const app = buildApp();
    const res = await request(app).get('/billing/invoices');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  POST /billing/subscribe                                           */
/* ------------------------------------------------------------------ */
describe('POST /billing/subscribe', () => {
  it('returns 400 for invalid input', async () => {
    const app = buildApp();
    const res = await request(app).post('/billing/subscribe').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 400 for invalid tier', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/billing/subscribe')
      .send({ tier: 'INVALID', priceId: 'price_123' });
    expect(res.status).toBe(400);
  });

  it('creates customer and subscription when no billing profile exists', async () => {
    mockPrisma.billingProfile.findFirst.mockResolvedValue(null);
    mockStripeCustomers.create.mockResolvedValue({ id: 'cus_123' });
    mockPrisma.billingProfile.create.mockResolvedValue({ id: 'bp-1', stripeCustomerId: 'cus_123' });

    const mockSub = {
      id: 'sub_123',
      trial_end: null,
      latest_invoice: { payment_intent: { client_secret: 'pi_secret' } },
    };
    mockStripeSubscriptions.create.mockResolvedValue(mockSub);
    mockPrisma.subscription.upsert.mockResolvedValue({});

    const app = buildApp();
    const res = await request(app)
      .post('/billing/subscribe')
      .send({ tier: 'STARTER', priceId: 'price_123' });
    expect(res.status).toBe(201);
    expect(res.body.subscriptionId).toBe('sub_123');
    expect(res.body.clientSecret).toBe('pi_secret');
    expect(mockPrisma.billingProfile.create).toHaveBeenCalled();
  });

  it('updates billing profile when profile exists but has no stripeCustomerId', async () => {
    mockPrisma.billingProfile.findFirst.mockResolvedValue({ id: 'bp-1', stripeCustomerId: null });
    mockStripeCustomers.create.mockResolvedValue({ id: 'cus_456' });
    mockPrisma.billingProfile.update.mockResolvedValue({});

    const mockSub = {
      id: 'sub_456',
      trial_end: null,
      latest_invoice: { payment_intent: { client_secret: 'pi_secret_2' } },
    };
    mockStripeSubscriptions.create.mockResolvedValue(mockSub);
    mockPrisma.subscription.upsert.mockResolvedValue({});

    const app = buildApp();
    const res = await request(app)
      .post('/billing/subscribe')
      .send({ tier: 'PROFESSIONAL', priceId: 'price_456' });
    expect(res.status).toBe(201);
    expect(mockPrisma.billingProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bp-1' },
        data: { stripeCustomerId: 'cus_456' },
      })
    );
  });

  it('uses existing stripeCustomerId when billing profile already has one', async () => {
    mockPrisma.billingProfile.findFirst.mockResolvedValue({ id: 'bp-1', stripeCustomerId: 'cus_existing' });

    const mockSub = {
      id: 'sub_789',
      trial_end: Math.floor(Date.now() / 1000) + 86400,
      latest_invoice: { payment_intent: { client_secret: 'secret' } },
    };
    mockStripeSubscriptions.create.mockResolvedValue(mockSub);
    mockPrisma.subscription.upsert.mockResolvedValue({});

    const app = buildApp();
    const res = await request(app)
      .post('/billing/subscribe')
      .send({ tier: 'STARTER', priceId: 'price_789' });
    expect(res.status).toBe(201);
    expect(mockStripeCustomers.create).not.toHaveBeenCalled();
    expect(mockStripeSubscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' })
    );
  });

  it('returns 400 when Stripe throws a typed error', async () => {
    mockPrisma.billingProfile.findFirst.mockResolvedValue({ id: 'bp-1', stripeCustomerId: 'cus_existing' });
    const stripeErr: any = new Error('Subscription creation failed');
    stripeErr.type = 'api_error';
    mockStripeSubscriptions.create.mockRejectedValue(stripeErr);

    const app = buildApp();
    const res = await request(app)
      .post('/billing/subscribe')
      .send({ tier: 'STARTER', priceId: 'price_123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Subscription creation failed');
  });
});

/* ------------------------------------------------------------------ */
/*  POST /billing/portal-session                                      */
/* ------------------------------------------------------------------ */
describe('POST /billing/portal-session', () => {
  it('returns 400 when no billing profile / stripeCustomerId', async () => {
    mockPrisma.billingProfile.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).post('/billing/portal-session');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_billing_profile');
  });

  it('returns 400 when billing profile exists but stripeCustomerId is null', async () => {
    mockPrisma.billingProfile.findFirst.mockResolvedValue({ id: 'bp-1', stripeCustomerId: null });
    const app = buildApp();
    const res = await request(app).post('/billing/portal-session');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_billing_profile');
  });

  it('returns portal session URL on success', async () => {
    mockPrisma.billingProfile.findFirst.mockResolvedValue({ id: 'bp-1', stripeCustomerId: 'cus_123' });
    mockStripeBillingPortalSessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/session' });

    const app = buildApp();
    const res = await request(app).post('/billing/portal-session');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://billing.stripe.com/session');
  });

  it('returns 400 when Stripe throws a typed error', async () => {
    mockPrisma.billingProfile.findFirst.mockResolvedValue({ id: 'bp-1', stripeCustomerId: 'cus_123' });
    const stripeErr: any = new Error('Portal error');
    stripeErr.type = 'api_error';
    mockStripeBillingPortalSessions.create.mockRejectedValue(stripeErr);

    const app = buildApp();
    const res = await request(app).post('/billing/portal-session');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Portal error');
  });
});

/* ------------------------------------------------------------------ */
/*  POST /billing/webhooks/stripe                                     */
/* ------------------------------------------------------------------ */
describe('POST /billing/webhooks/stripe', () => {
  function buildWebhookApp() {
    const app = express();
    // The webhook route uses express.raw, so we must NOT use express.json globally
    // But we need it for other routes. The billing router handles it internally.
    app.use('/billing', router);
    return app;
  }

  it('returns 400 when stripe-signature header is missing', async () => {
    mockStripeWebhooks.constructEvent.mockImplementation(() => {
      throw new Error('No signature');
    });
    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'test' }));
    // Missing signature header -> either 400 from missing sig check or 400 from constructEvent
    expect(res.status).toBe(400);
  });

  it('returns 400 when signature verification fails', async () => {
    mockStripeWebhooks.constructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });
    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'invalid_sig')
      .send(JSON.stringify({ type: 'test' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Webhook signature verification failed');
  });

  it('handles payment_intent.succeeded — updates invoice and creates payment', async () => {
    const pi = { id: 'pi_123', amount: 5000, currency: 'usd' };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: pi },
    });
    const invoice = { id: 'inv-1', organizationId: 'org-1' };
    mockPrisma.invoice.findUnique.mockResolvedValue(invoice);
    mockPrisma.$transaction.mockResolvedValue(undefined);

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({ type: 'payment_intent.succeeded' }));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it('handles payment_intent.succeeded — no-op when invoice not found', async () => {
    const pi = { id: 'pi_unknown', amount: 1000, currency: 'usd' };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: pi },
    });
    mockPrisma.invoice.findUnique.mockResolvedValue(null);

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('handles payment_intent.payment_failed — creates failed payment', async () => {
    const pi = { id: 'pi_fail', amount: 3000, currency: 'usd' };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: { object: pi },
    });
    const invoice = { id: 'inv-2', organizationId: 'org-1' };
    mockPrisma.invoice.findUnique.mockResolvedValue(invoice);

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', stripePaymentId: 'pi_fail' }),
      })
    );
  });

  it('handles payment_intent.payment_failed — no-op when invoice not found', async () => {
    const pi = { id: 'pi_unknown', amount: 1000, currency: 'usd' };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: { object: pi },
    });
    mockPrisma.invoice.findUnique.mockResolvedValue(null);

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('handles customer.subscription.created — upserts subscription', async () => {
    const sub = {
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      trial_end: null,
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      metadata: { organizationId: 'org-1' },
    };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.created',
      data: { object: sub },
    });
    mockPrisma.subscription.upsert.mockResolvedValue({});

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_123' },
        create: expect.objectContaining({ organizationId: 'org-1', stripeCustomerId: 'cus_123' }),
      })
    );
  });

  it('handles customer.subscription.created — no-op when no organizationId in metadata', async () => {
    const sub = {
      id: 'sub_no_org',
      customer: 'cus_123',
      status: 'active',
      trial_end: null,
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      metadata: {},
    };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.created',
      data: { object: sub },
    });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it('handles customer.subscription.created with customer as object', async () => {
    const sub = {
      id: 'sub_obj',
      customer: { id: 'cus_obj' },
      status: 'trialing',
      trial_end: Math.floor(Date.now() / 1000) + 86400,
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      metadata: { organizationId: 'org-2' },
    };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.created',
      data: { object: sub },
    });
    mockPrisma.subscription.upsert.mockResolvedValue({});

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ stripeCustomerId: 'cus_obj' }),
      })
    );
  });

  it('handles customer.subscription.updated', async () => {
    const sub = {
      id: 'sub_upd',
      status: 'active',
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: true,
    };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: sub },
    });
    mockPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_upd' },
        data: expect.objectContaining({ status: 'active', cancelAtPeriodEnd: true }),
      })
    );
  });

  it('handles customer.subscription.deleted', async () => {
    const sub = { id: 'sub_del' };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: sub },
    });
    mockPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_del' },
        data: { status: 'canceled' },
      })
    );
  });

  it('handles invoice.payment_succeeded — activates subscription', async () => {
    const inv = { subscription: 'sub_active' };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: inv },
    });
    mockPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_active' },
        data: { status: 'active' },
      })
    );
  });

  it('handles invoice.payment_succeeded — no-op when no subId', async () => {
    const inv = { subscription: null };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: inv },
    });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('handles invoice.payment_succeeded with subscription as object', async () => {
    const inv = { subscription: { id: 'sub_obj_active' } };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: inv },
    });
    mockPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_obj_active' },
      })
    );
  });

  it('handles invoice.payment_failed — marks past_due and sends email', async () => {
    const inv = { subscription: 'sub_past_due', hosted_invoice_url: 'https://pay.stripe.com/inv' };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: inv },
    });
    mockPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', organizationId: 'org-1' });
    mockPrisma.organizationMember.findFirst.mockResolvedValue({
      user: { email: 'owner@example.com', firstName: 'Owner' },
    });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'past_due' },
      })
    );
    // sendEmail is called asynchronously (fire-and-forget), give it a tick
    await new Promise(r => setTimeout(r, 10));
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.com',
        subject: expect.stringContaining('Payment failed'),
      })
    );
  });

  it('handles invoice.payment_failed — no-op when no subId', async () => {
    const inv = { subscription: null };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: inv },
    });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('handles invoice.payment_failed — no email when no owner found', async () => {
    const inv = { subscription: 'sub_no_owner' };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: inv },
    });
    mockPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', organizationId: 'org-1' });
    mockPrisma.organizationMember.findFirst.mockResolvedValue(null);

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('handles invoice.payment_failed — no email when no subscription in DB', async () => {
    const inv = { subscription: 'sub_not_in_db' };
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: inv },
    });
    mockPrisma.subscription.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.subscription.findFirst.mockResolvedValue(null);

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('handles unknown event type gracefully', async () => {
    mockStripeWebhooks.constructEvent.mockReturnValue({
      type: 'unknown.event.type',
      data: { object: {} },
    });

    const app = buildWebhookApp();
    const res = await request(app)
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  error propagation via next(err)                                   */
/* ------------------------------------------------------------------ */
describe('error propagation via next(err)', () => {
  it('POST /invoice propagates non-Stripe errors', async () => {
    mockStripePaymentIntents.create.mockRejectedValue(new Error('Unexpected'));
    const app = buildAppWithErrHandler();
    const res = await request(app)
      .post('/billing/invoice')
      .send({ amount_cents: 5000 });
    expect(res.status).toBe(500);
  });

  it('GET /invoices propagates DB errors', async () => {
    mockPrisma.invoice.findMany.mockRejectedValue(new Error('DB'));
    const app = buildAppWithErrHandler();
    const res = await request(app).get('/billing/invoices');
    expect(res.status).toBe(500);
  });

  it('POST /subscribe propagates non-Stripe errors', async () => {
    mockPrisma.billingProfile.findFirst.mockResolvedValue({ id: 'bp-1', stripeCustomerId: 'cus_1' });
    mockStripeSubscriptions.create.mockRejectedValue(new Error('Unexpected'));
    const app = buildAppWithErrHandler();
    const res = await request(app)
      .post('/billing/subscribe')
      .send({ tier: 'STARTER', priceId: 'price_123' });
    expect(res.status).toBe(500);
  });

  it('POST /portal-session propagates non-Stripe errors', async () => {
    mockPrisma.billingProfile.findFirst.mockResolvedValue({ id: 'bp-1', stripeCustomerId: 'cus_1' });
    mockStripeBillingPortalSessions.create.mockRejectedValue(new Error('Unexpected'));
    const app = buildAppWithErrHandler();
    const res = await request(app).post('/billing/portal-session');
    expect(res.status).toBe(500);
  });
});

/* ------------------------------------------------------------------ */
/*  Additional coverage: no-org branches for invoice, subscribe,      */
/*  and portal-session                                                */
/* ------------------------------------------------------------------ */
describe('POST /billing/invoice — no organization', () => {
  it('returns 403 when user has no organizationId', async () => {
    mockProtect.mockImplementationOnce((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', email: 'test@example.com', roles: ['LAWYER'] };
      next();
    });
    const app = buildApp();
    const res = await request(app)
      .post('/billing/invoice')
      .send({ amount_cents: 1000 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('No active organization.');
  });
});

describe('POST /billing/subscribe — no organization', () => {
  it('returns 403 when user has no organizationId', async () => {
    mockProtect.mockImplementationOnce((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', email: 'test@example.com', roles: ['LAWYER'] };
      next();
    });
    const app = buildApp();
    const res = await request(app)
      .post('/billing/subscribe')
      .send({ tier: 'STARTER', priceId: 'price_123' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('No active organization.');
  });
});

describe('POST /billing/portal-session — no organization', () => {
  it('returns 403 when user has no organizationId', async () => {
    mockProtect.mockImplementationOnce((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', email: 'test@example.com', roles: ['LAWYER'] };
      next();
    });
    const app = buildApp();
    const res = await request(app).post('/billing/portal-session');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('No active organization.');
  });
});
