import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';
import { writeAuditLog } from '../lib/audit.js';

export const router = Router();

const UpdateMeSchema = z.object({
  firstName: z.string().optional(),
  lastName:  z.string().optional(),
  avatarUrl: z.string().optional(),
});

const OnboardingStepValues = ['VERIFY_EMAIL', 'CUSTOMIZE_ORG', 'CREATE_MATTER', 'INVITE_MEMBER', 'UPLOAD_DOCUMENT', 'DONE'] as const;
const OnboardingSchema = z.object({
  step: z.enum(OnboardingStepValues),
});

router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: {
        id:              true,
        email:           true,
        firstName:       true,
        lastName:        true,
        role:            true,
        emailVerifiedAt: true,
        tosAcceptedAt:   true,
        onboardingStep:  true,
        createdAt:       true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.patch('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const validation = UpdateMeSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data:  validation.data,
      select: {
        id:              true,
        email:           true,
        firstName:       true,
        lastName:        true,
        role:            true,
        emailVerifiedAt: true,
        tosAcceptedAt:   true,
        createdAt:       true,
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.patch('/me/onboarding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const validation = OnboardingSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
    }

    const updated = await prisma.user.update({
      where:  { id: userId },
      data:   { onboardingStep: validation.data.step },
      select: { id: true, onboardingStep: true },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post('/me/data-export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const [user, memberships, matters, comments, notifications, tasks] = await Promise.all([
      prisma.user.findUnique({
        where:  { id: userId },
        select: {
          id:              true,
          email:           true,
          firstName:       true,
          lastName:        true,
          role:            true,
          emailVerifiedAt: true,
          tosAcceptedAt:   true,
          createdAt:       true,
          updatedAt:       true,
        },
      }),
      prisma.organizationMember.findMany({
        where:   { userId },
        include: { organization: { select: { name: true } } },
      }),
      prisma.matter.findMany({
        where: { ownerId: userId, deletedAt: null },
      }),
      prisma.comment.findMany({
        where:   { authorId: userId },
        orderBy: { createdAt: 'desc' },
        take:    100,
      }),
      prisma.notification.findMany({
        where:   { userId },
        orderBy: { createdAt: 'desc' },
        take:    100,
      }),
      prisma.task.findMany({
        where:   { assigneeId: userId },
        orderBy: { createdAt: 'desc' },
        take:    50,
      }),
    ]);

    if (organizationId) {
      await writeAuditLog({
        organizationId,
        actorId:  userId,
        entity:   'User',
        entityId: userId,
        action:   'DATA_EXPORT',
        ip:       req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="data-export-${userId}.json"`);
    res.json({ user, memberships, matters, comments, notifications, tasks });
  } catch (error) {
    next(error);
  }
});

router.delete('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (req.body?.confirm !== 'DELETE MY ACCOUNT') {
      return res.status(400).json({ error: 'Confirmation required. Send { "confirm": "DELETE MY ACCOUNT" } in the request body.' });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data:  {
          email:        `deleted_${userId}@redacted.invalid`,
          firstName:    'Deleted',
          lastName:     'User',
          passwordHash: '',
          avatarUrl:    null,
          verifyToken:  null,
          resetToken:   null,
          deletedAt:    new Date(),
        },
      }),
      prisma.session.updateMany({
        where: { userId },
        data:  { revokedAt: new Date() },
      }),
      prisma.organizationMember.deleteMany({ where: { userId } }),
    ]);

    if (organizationId) {
      await writeAuditLog({
        organizationId,
        actorId:  userId,
        entity:   'User',
        entityId: userId,
        action:   'ACCOUNT_DELETED',
        ip:       req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
