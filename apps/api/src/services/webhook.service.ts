import crypto from 'node:crypto';
import prisma from '../prisma.js';
import { logger } from '../lib/logger.js';

export async function deliverWebhook(
  organizationId: string,
  event: string,
  payload: object
): Promise<void> {
  const hooks = await prisma.outboundWebhook.findMany({
    where: { organizationId, isActive: true, events: { has: event } },
  });

  for (const hook of hooks) {
    const body = JSON.stringify({ event, data: payload, deliveredAt: new Date().toISOString() });
    const sig  = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');

    let statusCode: number | null = null;
    let success = false;

    try {
      const res = await fetch(hook.url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature-256': `sha256=${sig}` },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      statusCode = res.status;
      success    = res.ok;
    } catch (err) {
      logger.warn({ webhookId: hook.id, event, err }, 'Webhook delivery failed');
    }

    await prisma.outboundWebhookDelivery.create({
      data: { webhookId: hook.id, event, payload: payload as any, statusCode, success },
    });
  }
}
