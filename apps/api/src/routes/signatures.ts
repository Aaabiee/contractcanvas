import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';
import { getProvider } from '../services/signature-provider.js';
import { writeAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

export const router = Router();

const CALLBACK_BASE = process.env.API_BASE_URL || 'http://localhost:3333';

const CreateEnvelopeSchema = z.object({
  contractId: z.string().cuid(),
  provider:   z.enum(['docusign', 'hellosign']),
  recipients: z.array(z.object({
    email: z.string().email(),
    name:  z.string().min(1).max(200),
    role:  z.string().min(1).max(50),
  })).min(1).max(20),
  message: z.string().max(1000).optional(),
});

const STATUS_MAP: Record<string, string> = {
  sent:      'SENT',
  delivered: 'VIEWED',
  completed: 'COMPLETED',
  signed:    'SIGNED',
  voided:    'VOIDED',
  declined:  'DECLINED',
};

function mapStatus(raw: string): string {
  return STATUS_MAP[raw.toLowerCase()] || raw.toUpperCase();
}

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const validation = CreateEnvelopeSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }
    const { contractId, provider: providerName, recipients, message } = validation.data;

    const contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId, deletedAt: null },
      include: { matter: { select: { ownerId: true } } },
    });
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const senderEmail = req.user?.email?.toLowerCase();
    const senderIsRecipient = recipients.some(r => r.email.toLowerCase() === senderEmail);
    if (senderIsRecipient) {
      return res.status(400).json({ error: 'Segregation of duty: the person sending a contract for signature cannot be a signer' });
    }

    const provider = getProvider(providerName);
    const callbackUrl = `${CALLBACK_BASE}/api/signatures/webhook/${providerName}`;

    const result = await provider.createEnvelope({
      title:       contract.title,
      message,
      recipients,
      callbackUrl,
    });

    const envelope = await prisma.signatureEnvelope.create({
      data: {
        organizationId,
        contractId,
        provider:   providerName,
        providerId: result.providerId,
        status:     mapStatus(result.status) as any,
        recipients: recipients as any,
        metadata:   result.signingUrl ? { signingUrl: result.signingUrl } : undefined,
      },
    });

    await writeAuditLog({
      organizationId,
      actorId:   req.user!.id,
      entity:    'SignatureEnvelope',
      entityId:  envelope.id,
      action:    'CREATED',
      ip:        req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});

    res.status(201).json(envelope);
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const { contractId } = req.query;
    if (!contractId || typeof contractId !== 'string') {
      return res.status(400).json({ error: 'contractId query parameter is required' });
    }

    const envelopes = await prisma.signatureEnvelope.findMany({
      where:   { contractId, organizationId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(envelopes);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const envelope = await prisma.signatureEnvelope.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!envelope) {
      return res.status(404).json({ error: 'Signature envelope not found' });
    }

    res.json(envelope);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/void', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : 'Voided by organization';

    const envelope = await prisma.signatureEnvelope.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!envelope) {
      return res.status(404).json({ error: 'Signature envelope not found' });
    }

    if (['COMPLETED', 'VOIDED', 'DECLINED'].includes(envelope.status)) {
      return res.status(409).json({ error: `Cannot void envelope in ${envelope.status} status` });
    }

    const provider = getProvider(envelope.provider);
    await provider.voidEnvelope(envelope.providerId, reason);

    const updated = await prisma.signatureEnvelope.update({
      where: { id: envelope.id },
      data:  { status: 'VOIDED' },
    });

    await writeAuditLog({
      organizationId,
      actorId:   req.user!.id,
      entity:    'SignatureEnvelope',
      entityId:  envelope.id,
      action:    'VOIDED',
      ip:        req.ip,
      userAgent: req.headers['user-agent'],
      after:     { reason },
    }).catch(() => {});

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/resend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const envelope = await prisma.signatureEnvelope.findFirst({
      where: { id: req.params.id, organizationId },
      include: { contract: { select: { title: true } } },
    });
    if (!envelope) {
      return res.status(404).json({ error: 'Signature envelope not found' });
    }

    if (['COMPLETED', 'VOIDED', 'DECLINED'].includes(envelope.status)) {
      return res.status(409).json({ error: `Cannot resend envelope in ${envelope.status} status` });
    }

    const recipients = Array.isArray(envelope.recipients) ? envelope.recipients as any[] : [];

    const provider = getProvider(envelope.provider);
    const callbackUrl = `${CALLBACK_BASE}/api/signatures/webhook/${envelope.provider}`;

    const result = await provider.createEnvelope({
      title:       envelope.contract.title,
      recipients,
      callbackUrl,
    });

    const updated = await prisma.signatureEnvelope.update({
      where: { id: envelope.id },
      data: {
        providerId: result.providerId,
        status:     mapStatus(result.status) as any,
        metadata:   result.signingUrl ? { signingUrl: result.signingUrl } : undefined,
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export const signatureWebhookRouter = Router();

signatureWebhookRouter.post('/:provider', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const providerName = req.params.provider;
    if (!['docusign', 'hellosign'].includes(providerName)) {
      return res.status(400).json({ error: 'Unknown provider' });
    }

    const provider = getProvider(providerName);
    const rawBody  = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const sig      = (req.headers['x-docusign-signature-1'] || req.headers['x-hellosign-signature'] || '') as string;

    if (process.env.NODE_ENV === 'production' && !provider.verifyWebhook(rawBody, sig)) {
      logger.warn({ provider: providerName }, 'Webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    let providerId: string | undefined;
    let newStatus: string | undefined;
    let recipientUpdates: Array<{ email: string; status: string; signedAt?: string }> = [];

    if (providerName === 'docusign') {
      const event = req.body?.event || req.body?.EnvelopeStatus?.Status;
      providerId  = req.body?.data?.envelopeId || req.body?.EnvelopeStatus?.EnvelopeID;
      newStatus   = typeof event === 'string' ? mapStatus(event) : undefined;
    } else {
      const event = req.body?.event?.event_type;
      providerId  = req.body?.signature_request?.signature_request_id;
      newStatus   = typeof event === 'string' ? mapStatus(event.replace('signature_request_', '')) : undefined;
      const sigs  = req.body?.signature_request?.signatures;
      if (Array.isArray(sigs)) {
        recipientUpdates = sigs.map((s: any) => ({
          email:    s.signer_email_address,
          status:   s.status_code,
          signedAt: s.signed_at || undefined,
        }));
      }
    }

    if (!providerId || !newStatus) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const envelope = await prisma.signatureEnvelope.findFirst({
      where: { providerId, provider: providerName },
    });

    if (!envelope) {
      logger.warn({ providerId, provider: providerName }, 'Webhook for unknown envelope');
      return res.status(200).json({ ok: true, ignored: true });
    }

    const updateData: any = { status: newStatus };
    if (recipientUpdates.length > 0) {
      updateData.recipients = recipientUpdates;
    }
    if (newStatus === 'COMPLETED') {
      updateData.metadata = { ...(envelope.metadata as any || {}), completedAt: new Date().toISOString() };
    }

    await prisma.signatureEnvelope.update({
      where: { id: envelope.id },
      data:  updateData,
    });

    if (newStatus === 'COMPLETED') {
      await prisma.contract.update({
        where: { id: envelope.contractId },
        data:  { status: 'EXECUTED' },
      }).catch(err => logger.error({ err, contractId: envelope.contractId }, 'Failed to update contract status to EXECUTED'));
    }

    logger.info({ envelopeId: envelope.id, newStatus, provider: providerName }, 'Signature status updated via webhook');

    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
