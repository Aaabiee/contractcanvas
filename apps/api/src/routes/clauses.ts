import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';

const router = Router();

const ClauseSchema = z.object({
  title:    z.string().min(1),
  bodyMd:   z.string().min(1),
  tags:     z.array(z.string()).optional().default([]),
  isPublic: z.boolean().optional().default(false),
});

const orgGuard = (req: Request, res: Response): string | null => {
  const id = req.user?.organizationId;
  if (!id) res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
  return id ?? null;
};

// GET /api/clauses?q=&limit=&offset=
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const { q, limit = '50', offset = '0' } = req.query;
    const take = Math.min(Number(limit), 100);
    const skip = Number(offset);

    const baseWhere: any = { OR: [{ organizationId }, { isPublic: true }] };
    const where = q && typeof q === 'string'
      ? {
          AND: [
            baseWhere,
            { OR: [
              { title:  { contains: q, mode: 'insensitive' as const } },
              { bodyMd: { contains: q, mode: 'insensitive' as const } },
            ]},
          ],
        }
      : baseWhere;

    const [clauses, total] = await Promise.all([
      prisma.clause.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.clause.count({ where }),
    ]);

    res.json({ data: clauses, total, limit: take, offset: skip });
  } catch (error) {
    next(error);
  }
});

// GET /api/clauses/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const clause = await prisma.clause.findFirst({
      where: { id: req.params.id, OR: [{ organizationId }, { isPublic: true }] },
    });
    if (!clause) return res.status(404).json({ error: 'Clause not found' });

    res.json(clause);
  } catch (error) {
    next(error);
  }
});

// POST /api/clauses
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const v = ClauseSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: 'Invalid input', details: v.error.flatten() });

    const clause = await prisma.clause.create({
      data: { ...v.data, organizationId },
    });
    res.status(201).json(clause);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/clauses/:id
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const existing = await prisma.clause.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) return res.status(404).json({ error: 'Clause not found' });

    const v = ClauseSchema.partial().safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: 'Invalid input', details: v.error.flatten() });

    const updated = await prisma.clause.update({ where: { id: req.params.id }, data: v.data });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/clauses/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const existing = await prisma.clause.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) return res.status(404).json({ error: 'Clause not found' });

    await prisma.clause.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
