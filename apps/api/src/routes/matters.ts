import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';
import { writeAuditLog } from '../lib/audit.js';
import { checkMatterLimit } from '../services/usage.service.js';

export const router = Router();

const CreateMatterSchema = z.object({
  title:       z.string().min(1, { message: 'Title is required' }),
  description: z.string().optional(),
  status:      z.enum(['OPEN', 'ON_HOLD', 'CLOSED']).optional(),
});

const UpdateMatterSchema = z.object({
  title:       z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  status:      z.enum(['OPEN', 'ON_HOLD', 'CLOSED']).optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const { status, limit = '50', offset = '0' } = req.query;
    const take = Math.min(Number(limit), 100);
    const skip = Number(offset);

    const where: any = {
      organizationId,
      deletedAt: null,
      ...(status && typeof status === 'string' ? { status: status as any } : {}),
    };

    const [matters, total] = await Promise.all([
      prisma.matter.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          owner:        { select: { id: true, firstName: true, lastName: true, email: true } },
          participants: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
          _count:       { select: { contracts: true, documents: true, tasks: true } },
        },
      }),
      prisma.matter.count({ where }),
    ]);

    res.json({ data: matters, total, limit: take, offset: skip });
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
    const matter = await prisma.matter.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        owner:        { select: { id: true, firstName: true, lastName: true, email: true } },
        participants: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
        contracts:    { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, status: true, valueCents: true, currency: true, createdAt: true } },
        documents:    { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, filename: true, mimeType: true, sizeBytes: true, kind: true, createdAt: true } },
        tasks:        { orderBy: { dueAt: 'asc' },  select: { id: true, title: true, dueAt: true, completedAt: true, assigneeId: true } },
      },
    });

    if (!matter) {
      return res.status(404).json({ error: 'Matter not found' });
    }
    res.json(matter);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    const ownerId        = req.user?.id;
    if (!organizationId || !ownerId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const validation = CreateMatterSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    const { title, description, status } = validation.data;
    await checkMatterLimit(organizationId);
    const newMatter = await prisma.matter.create({
      data: { title, description, status, ownerId, organizationId },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    await writeAuditLog({ organizationId, actorId: ownerId, entity: 'Matter', entityId: newMatter.id, action: 'CREATE', after: newMatter, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.status(201).json(newMatter);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const { id } = req.params;
    const validation = UpdateMatterSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    const existing = await prisma.matter.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!existing) {
      return res.status(404).json({ error: 'Matter not found' });
    }

    const updatedMatter = await prisma.matter.update({
      where: { id },
      data:  validation.data,
    });
    await writeAuditLog({ organizationId, actorId: req.user?.id, entity: 'Matter', entityId: id, action: 'UPDATE', before: existing, after: updatedMatter, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json(updatedMatter);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization.' });
    }

    const { id } = req.params;
    const existing = await prisma.matter.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!existing) {
      return res.status(404).json({ error: 'Matter not found' });
    }

    await prisma.matter.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAuditLog({ organizationId, actorId: req.user?.id, entity: 'Matter', entityId: id, action: 'DELETE', before: existing, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
