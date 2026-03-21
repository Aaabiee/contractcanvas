import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';

const router = Router();
export default router;

const ReminderTypeEnum = z.enum(['DEADLINE', 'RENEWAL', 'PAYMENT']);

const CreateReminderSchema = z.object({
  contractId: z.string().cuid(),
  type:       ReminderTypeEnum,
  dueAt:      z.string().datetime(),
});

const UpdateReminderSchema = z.object({
  type:  ReminderTypeEnum.optional(),
  dueAt: z.string().datetime().optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const { contractId, limit = '50', offset = '0' } = req.query;
    const take = Math.min(Number(limit), 100);
    const skip = Number(offset);

    const where: any = { organizationId };
    if (contractId) where.contractId = contractId;

    const [data, total] = await prisma.$transaction([
      prisma.reminder.findMany({
        where,
        include: { contract: { select: { id: true, title: true } } },
        orderBy: { dueAt: 'asc' },
        take,
        skip,
      }),
      prisma.reminder.count({ where }),
    ]);

    res.json({ data, total, limit: take, offset: skip });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const parsed = CreateReminderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const { contractId, type, dueAt } = parsed.data;

    const contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId, deletedAt: null },
    });
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const reminder = await prisma.reminder.create({
      data: {
        organizationId,
        contractId,
        type,
        dueAt:       new Date(dueAt),
        createdById: req.user!.id,
      },
      include: { contract: { select: { id: true, title: true } } },
    });

    res.status(201).json(reminder);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const parsed = UpdateReminderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const existing = await prisma.reminder.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    const data: any = {};
    if (parsed.data.type)  data.type  = parsed.data.type;
    if (parsed.data.dueAt) { data.dueAt = new Date(parsed.data.dueAt); data.sentAt = null; }

    const updated = await prisma.reminder.update({
      where: { id: req.params.id },
      data,
      include: { contract: { select: { id: true, title: true } } },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const existing = await prisma.reminder.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    await prisma.reminder.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
