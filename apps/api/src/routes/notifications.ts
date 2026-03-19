import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../prisma.js';

const router = Router();

// GET /api/notifications?unread=true&limit=&offset=
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { unread, limit = '50', offset = '0' } = req.query;
    const take = Math.min(Number(limit), 100);
    const skip = Number(offset);

    const where: any = { userId };
    if (unread === 'true') where.readAt = null;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.notification.count({ where }),
    ]);

    const unreadCount = await prisma.notification.count({ where: { userId, readAt: null } });

    res.json({ data: notifications, total, unreadCount, limit: take, offset: skip });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/notifications/read-all — must come before /:id route
router.patch('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { count } = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data:  { readAt: new Date() },
    });
    res.json({ ok: true, updated: count });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const existing = await prisma.notification.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) return res.status(404).json({ error: 'Notification not found' });

    const updated = await prisma.notification.update({
      where: { id: req.params.id },
      data:  { readAt: new Date() },
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
