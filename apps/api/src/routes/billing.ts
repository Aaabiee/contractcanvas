import express, { Router, Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { stripe as stripeConfig } from '../config.js';
import { protect, requireEmailVerified } from '../middleware/auth.js';
import prisma from '../prisma.js';

export const router = Router();

const STRIPE_KEY = stripeConfig.secretKey;
let stripe: Stripe | null = null;

type StripeApiVersion = Stripe.StripeConfig['apiVersion'];

if (STRIPE_KEY && !STRIPE_KEY.includes('CONTRA_')) {
  try {
    const apiVersion = (process.env.STRIPE_API_VERSION || undefined) as StripeApiVersion;
    stripe = new Stripe(STRIPE_KEY, { apiVersion });
    console.log('[billing] Stripe client initialized.');
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[billing] Failed to initialize Stripe: ${message}`);
  }
} else {
  console.warn('[billing] STRIPE_SECRET_KEY is not set or is a placeholder. Billing routes will be disabled.');
}

const CreateIntentSchema = z.object({
  amount_cents: z.number().int().positive(),
  currency:     z.string().default('usd'),
  contractId:   z.string().cuid().optional(),
});

const isStripeActive = (req: Request, res: Response, next: NextFunction) => {
  if (!stripe) {
    return res.status(501).json({ error: 'Billing is not configured on this server.' });
  }
  next();
};

router.post('/invoice', protect, requireEmailVerified, isStripeActive, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = CreateIntentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    const { amount_cents, currency, contractId } = validation.data;
    const organizationId = req.user!.organizationId;

    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    if (contractId) {
      const contract = await prisma.contract.findFirst({ where: { id: contractId, organizationId } });
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
    }

    const pi = await stripe!.paymentIntents.create({
      amount:   amount_cents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: { organizationId, ...(contractId ? { contractId } : {}) },
    });

    const invoice = await prisma.invoice.create({
      data: {
        organizationId,
        contractId:  contractId ?? null,
        amountCents: amount_cents,
        currency,
        status:      'DRAFT',
        stripeId:    pi.id,
      },
    });

    res.status(201).json({ client_secret: pi.client_secret, invoiceId: invoice.id });
  } catch (error: any) {
    if (error && typeof error === 'object' && 'type' in error) {
      return res.status(400).json({ error: String(error.message ?? error) });
    }
    next(error);
  }
});

router.get('/invoices', protect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) return res.status(403).json({ error: 'No active organization.' });

    const invoices = await prisma.invoice.findMany({
      where:   { organizationId },
      orderBy: { issuedAt: 'desc' },
      include: { payments: true },
    });

    res.json({ data: invoices, total: invoices.length });
  } catch (err) {
    next(err);
  }
});

const WH_SECRET = stripeConfig.webhookSecret ?? '';
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  if (!stripe || !WH_SECRET || WH_SECRET.includes('YOUR_')) {
    return res.status(501).json({ error: 'Webhook secret not configured' });
  }

  try {
    const sig = req.headers['stripe-signature'];
    if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

    const event = stripe.webhooks.constructEvent(req.body, String(sig), WH_SECRET);

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;

        const invoice = await prisma.invoice.findUnique({ where: { stripeId: pi.id } });
        if (invoice) {
          await prisma.$transaction([
            prisma.invoice.update({
              where: { id: invoice.id },
              data:  { status: 'PAID', paidAt: new Date() },
            }),
            prisma.payment.create({
              data: {
                organizationId:  invoice.organizationId,
                invoiceId:        invoice.id,
                stripePaymentId:  pi.id,
                amountCents:      pi.amount,
                currency:         pi.currency,
                status:           'SUCCEEDED',
              },
            }),
          ]);
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const invoice = await prisma.invoice.findUnique({ where: { stripeId: pi.id } });
        if (invoice) {
          await prisma.payment.create({
            data: {
              organizationId: invoice.organizationId,
              invoiceId:       invoice.id,
              stripePaymentId: pi.id,
              amountCents:     pi.amount,
              currency:        pi.currency,
              status:          'FAILED',
            },
          });
        }
        break;
      }
    }

    res.json({ received: true });
  } catch {
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }
});

export default router;
