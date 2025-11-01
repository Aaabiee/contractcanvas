// apps/api/src/routes/billing.ts
import express, { Router, Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { stripe as stripeConfig } from '../config.js'; // Import from config

export const router = Router();

// --- Initialize Stripe Client Safely ---
const STRIPE_KEY = stripeConfig.secretKey;
let stripe: Stripe | null = null; // Initialize as null

// Infer the 'apiVersion' type directly from the StripeConfig interface
type StripeApiVersion = Stripe.StripeConfig['apiVersion'];
// -----------------------

// Check if the key is a real key (not empty or a placeholder)
if (STRIPE_KEY && !STRIPE_KEY.includes('CONTRA_')) {
  try {
    // Use the correctly inferred type
    const apiVersion = (process.env.STRIPE_API_VERSION || undefined) as StripeApiVersion;
    stripe = new Stripe(STRIPE_KEY, { apiVersion });
    console.log('[billing] Stripe client initialized.');
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[billing] Failed to initialize Stripe: ${message}`);
  }
} else {
  // This warning is expected if you're using the placeholder key
  console.warn('[billing] STRIPE_SECRET_KEY is not set or is a placeholder. Billing routes will be disabled.');
}
// ------------------------------------

// --- Zod Schemas ---
const CreateIntentSchema = z.object({
  amount_cents: z.number().int().positive(),
  currency: z.string().default('usd'),
});

// --- Middleware to check if Stripe is active ---
const isStripeActive = (req: Request, res: Response, next: NextFunction) => {
  if (!stripe) {
    return res.status(501).json({ error: 'Billing is not configured on this server.' });
  }
  next();
};

// --- Routes ---

// POST /api/billing/invoice (Protected by middleware)
router.post('/invoice', isStripeActive, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = CreateIntentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }
    const { amount_cents, currency } = validation.data;

    // We use stripe! (non-null assertion) because isStripeActive middleware guarantees it's not null
    const pi = await stripe!.paymentIntents.create({
      amount: amount_cents,
      currency,
      automatic_payment_methods: { enabled: true },
    });

    res.status(201).json({ client_secret: pi.client_secret });
  } catch (error: any) {
    if (error && typeof error === 'object' && 'type' in error) { // StripeError
      return res.status(400).json({ error: String(error.message ?? error) });
    }
    next(error);
  }
});

// POST /api/billing/webhooks/stripe (Stripe Webhook Handler)
const WH_SECRET = stripeConfig.webhookSecret ?? '';
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req: Request, res: Response) => {
    // Check for both stripe client and webhook secret
    if (!stripe || !WH_SECRET || WH_SECRET.includes('YOUR_')) {
      return res.status(501).json({ error: 'Webhook secret not configured' });
    }
    
    try {
        const sig = req.headers['stripe-signature'];
        if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

        const event = stripe.webhooks.constructEvent(req.body, String(sig), WH_SECRET);
        console.log(`[Stripe Webhook] Received event: ${event.type}`);
        
        switch (event.type) {
            case 'payment_intent.succeeded':
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                console.log(`PaymentIntent ${paymentIntent.id} succeeded.`);
                // TODO: Update your Invoice/Payment status in DB
                break;
        }
        res.json({ received: true });
    } catch (err: any) {
        console.error(`[Stripe Webhook Error] ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
});

export default router;