import express, { Router, Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { stripe as stripeConfig } from '../config.js';
import { protect } from '../middleware/auth.js';

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
  currency: z.string().default('usd'),
});

const isStripeActive = (req: Request, res: Response, next: NextFunction) => {
  if (!stripe) {
    return res.status(501).json({ error: 'Billing is not configured on this server.' });
  }
  next();
};

router.post('/invoice', protect, isStripeActive, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = CreateIntentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }
    const { amount_cents, currency } = validation.data;

    const pi = await stripe!.paymentIntents.create({
      amount: amount_cents,
      currency,
      automatic_payment_methods: { enabled: true },
    });

    res.status(201).json({ client_secret: pi.client_secret });
  } catch (error: any) {
    if (error && typeof error === 'object' && 'type' in error) {
      return res.status(400).json({ error: String(error.message ?? error) });
    }
    next(error);
  }
});

const WH_SECRET = stripeConfig.webhookSecret ?? '';
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req: Request, res: Response) => {
  if (!stripe || !WH_SECRET || WH_SECRET.includes('YOUR_')) {
    return res.status(501).json({ error: 'Webhook secret not configured' });
  }

  try {
    const sig = req.headers['stripe-signature'];
    if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

    const event = stripe.webhooks.constructEvent(req.body, String(sig), WH_SECRET);

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log(`[billing] payment_intent.succeeded: ${paymentIntent.id}`);
        break;
      }
    }
    res.json({ received: true });
  } catch (err: any) {
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }
});

export default router;
