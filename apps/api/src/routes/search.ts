import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';

const router = Router();
export default router;

const QuerySchema = z.object({
  q:     z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
    }

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const { q, limit } = parsed.data;
    const mode = 'insensitive' as const;

    const [matters, contracts, documents] = await Promise.all([
      prisma.matter.findMany({
        where: {
          organizationId,
          deletedAt: null,
          OR: [
            { title:       { contains: q, mode } },
            { description: { contains: q, mode } },
          ],
        },
        select: { id: true, title: true, description: true, status: true, createdAt: true },
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),

      prisma.contract.findMany({
        where: {
          organizationId,
          deletedAt: null,
          title: { contains: q, mode },
        },
        select: { id: true, title: true, status: true, matterId: true, createdAt: true },
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),

      prisma.document.findMany({
        where: {
          organizationId,
          deletedAt: null,
          filename: { contains: q, mode },
        },
        select: { id: true, filename: true, mimeType: true, matterId: true, versionId: true, createdAt: true },
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const total = matters.length + contracts.length + documents.length;

    res.json({ q, total, matters, contracts, documents });
  } catch (err) {
    next(err);
  }
});
