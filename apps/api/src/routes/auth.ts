import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { z } from 'zod';
import prisma from '../prisma.js';
import { jwt as jwtConfig } from '../config.js';
import { protect, requireEmailVerified } from '../middleware/auth.js';
import { blacklistToken } from '../lib/redis.js';
import {
  createSession,
  rotateSession,
  deleteSession,
  revokeAllUserSessions,
  REFRESH_COOKIE,
  REFRESH_COOKIE_OPTS,
} from '../lib/session.js';
import { checkLoginAllowed, recordFailedAttempt, clearFailedAttempts } from '../lib/login-guard.js';
import { sendEmail, type SendEmailOpts } from '../services/email.service.js';
import { emailQueue } from '../queues/index.js';

async function enqueueEmail(opts: SendEmailOpts): Promise<void> {
  if (emailQueue) {
    await emailQueue.add('send', opts);
  } else {
    await sendEmail(opts);
  }
}
import type { Prisma } from '@prisma/client';

export const router = Router();

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const RoleEnum    = z.enum(['ADMIN', 'LAWYER', 'PARALEGAL', 'CLIENT']);
const OrgRoleEnum = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
type RoleType    = z.infer<typeof RoleEnum>;
type OrgRoleType = z.infer<typeof OrgRoleEnum>;

const toPrismaRole = (r?: string): RoleType => {
  const u = (r ?? 'CLIENT').toUpperCase();
  return RoleEnum.options.includes(u as RoleType) ? (u as RoleType) : 'CLIENT';
};

type KnownUser = { id: string; email: string; role: any; emailVerifiedAt?: Date | null };

async function buildTokenPayload(userId: string, knownUser?: KnownUser) {
  const [user, memberships] = await Promise.all([
    knownUser
      ? Promise.resolve(knownUser)
      : prisma.user.findUniqueOrThrow({
          where:  { id: userId },
          select: { id: true, email: true, role: true, emailVerifiedAt: true },
        }),
    prisma.organizationMember.findMany({
      where:   { userId },
      include: { organization: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const organizations = memberships.map(m => ({
    id:   m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    role: m.role,
  }));

  const emailVerified = !!(user as any).emailVerifiedAt;

  return { sub: user.id, email: user.email, role: user.role, emailVerified, organizations };
}

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function signAccessToken(payload: object): string {
  const jti = crypto.randomBytes(16).toString('hex');
  return jwt.sign({ ...payload, jti }, jwtConfig.secret, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

function setRefreshCookie(res: Response, raw: string): void {
  res.cookie(REFRESH_COOKIE, raw, REFRESH_COOKIE_OPTS);
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...REFRESH_COOKIE_OPTS, maxAge: 0 });
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

const OrgModeEnum = z.enum(['create', 'join']);

const RegisterSchema = z
  .object({
    email: z.string().email({ message: 'Invalid email address' }),
    password: z.string()
      .min(8,                { message: 'Password must be at least 8 characters' })
      .regex(/[A-Z]/,        { message: 'Password must contain at least one uppercase letter' })
      .regex(/[a-z]/,        { message: 'Password must contain at least one lowercase letter' })
      .regex(/[0-9]/,        { message: 'Password must contain at least one number' })
      .regex(/[^A-Za-z0-9]/, { message: 'Password must contain at least one special character' }),
    confirmPassword: z.string().min(8, { message: 'Confirm your password' }),
    name: z.object({
      firstName: z.string().trim().min(1, { message: 'First name is required' }),
      lastName:  z.string().trim().min(1, { message: 'Last name is required' }),
    }),
    role:             RoleEnum.default('CLIENT'),
    orgMode:          OrgModeEnum.default('create'),
    organizationName: z.string().min(2).max(120).optional(),
    organizationSlug: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
        message: 'Slug must be lowercase letters, numbers, and hyphens (no leading/trailing hyphen)',
      })
      .min(2)
      .max(50)
      .optional(),
    inviteCode:  z.string().optional(),
    acceptTerms: z.boolean().optional(),
  })
  .refine(v => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path:    ['confirmPassword'],
  })
  .superRefine((v, ctx) => {
    if (v.orgMode === 'create') {
      if (!v.organizationName) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['organizationName'], message: 'Organization name is required when creating a new organization' });
      }
      if (!v.organizationSlug) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['organizationSlug'], message: 'Organization slug is required when creating a new organization' });
      }
      if (v.acceptTerms !== true) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['acceptTerms'], message: 'You must accept the terms to create an organization' });
      }
    } else if (v.orgMode === 'join') {
      if (!v.organizationSlug) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['organizationSlug'], message: 'Organization slug is required to join an organization' });
      }
    }
  });

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string()
    .min(12,               { message: 'New password must be at least 12 characters' })
    .regex(/[A-Z]/,        { message: 'New password must contain at least one uppercase letter' })
    .regex(/[a-z]/,        { message: 'New password must contain at least one lowercase letter' })
    .regex(/[0-9]/,        { message: 'New password must contain at least one number' })
    .regex(/[^A-Za-z0-9]/, { message: 'New password must contain at least one special character' }),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string()
    .min(12,               { message: 'Password must be at least 12 characters' })
    .regex(/[A-Z]/,        { message: 'Password must contain at least one uppercase letter' })
    .regex(/[a-z]/,        { message: 'Password must contain at least one lowercase letter' })
    .regex(/[0-9]/,        { message: 'Password must contain at least one number' })
    .regex(/[^A-Za-z0-9]/, { message: 'Password must contain at least one special character' }),
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

async function sendVerificationEmail(email: string, firstName: string, rawToken: string) {
  const safeName = escapeHtml(firstName);
  const link = `${process.env.FRONTEND_URL ?? 'http://localhost:4200'}/verify-email?token=${encodeURIComponent(rawToken)}`;
  await enqueueEmail({
    to:       email,
    subject:  'Verify your ContractCanvas email',
    htmlBody: `<p>Hi ${safeName},</p><p>Click the link below to verify your email address. This link expires in 24 hours.</p><p><a href="${link}">${link}</a></p>`,
    textBody: `Hi ${firstName},\n\nVerify your email: ${link}\n\nThis link expires in 24 hours.`,
  });
}

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

    const role      = toPrismaRole(roleStr);
    const fullName  = `${firstName} ${lastName}`.trim().replace(/\s+/g, ' ');
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
        where:  { slug: cleanSlug },
        select: { id: true, name: true, slug: true },
      });
      if (!found) return res.status(404).json({ error: 'Organization not found' });
      orgToJoin = found;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const rawVerifyToken   = generateToken();
    const hashedVerifyToken = hashToken(rawVerifyToken);
    const verifyTokenExp    = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          name: fullName,
          role,
          verifyToken:    hashedVerifyToken,
          verifyTokenExp,
        },
        select: { id: true, email: true, firstName: true, lastName: true, name: true, role: true, createdAt: true },
      });

      let organization: { id: string; name: string; slug: string };
      if (orgMode === 'create') {
        const created = await tx.organization.create({
          data:   { name: organizationName!, slug: cleanSlug! },
          select: { id: true, name: true, slug: true },
        });
        organization = created;
        await tx.organizationMember.create({
          data: { organizationId: organization.id, userId: user.id, role: 'OWNER' as OrgRoleType },
        });
      } else {
        organization = orgToJoin!;
        await tx.organizationMember.create({
          data: { organizationId: orgToJoin!.id, userId: user.id, role: 'MEMBER' as OrgRoleType },
        });
      }

      if (orgMode === 'create') {
        await tx.subscription.create({
          data: {
            organizationId: organization.id,
            tier:           'STARTER',
            status:         'trialing',
            trialEndsAt:    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        });
      }

      return { user, organization };
    });

    await sendVerificationEmail(result.user.email, result.user.firstName, rawVerifyToken);

    const wantsRedirect  = req.query.redirect === '1' || /text\/html/.test(String(req.headers.accept || ''));
    const wantsAutoLogin = req.query.autoLogin === '1';

    let token: string | undefined;
    if (wantsAutoLogin) {
      const payload = await buildTokenPayload(
        result.user.id,
        { id: result.user.id, email: result.user.email, role: result.user.role },
      );
      token = signAccessToken(payload);

      const rawRefresh = await createSession(result.user.id, req.ip, req.headers['user-agent']);
      setRefreshCookie(res, rawRefresh);
    }

    if (wantsRedirect) {
      return res.status(303).location('/login').json({
        message:      'Registered successfully. Redirecting to login…',
        user:         result.user,
        organization: result.organization,
        redirectTo:   '/login',
        ...(token ? { token } : {}),
      });
    }

    return res.status(201).json({
      message:      'Registered successfully. Please verify your email.',
      user:         result.user,
      organization: result.organization,
      redirectTo:   '/login',
      ...(token ? { token } : {}),
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : String(err.meta?.target || '');
      if (target.includes('email')) return res.status(409).json({ error: 'User already exists' });
      if (target.includes('slug'))  return res.status(409).json({ error: 'Organization slug already taken' });
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

    const guard = await checkLoginAllowed(email);
    if (!guard.allowed) {
      return res.status(429).json({
        error: 'account_locked',
        message: `Too many failed attempts. Try again in ${guard.retryAfterSeconds} seconds.`,
        retryAfterSeconds: guard.retryAfterSeconds,
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      await recordFailedAttempt(email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await clearFailedAttempts(email);

    const payload = await buildTokenPayload(user.id, { id: user.id, email: user.email, role: user.role, emailVerifiedAt: user.emailVerifiedAt });
    const token   = signAccessToken(payload);

    const rawRefresh = await createSession(user.id, req.ip, req.headers['user-agent']);
    setRefreshCookie(res, rawRefresh);

    res.json({
      token,
      user: {
        id:             user.id,
        email:          user.email,
        firstName:      user.firstName,
        lastName:       user.lastName,
        name:           user.name,
        role:           user.role,
        emailVerified:  !!user.emailVerifiedAt,
      },
      organizations: payload.organizations,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh-token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (!rawToken || typeof rawToken !== 'string') {
      return res.status(401).json({ error: 'No refresh token' });
    }

    const rotated = await rotateSession(rawToken, req.ip, req.headers['user-agent']);
    if (!rotated) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh token invalid or expired' });
    }

    const payload = await buildTokenPayload(rotated.userId);
    const token   = signAccessToken(payload);

    setRefreshCookie(res, rotated.newRaw);
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = req.header('Authorization');
    if (bearer?.startsWith('Bearer ')) {
      const token = bearer.slice(7);
      try {
        const decoded = jwt.decode(token) as Record<string, unknown> | null;
        if (decoded?.jti && typeof decoded.exp === 'number') {
          const ttl = decoded.exp - Math.floor(Date.now() / 1000);
          await blacklistToken(decoded.jti as string, ttl);
        }
      } catch { /* malformed token — ignore */ }
    }
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (rawToken) await deleteSession(rawToken);
    clearRefreshCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', protect, (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'User not found in request' });
  res.json(req.user);
});

router.post('/change-password', protect, requireEmailVerified, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const userId = req.user!.id;
    const user   = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
    ]);

    await revokeAllUserSessions(userId);
    clearRefreshCookie(res);

    res.json({ ok: true, message: 'Password changed. Please log in again.' });
  } catch (err) {
    next(err);
  }
});

router.get('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawToken = typeof req.query.token === 'string' ? req.query.token : '';
    if (!rawToken) {
      return res.status(400).json({ error: 'Missing verification token' });
    }

    const hashed = hashToken(rawToken);
    const user = await prisma.user.findUnique({
      where: { verifyToken: hashed },
      select: { id: true, email: true, role: true, verifyTokenExp: true, emailVerifiedAt: true },
    });

    if (!user || !user.verifyTokenExp || user.verifyTokenExp < new Date()) {
      return res.status(400).json({ error: 'Verification token is invalid or expired' });
    }

    if (user.emailVerifiedAt) {
      return res.status(200).json({ ok: true, message: 'Email already verified' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data:  { emailVerifiedAt: new Date(), verifyToken: null, verifyTokenExp: null },
    });

    const payload = await buildTokenPayload(user.id, { id: user.id, email: user.email, role: user.role });
    const token   = signAccessToken(payload);

    res.json({ ok: true, token });
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const user = await prisma.user.findUnique({
      where:  { email: parsed.data.email },
      select: { id: true, email: true, firstName: true, emailVerifiedAt: true, verifyTokenExp: true },
    });

    if (!user || user.emailVerifiedAt) {
      return res.status(200).json({ ok: true });
    }

    const lastSent = user.verifyTokenExp
      ? user.verifyTokenExp.getTime() - 24 * 60 * 60 * 1000
      : 0;
    const hoursSinceLast = (Date.now() - lastSent) / (60 * 60 * 1000);
    if (hoursSinceLast < 8) {
      return res.status(429).json({ error: 'Please wait before requesting another verification email' });
    }

    const rawToken      = generateToken();
    const hashedToken   = hashToken(rawToken);
    const verifyTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data:  { verifyToken: hashedToken, verifyTokenExp },
    });

    await sendVerificationEmail(user.email, user.firstName, rawToken);

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ForgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const user = await prisma.user.findUnique({
      where:  { email: parsed.data.email },
      select: { id: true, email: true, firstName: true },
    });

    if (user) {
      const rawToken     = generateToken();
      const hashedToken  = hashToken(rawToken);
      const resetTokenExp = new Date(Date.now() + 60 * 60 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data:  { resetToken: hashedToken, resetTokenExp },
      });

      const safeName = escapeHtml(user.firstName);
      const link = `${process.env.FRONTEND_URL ?? 'http://localhost:4200'}/reset-password?token=${encodeURIComponent(rawToken)}`;
      await enqueueEmail({
        to:       user.email,
        subject:  'Reset your ContractCanvas password',
        htmlBody: `<p>Hi ${safeName},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you did not request a password reset, you can ignore this email.</p>`,
        textBody: `Hi ${user.firstName},\n\nReset your password: ${link}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
      });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const { token, newPassword } = parsed.data;
    const hashed = hashToken(token);

    const user = await prisma.user.findUnique({
      where:  { resetToken: hashed },
      select: { id: true, resetTokenExp: true },
    });

    if (!user || !user.resetTokenExp || user.resetTokenExp < new Date()) {
      return res.status(400).json({ error: 'Password reset token is invalid or expired' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data:  { passwordHash: newHash, resetToken: null, resetTokenExp: null },
    });

    await revokeAllUserSessions(user.id);

    res.json({ ok: true, message: 'Password reset successfully. Please log in.' });
  } catch (err) {
    next(err);
  }
});

export default router;
