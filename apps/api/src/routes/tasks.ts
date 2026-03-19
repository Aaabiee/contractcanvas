import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';

const router = Router();

const CreateTaskSchema = z.object({
  title:       z.string().min(1),
  description: z.string().optional(),
  matterId:    z.string().cuid(),
  assigneeId:  z.string().cuid().optional(),
  dueAt:       z.string().datetime().optional(),
});

const UpdateTaskSchema = z.object({
  title:       z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  assigneeId:  z.string().cuid().optional().nullable(),
  dueAt:       z.string().datetime().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
});

const orgGuard = (req: Request, res: Response): string | null => {
  const id = req.user?.organizationId;
  if (!id) res.status(403).json({ error: 'No active organization. Include X-Organization-Id header.' });
  return id ?? null;
};

// GET /api/tasks?matterId=&assigneeId=&completed=&limit=&offset=
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const { matterId, assigneeId, completed, limit = '50', offset = '0' } = req.query;
    const take = Math.min(Number(limit), 100);
    const skip = Number(offset);

    const where: any = { organizationId };
    if (matterId && typeof matterId === 'string') where.matterId = matterId;
    if (assigneeId && typeof assigneeId === 'string') where.assigneeId = assigneeId;
    if (completed === 'true')  where.completedAt = { not: null };
    if (completed === 'false') where.completedAt = null;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ completedAt: 'asc' }, { dueAt: 'asc' }],
        skip,
        take,
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
          matter:   { select: { id: true, title: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    res.json({ data: tasks, total, limit: take, offset: skip });
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const task = await prisma.task.findFirst({
      where: { id: req.params.id, organizationId },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        matter:   { select: { id: true, title: true } },
      },
    });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    res.json(task);
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const v = CreateTaskSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: 'Invalid input', details: v.error.flatten() });

    const { title, description, matterId, assigneeId, dueAt } = v.data;

    const matter = await prisma.matter.findFirst({ where: { id: matterId, organizationId, deletedAt: null } });
    if (!matter) return res.status(404).json({ error: 'Matter not found' });

    const task = await prisma.task.create({
      data: {
        title,
        description,
        matterId,
        organizationId,
        assigneeId,
        dueAt: dueAt ? new Date(dueAt) : null,
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        matter:   { select: { id: true, title: true } },
      },
    });

    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tasks/:id
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const v = UpdateTaskSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: 'Invalid input', details: v.error.flatten() });

    const existing = await prisma.task.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const { dueAt, completedAt, ...rest } = v.data;
    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(dueAt !== undefined     ? { dueAt:      dueAt      ? new Date(dueAt)      : null } : {}),
        ...(completedAt !== undefined ? { completedAt: completedAt ? new Date(completedAt) : null } : {}),
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        matter:   { select: { id: true, title: true } },
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = orgGuard(req, res);
    if (!organizationId) return;

    const existing = await prisma.task.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    await prisma.task.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
