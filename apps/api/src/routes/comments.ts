import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';

const router = Router();

const CreateCommentSchema = z
  .object({
    bodyMd:            z.string().min(1),
    matterId:          z.string().cuid().optional(),
    contractId:        z.string().cuid().optional(),
    contractVersionId: z.string().cuid().optional(),
    documentId:        z.string().cuid().optional(),
  })
  .refine(
    d => d.matterId || d.contractId || d.contractVersionId || d.documentId,
    { message: 'One of matterId, contractId, contractVersionId, or documentId is required' }
  );

const UpdateCommentSchema = z.object({
  bodyMd: z.string().min(1),
});

const orgGuard = (req: Request, res: Response): string | null => {
  const id = req.user?.organizationId;
  if (!id) res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
  return id ?? null;
};

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const { matterId, contractId, documentId, contractVersionId, limit = '50', offset = '0' } = req.query;
    const take = Math.min(Number(limit), 100);
    const skip = Number(offset);

    const where: any = { organizationId };
    if (matterId          && typeof matterId          === 'string') where.matterId          = matterId;
    if (contractId        && typeof contractId        === 'string') where.contractId        = contractId;
    if (documentId        && typeof documentId        === 'string') where.documentId        = documentId;
    if (contractVersionId && typeof contractVersionId === 'string') where.contractVersionId = contractVersionId;

    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take,
        include: {
          author: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.comment.count({ where }),
    ]);

    res.json({ data: comments, total, limit: take, offset: skip });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const authorId = req.user!.id;
    const v = CreateCommentSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: 'Invalid input', details: v.error.flatten() });

    const comment = await prisma.comment.create({
      data: {
        organizationId,
        bodyMd:            v.data.bodyMd,
        authorId,
        matterId:          v.data.matterId,
        contractId:        v.data.contractId,
        contractVersionId: v.data.contractVersionId,
        documentId:        v.data.documentId,
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const authorId = req.user!.id;
    const v = UpdateCommentSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: 'Invalid input', details: v.error.flatten() });

    const existing = await prisma.comment.findFirst({ where: { id: req.params.id, authorId, organizationId } });
    if (!existing) return res.status(404).json({ error: 'Comment not found or not yours' });

    const updated = await prisma.comment.update({
      where: { id: req.params.id },
      data:  { bodyMd: v.data.bodyMd, editedAt: new Date() },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const authorId = req.user!.id;
    const existing = await prisma.comment.findFirst({ where: { id: req.params.id, authorId, organizationId } });
    if (!existing) return res.status(404).json({ error: 'Comment not found or not yours' });

    await prisma.comment.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
