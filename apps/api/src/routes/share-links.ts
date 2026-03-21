import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import prisma from '../prisma.js';
import { protect } from '../middleware/auth.js';

export const router = Router();

const RESOURCE_TYPES = ['contract', 'matter', 'document'] as const;
type ResourceType = typeof RESOURCE_TYPES[number];

const CreateShareLinkSchema = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  resourceId:   z.string().cuid(),
  role:         z.enum(['viewer', 'commenter', 'editor']).default('viewer'),
  expiresAt:    z.string().datetime().optional(),
});

router.get('/', protect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const { resourceType, resourceId, limit = '50', offset = '0' } = req.query;
    const take = Math.min(Number(limit), 100);
    const skip = Number(offset);

    const where: any = { organizationId };
    if (resourceType) where.resourceType = resourceType;
    if (resourceId)   where.resourceId   = resourceId;

    const [data, total] = await prisma.$transaction([
      prisma.shareLink.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      prisma.shareLink.count({ where }),
    ]);

    res.json({ data, total, limit: take, offset: skip });
  } catch (err) {
    next(err);
  }
});

router.post('/', protect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const parsed = CreateShareLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const { resourceType, resourceId, role, expiresAt } = parsed.data;

    const exists = await verifyResourceBelongsToOrg(resourceType, resourceId, organizationId);
    if (!exists) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    const token = crypto.randomBytes(20).toString('hex');

    const link = await prisma.shareLink.create({
      data: {
        organizationId,
        resourceType,
        resourceId,
        token,
        role,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    res.status(201).json(link);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', protect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const existing = await prisma.shareLink.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    await prisma.shareLink.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export const shareTokenRouter = Router();

shareTokenRouter.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const link = await prisma.shareLink.findUnique({
      where: { token: req.params.token },
    });

    if (!link) {
      return res.status(404).json({ error: 'Share link not found or has expired' });
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    const resource = await fetchResource(link.resourceType as ResourceType, link.resourceId);
    if (!resource) {
      return res.status(404).json({ error: 'Resource no longer exists' });
    }

    res.json({
      resourceType: link.resourceType,
      resourceId:   link.resourceId,
      role:         link.role,
      expiresAt:    link.expiresAt,
      resource,
    });
  } catch (err) {
    next(err);
  }
});

async function verifyResourceBelongsToOrg(
  type: ResourceType,
  id: string,
  organizationId: string,
): Promise<boolean> {
  switch (type) {
    case 'contract':
      return !!(await prisma.contract.findFirst({ where: { id, organizationId, deletedAt: null } }));
    case 'matter':
      return !!(await prisma.matter.findFirst({ where: { id, organizationId, deletedAt: null } }));
    case 'document':
      return !!(await prisma.document.findFirst({ where: { id, organizationId, deletedAt: null } }));
  }
}

async function fetchResource(type: ResourceType, id: string): Promise<object | null> {
  switch (type) {
    case 'contract':
      return prisma.contract.findFirst({
        where:  { id, deletedAt: null },
        select: { id: true, title: true, status: true, createdAt: true },
      });
    case 'matter':
      return prisma.matter.findFirst({
        where:  { id, deletedAt: null },
        select: { id: true, title: true, status: true, createdAt: true },
      });
    case 'document':
      return prisma.document.findFirst({
        where:  { id, deletedAt: null },
        select: { id: true, filename: true, mimeType: true, createdAt: true },
      });
  }
}
