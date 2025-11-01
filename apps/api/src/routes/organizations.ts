// apps/api/src/routes/organizations.ts
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../prisma.js';

// Bring in the Prisma namespace for types (TransactionClient, etc.)
import { Prisma } from '@prisma/client';
// Import the runtime error class for instanceof checks
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export const router = Router();

/**
 * Use a stable string-union for roles so we don't depend on generated enum exports.
 * If your schema defines a native enum, these values should match it.
 */
const ORG_ROLE_VALUES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
type OrgRole = typeof ORG_ROLE_VALUES[number];

// --- Zod Schemas ---
const CreateOrgSchema = z.object({
  name: z.string().min(1, { message: 'Organization name is required' }),
  slug: z
    .string()
    .min(3, { message: 'Slug must be at least 3 characters' })
    .regex(/^[a-z0-9-]+$/, {
      message: 'Slug must be lowercase alphanumeric with hyphens',
    }),
});

const AddMemberSchema = z.object({
  userId: z.string().cuid({ message: 'Valid user ID required' }),
  role: z.enum(ORG_ROLE_VALUES).default('MEMBER'),
});

const UpdateMemberSchema = z.object({
  role: z.enum(ORG_ROLE_VALUES),
});

// --- Routes ---

// POST /api/organizations (Create a new organization)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Auth check - req.user is typed via your express augmentation
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validation = CreateOrgSchema.safeParse(req.body);
    if (!validation.success) {
      return res
        .status(400)
        .json({ error: 'Invalid input', details: validation.error.flatten() });
    }
    const { name, slug } = validation.data;

    // Let the DB uniqueness enforce the slug; Prisma will throw on conflict (P2002)
    const organization = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newOrg = await tx.organization.create({
        data: { name, slug },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: newOrg.id,
          userId,
          role: 'OWNER' as OrgRole,
        },
      });

      return newOrg;
    });

    res.status(201).json(organization);
  } catch (error: unknown) {
    // Handle Prisma unique constraint errors (like slug already taken)
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target;
      const targets = Array.isArray(target) ? (target as string[]) : [];
      if (targets.includes('slug')) {
        return res.status(409).json({ error: 'Slug already taken' });
      }
      return res.status(409).json({ error: 'Unique constraint violation' });
    }
    next(error); // Pass other errors to your central handler
  }
});

// GET /api/organizations/me (List orgs the current user is a member of)
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const memberships = await prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: {
          select: { id: true, name: true, slug: true, deletedAt: true },
        },
      },
      orderBy: { organization: { name: 'asc' } },
    });

    const activeMemberships = memberships.filter(
      (m: typeof memberships[number]) => m.organization.deletedAt === null
    );

    type MembershipWithOrgDetails = (typeof activeMemberships)[number];

    const organizations = activeMemberships.map(
      (m: MembershipWithOrgDetails) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        userRole: m.role as OrgRole,
      })
    );

    res.json(organizations);
  } catch (error: unknown) {
    next(error);
  }
});

// GET /api/organizations/:orgId/members (List members of a specific org)
router.get(
  '/:orgId/members',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { orgId } = req.params;

      // verify the requester is a member
      const requestingUserMembership = await prisma.organizationMember.findUnique(
        {
          where: {
            organizationId_userId: { organizationId: orgId, userId: req.user.id },
          },
          select: { role: true },
        }
      );
      if (!requestingUserMembership) {
        return res.status(403).json({
          error: 'Forbidden: You are not a member of this organization',
        });
      }

      const members = await prisma.organizationMember.findMany({
        where: { organizationId: orgId },
        include: {
          user: {
            select: { id: true, email: true, name: true, avatarUrl: true },
          },
        },
        orderBy: { user: { name: 'asc' } },
      });

      res.json(members);
    } catch (error: unknown) {
      next(error);
    }
  }
);

// POST /api/organizations/:orgId/members (Add a member to an org)
router.post(
  '/:orgId/members',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { orgId } = req.params;

      // Only OWNER/ADMIN can invite
      const inviterMembership = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: { organizationId: orgId, userId: req.user.id },
        },
        select: { role: true },
      });
      if (!inviterMembership || !['OWNER', 'ADMIN'].includes(inviterMembership.role)) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Only owners or admins can add members' });
      }

      const validation = AddMemberSchema.safeParse(req.body);
      if (!validation.success) {
        return res
          .status(400)
          .json({ error: 'Invalid input', details: validation.error.flatten() });
      }
      const { userId, role } = validation.data;

      // Ensure user to be added exists
      const userExists = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!userExists) {
        return res.status(404).json({ error: 'User to be added not found' });
      }

      const newMember = await prisma.organizationMember.create({
        data: {
          organizationId: orgId,
          userId,
          role: role as OrgRole,
        },
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      });

      res.status(201).json(newMember);
    } catch (error: unknown) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return res
            .status(409)
            .json({ error: 'User is already a member of this organization' });
        }
        if (error.code === 'P2003') {
          return res
            .status(404)
            .json({ error: 'User or Organization not found' });
        }
      }
      next(error);
    }
  }
);

// PATCH /api/organizations/:orgId/members/:memberId (Update member role)
router.patch(
  '/:orgId/members/:memberId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { orgId, memberId } = req.params;

      // Only OWNER/ADMIN can update roles
      const updaterMembership = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: { organizationId: orgId, userId: req.user.id },
        },
        select: { role: true },
      });
      if (!updaterMembership || !['OWNER', 'ADMIN'].includes(updaterMembership.role)) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Only owners or admins can update members' });
      }

      const validation = UpdateMemberSchema.safeParse(req.body);
      if (!validation.success) {
        return res
          .status(400)
          .json({ error: 'Invalid input', details: validation.error.flatten() });
      }
      const { role } = validation.data;

      const updatedMember = await prisma.organizationMember.update({
        where: { id: memberId },
        data: { role: role as OrgRole },
        include: { user: { select: { id: true, email: true, name: true } } },
      });

      res.json(updatedMember);
    } catch (error: unknown) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        return res
          .status(404)
          .json({ error: 'Member not found in this organization' });
      }
      next(error);
    }
  }
);

// DELETE /api/organizations/:orgId/members/:memberId (Remove member)
router.delete(
  '/:orgId/members/:memberId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const { orgId, memberId } = req.params;
      const removerUserId = req.user.id;

      const memberToRemove = await prisma.organizationMember.findUnique({
        where: { id: memberId },
      });
      if (!memberToRemove || memberToRemove.organizationId !== orgId) {
        return res
          .status(404)
          .json({ error: 'Member not found in this organization' });
      }

      const removerMembership = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: { organizationId: orgId, userId: removerUserId },
        },
        select: { role: true },
      });

      const isSelf = memberToRemove.userId === removerUserId;
      const canAdmin =
        removerMembership && ['OWNER', 'ADMIN'].includes(removerMembership.role);

      if (!isSelf && !canAdmin) {
        return res.status(403).json({
          error: 'Forbidden: Insufficient permissions to remove member',
        });
      }

      await prisma.organizationMember.delete({
        where: { id: memberId },
      });

      res.status(204).send();
    } catch (error: unknown) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        return res.status(404).json({ error: 'Member not found' });
      }
      next(error);
    }
  }
);

export default router;
