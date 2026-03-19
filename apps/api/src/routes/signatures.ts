import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';

export const router = Router();

const CreateEnvelopeSchema = z.object({
  contractId: z.string().cuid(),
  provider:   z.enum(['docusign', 'hellosign']),
  recipients: z.array(z.object({
    email: z.string().email(),
    name:  z.string(),
    role:  z.string(),
  })).min(1),
});

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
    const { contractId, provider, recipients } = validation.data;

    const contract = await prisma.contract.findFirst({ where: { id: contractId, organizationId, deletedAt: null } });
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const fakeProviderId = `${provider}_${Date.now()}`;

    const newEnvelope = await prisma.signatureEnvelope.create({
      data: {
        organizationId,
        contractId,
        provider,
        providerId: fakeProviderId,
        status:     'CREATED',
        recipients: recipients as any,
      },
    });

    res.status(201).json(newEnvelope);
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

    const { id } = req.params;
    const envelope = await prisma.signatureEnvelope.findFirst({
      where: { id, organizationId },
    });
    if (!envelope) {
      return res.status(404).json({ error: 'Signature envelope not found' });
    }

    res.json(envelope);
  } catch (error) {
    next(error);
  }
});

export default router;
