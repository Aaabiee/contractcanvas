import express, { Router, Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { stripe as stripeConfig } from '../config.js';
import { protect, requireEmailVerified } from '../middleware/auth.js';
import prisma from '../prisma.js';
import logger from '../lib/logger.js';
import { sendEmail } from '../services/email.service.js';

export const router = Router();

const STRIPE_KEY = stripeConfig.secretKey;
let stripe: Stripe | null = null;

type StripeApiVersion = Stripe.StripeConfig['apiVersion'];

if (STRIPE_KEY && !STRIPE_KEY.includes('CONTRA_')) {
  try {
    const apiVersion = (process.env.STRIPE_API_VERSION || undefined) as StripeApiVersion;
    stripe = new Stripe(STRIPE_KEY, { apiVersion });
    logger.info('[billing] Stripe client initialized.');
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`[billing] Failed to initialize Stripe: ${message}`);
  }
} else {
  logger.warn('[billing] STRIPE_SECRET_KEY is not set or is a placeholder. Billing routes will be disabled.');
}

const CreateIntentSchema = z.object({
  amount_cents: z.number().int().positive(),
  currency:     z.string().regex(/^[a-z]{3}$/, 'Currency must be a 3-letter ISO 4217 code').default('usd'),
  contractId:   z.string().cuid().optional(),
});

const SubscribeSchema = z.object({
  tier:    z.enum(['STARTER', 'PROFESSIONAL']),
  priceId: z.string().min(1),
});

const isStripeActive = (req: Request, res: Response, next: NextFunction) => {
  if (!stripe) {
    return res.status(501).json({ error: 'Billing is not configured on this server.' });
  }
  next();
};

export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  const organizationId = req.user?.organizationId;
  if (!organizationId) { res.status(403).json({ error: 'no_org' }); return; }
  const sub = await prisma.subscription.findFirst({
    where: { organizationId, status: { in: ['active', 'trialing'] } },
  });
  if (!sub) {
    res.status(402).json({ error: 'subscription_required', upgradeUrl: '/settings/billing' });
    return;
  }
  next();
}

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

router.post('/subscribe', protect, async (req: Request, res: Response, next: NextFunction) => {
  if (!stripe) {
    res.status(501).json({ error: 'Billing is not configured on this server.' });
    return;
  }

  try {
    const validation = SubscribeSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
      return;
    }

    const { tier, priceId } = validation.data;
    const organizationId = req.user!.organizationId;

    if (!organizationId) {
      res.status(403).json({ error: 'No active organization.' });
      return;
    }

    let billingProfile = await prisma.billingProfile.findFirst({ where: { organizationId } });
    let stripeCustomerId = billingProfile?.stripeCustomerId ?? null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email:    req.user!.email,
        metadata: { organizationId },
      });
      stripeCustomerId = customer.id;
      if (billingProfile) {
        await prisma.billingProfile.update({
          where: { id: billingProfile.id },
          data:  { stripeCustomerId },
        });
      } else {
        await prisma.billingProfile.create({
          data: { organizationId, stripeCustomerId },
        });
      }
    }

    const sub = await stripe.subscriptions.create({
      customer:         stripeCustomerId,
      items:            [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      expand:           ['latest_invoice.payment_intent'],
    });

    await prisma.subscription.upsert({
      where:  { stripeSubscriptionId: sub.id },
      create: {
        organizationId,
        tier,
        stripeSubscriptionId: sub.id,
        stripeCustomerId,
        status:      'trialing',
        trialEndsAt: sub.trial_end !== null ? new Date(sub.trial_end * 1000) : null,
      },
      update: {
        tier,
        stripeCustomerId,
        status:      'trialing',
        trialEndsAt: sub.trial_end !== null ? new Date(sub.trial_end * 1000) : null,
      },
    });

    const clientSecret = (sub.latest_invoice as any)?.payment_intent?.client_secret ?? null;
    res.status(201).json({ subscriptionId: sub.id, clientSecret });
  } catch (error: any) {
    if (error && typeof error === 'object' && 'type' in error) {
      res.status(400).json({ error: String(error.message ?? error) });
      return;
    }
    next(error);
  }
});

router.post('/portal-session', protect, async (req: Request, res: Response, next: NextFunction) => {
  if (!stripe) {
    res.status(501).json({ error: 'Billing is not configured on this server.' });
    return;
  }

  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: 'No active organization.' });
      return;
    }

    const billingProfile = await prisma.billingProfile.findFirst({ where: { organizationId } });
    const stripeCustomerId = billingProfile?.stripeCustomerId ?? null;

    if (!stripeCustomerId) {
      res.status(400).json({ error: 'no_billing_profile' });
      return;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   stripeCustomerId,
      return_url: (process.env.FRONTEND_URL ?? '') + '/settings/billing',
    });

    res.json({ url: session.url });
  } catch (error: any) {
    if (error && typeof error === 'object' && 'type' in error) {
      res.status(400).json({ error: String(error.message ?? error) });
      return;
    }
    next(error);
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

      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription & { current_period_start: number; current_period_end: number };
        const organizationId = sub.metadata?.organizationId;
        if (organizationId) {
          await prisma.subscription.upsert({
            where:  { stripeSubscriptionId: sub.id },
            create: {
              organizationId,
              tier:                 'STARTER',
              stripeSubscriptionId: sub.id,
              stripeCustomerId:     typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
              status:               sub.status as any,
              trialEndsAt:          sub.trial_end !== null ? new Date(sub.trial_end * 1000) : null,
              currentPeriodStart:   new Date(sub.current_period_start * 1000),
              currentPeriodEnd:     new Date(sub.current_period_end * 1000),
              cancelAtPeriodEnd:    sub.cancel_at_period_end,
            },
            update: {
              status:             sub.status as any,
              trialEndsAt:        sub.trial_end !== null ? new Date(sub.trial_end * 1000) : null,
              currentPeriodStart: new Date(sub.current_period_start * 1000),
              currentPeriodEnd:   new Date(sub.current_period_end * 1000),
              cancelAtPeriodEnd:  sub.cancel_at_period_end,
            },
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription & { current_period_start: number; current_period_end: number };
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data:  {
            status:             sub.status as any,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd:   new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd:  sub.cancel_at_period_end,
          },
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data:  { status: 'canceled' },
        });
        break;
      }

      case 'invoice.payment_succeeded': {
        const inv = event.data.object as any;
        const subId = typeof inv.subscription === 'string' ? inv.subscription : (inv.subscription as any)?.id;
        if (subId) {
          await prisma.subscription.updateMany({
            where: { stripeSubscriptionId: subId },
            data:  { status: 'active' },
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as any;
        const subId = typeof inv.subscription === 'string' ? inv.subscription : (inv.subscription as any)?.id;
        if (subId) {
          await prisma.subscription.updateMany({
            where: { stripeSubscriptionId: subId },
            data:  { status: 'past_due' },
          });

          const sub = await prisma.subscription.findFirst({ where: { stripeSubscriptionId: subId } });
          if (sub) {
            const owner = await prisma.organizationMember.findFirst({
              where:   { organizationId: sub.organizationId, role: 'OWNER' },
              include: { user: { select: { email: true, firstName: true } } },
            });
            if (owner?.user) {
              const paymentLink = inv.hosted_invoice_url ?? '';
              sendEmail({
                to:       owner.user.email,
                subject:  'Action required: Payment failed for your ContractCanvas subscription',
                textBody: `Hi ${owner.user.firstName},\n\nYour recent payment failed. Please update your payment method within 7 days to avoid service interruption.\n\n${paymentLink ? `Pay now: ${paymentLink}` : 'Visit your billing dashboard to update your payment method.'}\n\nContractCanvas`,
                htmlBody: `<p>Hi ${owner.user.firstName},</p><p>Your recent payment failed. Please update your payment method within 7 days to avoid service interruption.</p>${paymentLink ? `<p><a href="${paymentLink}">Pay now</a></p>` : '<p>Visit your billing dashboard to update your payment method.</p>'}<p>ContractCanvas</p>`,
              }).catch(e => logger.error({ err: e }, 'Failed to send payment_failed email'));
            }
          }
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
