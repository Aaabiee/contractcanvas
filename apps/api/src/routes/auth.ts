import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../prisma.js';
import { jwt as jwtConfig } from '../config.js';
import { protect } from '../middleware/auth.js';
import type { Prisma } from '@prisma/client';

export const router = Router();

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const RoleEnum = z.enum(['ADMIN', 'LAWYER', 'PARALEGAL', 'CLIENT']);
const OrgRoleEnum = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
type RoleType = z.infer<typeof RoleEnum>;
type OrgRoleType = z.infer<typeof OrgRoleEnum>;

const OrgModeEnum = z.enum(['create', 'join']);

const toPrismaRole = (r?: string): RoleType => {
  const u = (r ?? 'CLIENT').toUpperCase();
  return RoleEnum.options.includes(u as RoleType) ? (u as RoleType) : 'CLIENT';
};

const RegisterSchema = z
  .object({
    email: z.string().email({ message: 'Invalid email address' }),
    password: z.string()
      .min(8,            { message: 'Password must be at least 8 characters' })
      .regex(/[A-Z]/,    { message: 'Password must contain at least one uppercase letter' })
      .regex(/[a-z]/,    { message: 'Password must contain at least one lowercase letter' })
      .regex(/[0-9]/,    { message: 'Password must contain at least one number' })
      .regex(/[^A-Za-z0-9]/, { message: 'Password must contain at least one special character' }),
    confirmPassword: z.string().min(8, { message: 'Confirm your password' }),
    name: z.object({
      firstName: z.string().trim().min(1, { message: 'First name is required' }),
      lastName: z.string().trim().min(1, { message: 'Last name is required' }),
    }),
    role: RoleEnum.default('CLIENT'),
    orgMode: OrgModeEnum.default('create'),
    organizationName: z.string().min(2).max(120).optional(),
    organizationSlug: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
        message: 'Slug must be lowercase letters, numbers, and hyphens (no leading/trailing hyphen)',
      })
      .min(2)
      .max(50)
      .optional(),
    inviteCode: z.string().optional(),
    acceptTerms: z.boolean().optional(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .superRefine((v, ctx) => {
    if (v.orgMode === 'create') {
      if (!v.organizationName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organizationName'],
          message: 'Organization name is required when creating a new organization',
        });
      }
      if (!v.organizationSlug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organizationSlug'],
          message: 'Organization slug is required when creating a new organization',
        });
      }
      if (v.acceptTerms !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['acceptTerms'],
          message: 'You must accept the terms to create an organization',
        });
      }
    } else if (v.orgMode === 'join') {
      if (!v.organizationSlug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organizationSlug'],
          message: 'Organization slug is required to join an organization',
        });
      }
    }
  });

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const {
      email,
      password,
      name: { firstName, lastName },
      role: roleStr,
      orgMode,
      organizationName,
      organizationSlug,
    } = parsed.data;

    const role = toPrismaRole(roleStr);
    const fullName = `${firstName} ${lastName}`.trim().replace(/\s+/g, ' ');
    const cleanSlug = organizationSlug ? slugify(organizationSlug) : undefined;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(409).json({ error: 'User already exists' });

    if (orgMode === 'create' && cleanSlug) {
      const existingOrg = await prisma.organization.findUnique({ where: { slug: cleanSlug } });
      if (existingOrg) return res.status(409).json({ error: 'Organization slug already taken' });
    }

    let orgToJoin: { id: string; name: string; slug: string } | null = null;
    if (orgMode === 'join' && cleanSlug) {
      const found = await prisma.organization.findUnique({
        where: { slug: cleanSlug },
        select: { id: true, name: true, slug: true },
      });
      if (!found) return res.status(404).json({ error: 'Organization not found' });
      orgToJoin = found;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          name: fullName,
          role,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          name: true,
          role: true,
          createdAt: true,
        },
      });

      let organization: { id: string; name: string; slug: string };
      if (orgMode === 'create') {
        const created = await tx.organization.create({
          data: { name: organizationName!, slug: cleanSlug! },
          select: { id: true, name: true, slug: true },
        });
        organization = created;

        await tx.organizationMember.create({
          data: { organizationId: organization.id, userId: user.id, role: 'OWNER' as OrgRoleType },
        });
      } else {
        const org = orgToJoin!;
        organization = org;

        await tx.organizationMember.create({
          data: { organizationId: org.id, userId: user.id, role: 'MEMBER' as OrgRoleType },
        });
      }

      return { user, organization };
    });

    const wantsRedirect =
      req.query.redirect === '1' || /text\/html/.test(String(req.headers.accept || ''));
    const wantsAutoLogin = req.query.autoLogin === '1';

    let token: string | undefined;
    if (wantsAutoLogin) {
      const organizations = [{ id: result.organization.id, name: result.organization.name, slug: result.organization.slug, role: orgMode === 'create' ? 'OWNER' : 'MEMBER' }];
      const tokenPayload  = { sub: result.user.id, email: result.user.email, role: result.user.role, organizations };
      token = jwt.sign(tokenPayload, jwtConfig.secret, { expiresIn: '1d' });
    }

    if (wantsRedirect) {
      return res
        .status(303)
        .location('/login')
        .json({
          message: 'Registered successfully. Redirecting to login…',
          user: result.user,
          organization: result.organization,
          redirectTo: '/login',
          ...(token ? { token } : {}),
        });
    }

    return res.status(201).json({
      message: 'Registered successfully.',
      user: result.user,
      organization: result.organization,
      redirectTo: '/login',
      ...(token ? { token } : {}),
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : String(err.meta?.target || '');
      if (target.includes('email')) return res.status(409).json({ error: 'User already exists' });
      if (target.includes('slug')) return res.status(409).json({ error: 'Organization slug already taken' });
    }
    next(err);
  }
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: user.id },
      include: { organization: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const organizations = memberships.map(m => ({
      id:   m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
    }));

    const tokenPayload = { sub: user.id, email: user.email, role: user.role, organizations };
    const token = jwt.sign(tokenPayload, jwtConfig.secret, { expiresIn: '1d' });

    res.json({
      token,
      user: {
        id:        user.id,
        email:     user.email,
        firstName: user.firstName,
        lastName:  user.lastName,
        name:      user.name,
        role:      user.role,
      },
      organizations,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', protect, (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'User not found in request' });
  res.json(req.user);
});

router.post('/refresh-token', protect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const memberships = await prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const organizations = memberships.map(m => ({
      id:   m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
    }));

    const tokenPayload = { sub: user.id, email: user.email, role: user.role, organizations };
    const token = jwt.sign(tokenPayload, jwtConfig.secret, { expiresIn: '1d' });

    res.json({ token });
  } catch (err) {
    next(err);
  }
});

export default router;
