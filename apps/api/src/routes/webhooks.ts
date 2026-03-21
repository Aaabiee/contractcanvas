import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import prisma from '../prisma.js';

const ALLOWED_EVENTS = new Set([
  'matter.created', 'matter.updated', 'matter.deleted',
  'contract.created', 'contract.updated', 'contract.status_changed',
  'document.uploaded', 'document.deleted',
  'signature.completed', 'task.completed',
]);

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)|^::1$|^0\.|^fc|^fd|^fe80:|^localhost$/i;

function isPrivateUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return PRIVATE_IP_RE.test(hostname) || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal');
  } catch {
    return true;
  }
}

const CreateWebhookSchema = z.object({
  url:    z.string().url(),
  events: z.array(z.string()).min(1),
});

const UpdateWebhookSchema = z.object({
  url:      z.string().url().optional(),
  events:   z.array(z.string()).min(1).optional(),
  isActive: z.boolean().optional(),
});

function requireOrgRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const orgRole = req.user?.orgRole;
    if (!orgRole || !roles.includes(orgRole)) {
      res.status(403).json({ error: 'forbidden', message: 'Requires OWNER or ADMIN role' });
      return;
    }
    next();
  };
}

const router = Router({ mergeParams: true });

router.get('/', requireOrgRole('OWNER', 'ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = req.params;
    if (orgId !== req.user?.organizationId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const hooks = await prisma.outboundWebhook.findMany({
      where: { organizationId: orgId },
      select: { id: true, url: true, events: true, isActive: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: hooks });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireOrgRole('OWNER', 'ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = req.params;
    if (orgId !== req.user?.organizationId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const validation = CreateWebhookSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    const { url, events } = validation.data;

    if (process.env.NODE_ENV === 'production' && !url.startsWith('https://')) {
      return res.status(400).json({ error: 'url must use https in production' });
    }

    if (isPrivateUrl(url)) {
      return res.status(400).json({ error: 'url must not point to a private or internal address' });
    }

    const invalidEvents = events.filter(e => !ALLOWED_EVENTS.has(e));
    if (invalidEvents.length > 0) {
      return res.status(400).json({ error: 'Invalid events', details: { invalidEvents, allowedEvents: [...ALLOWED_EVENTS] } });
    }

    const secret = crypto.randomBytes(32).toString('hex');

    const hook = await prisma.outboundWebhook.create({
      data: { organizationId: orgId, url, events, secret },
      select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    });

    res.status(201).json({
      ...hook,
      secret,
      warning: 'This secret will not be shown again. Store it securely.',
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:webhookId', requireOrgRole('OWNER', 'ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, webhookId } = req.params;
    if (orgId !== req.user?.organizationId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const validation = UpdateWebhookSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    const existing = await prisma.outboundWebhook.findFirst({ where: { id: webhookId, organizationId: orgId } });
    if (!existing) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const { url, events, isActive } = validation.data;

    if (url) {
      if (process.env.NODE_ENV === 'production' && !url.startsWith('https://')) {
        return res.status(400).json({ error: 'url must use https in production' });
      }
      if (isPrivateUrl(url)) {
        return res.status(400).json({ error: 'url must not point to a private or internal address' });
      }
    }

    if (events) {
      const invalidEvents = events.filter(e => !ALLOWED_EVENTS.has(e));
      if (invalidEvents.length > 0) {
        return res.status(400).json({ error: 'Invalid events', details: { invalidEvents, allowedEvents: [...ALLOWED_EVENTS] } });
      }
    }

    const updated = await prisma.outboundWebhook.update({
      where: { id: webhookId },
      data:  { ...(url !== undefined ? { url } : {}), ...(events !== undefined ? { events } : {}), ...(isActive !== undefined ? { isActive } : {}) },
      select: { id: true, url: true, events: true, isActive: true, createdAt: true, updatedAt: true },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:webhookId', requireOrgRole('OWNER', 'ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, webhookId } = req.params;
    if (orgId !== req.user?.organizationId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const existing = await prisma.outboundWebhook.findFirst({ where: { id: webhookId, organizationId: orgId } });
    if (!existing) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    await prisma.outboundWebhook.delete({ where: { id: webhookId } });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/:webhookId/deliveries', requireOrgRole('OWNER', 'ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, webhookId } = req.params;
    if (orgId !== req.user?.organizationId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const existing = await prisma.outboundWebhook.findFirst({ where: { id: webhookId, organizationId: orgId } });
    if (!existing) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const deliveries = await prisma.outboundWebhookDelivery.findMany({
      where:   { webhookId },
      select:  { id: true, event: true, statusCode: true, success: true, attempts: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });

    res.json({ data: deliveries });
  } catch (err) {
    next(err);
  }
});

export default router;
