// apps/api/src/routes/auth.ts
import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../prisma.js';
import { jwt as jwtConfig } from '../config.js';
import { protect } from '../middleware/auth.js';
import type { Prisma } from '@prisma/client';

export const router = Router();

// ---------- helpers ----------
const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- Zod enums mirror your Prisma enums ----------
const RoleEnum = z.enum(['ADMIN', 'LAWYER', 'PARALEGAL', 'CLIENT']);
const OrgRoleEnum = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
type RoleType = z.infer<typeof RoleEnum>;
type OrgRoleType = z.infer<typeof OrgRoleEnum>;

const OrgModeEnum = z.enum(['create', 'join']);

// Convert user input to a safe Role value
const toPrismaRole = (r?: string): RoleType => {
  const u = (r ?? 'CLIENT').toUpperCase();
  return RoleEnum.options.includes(u as RoleType) ? (u as RoleType) : 'CLIENT';
};

// ---------- Schemas ----------
const RegisterSchema = z
  .object({
    email: z.string().email({ message: 'Invalid email address' }),
    password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
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

// ---------- Routes ----------

// POST /api/auth/register
// SPA/XHR: 201 JSON { user, organization, redirectTo: '/login' }
// ?redirect=1 or Accept: text/html => 303 See Other + Location: /login (also returns JSON body)
// ?autoLogin=1 => include JWT token in response JSON
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

    // Ensure user doesn't already exist
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(409).json({ error: 'User already exists' });

    // If creating, check slug availability
    if (orgMode === 'create' && cleanSlug) {
      const existingOrg = await prisma.organization.findUnique({ where: { slug: cleanSlug } });
      if (existingOrg) return res.status(409).json({ error: 'Organization slug already taken' });
    }

    // If joining, ensure org exists
    let orgToJoin: { id: string; name: string; slug: string } | null = null;
    if (orgMode === 'join' && cleanSlug) {
      const found = await prisma.organization.findUnique({
        where: { slug: cleanSlug },
        select: { id: true, name: true, slug: true },
      });
      if (!found) return res.status(404).json({ error: 'Organization not found' });
      orgToJoin = found;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user & membership in a transaction
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          name: fullName,
          role, // RoleType (string union), accepted by Prisma
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
        // orgMode === 'join' — orgToJoin is guaranteed by validation above
        const org = orgToJoin!;
        organization = org;

        await tx.organizationMember.create({
          data: { organizationId: org.id, userId: user.id, role: 'MEMBER' as OrgRoleType },
        });
      }

      return { user, organization };
    });

    // Response behavior
    const wantsRedirect =
      req.query.redirect === '1' || /text\/html/.test(String(req.headers.accept || ''));
    const wantsAutoLogin = req.query.autoLogin === '1';

    let token: string | undefined;
    if (wantsAutoLogin) {
      const tokenPayload = { sub: result.user.id, email: result.user.email, role: result.user.role };
      token = jwt.sign(tokenPayload, jwtConfig.secret, { expiresIn: '1d' });
    }

    if (wantsRedirect) {
      return res
        .status(303) // See Other
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

// POST /api/auth/login
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

    const tokenPayload = { sub: user.id, email: user.email, role: user.role };
    const token = jwt.sign(tokenPayload, jwtConfig.secret, { expiresIn: '1d' });

    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me (protected)
router.get('/me', protect, (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'User not found in request' });
  res.json(req.user);
});

export default router;