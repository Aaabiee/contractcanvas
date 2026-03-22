/**
 * Live integration tests for POST /api/auth/register, /login, and GET /me.
 *
 * These tests run against a real PostgreSQL container (started by
 * src/__tests__/integration/setup.ts) — no Prisma mocks, no bcrypt stubs.
 * The DATABASE_URL and JWT_SECRET env vars are injected by the global setup
 * and inherited by this worker process.
 */

import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { router as authRouter } from '../../routes/auth.js';

// Direct PrismaClient using the live test database URL set by global setup
const db = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});

function buildApp(opts?: { cookies?: boolean }): Express {
  const app = express();
  app.use(express.json());
  if (opts?.cookies) app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

const validPayload = {
  email: 'alice@example.com',
  password: 'Password1!',
  confirmPassword: 'Password1!',
  name: { firstName: 'Alice', lastName: 'Smith' },
  role: 'LAWYER',
  orgMode: 'create',
  organizationName: 'Smith & Associates',
  organizationSlug: 'smith-associates',
  acceptTerms: true,
};

// ─── cleanup ────────────────────────────────────────────────────────────────
afterEach(async () => {
  await db.session.deleteMany();
  await db.subscription.deleteMany();
  await db.organizationMember.deleteMany();
  await db.organization.deleteMany();
  await db.user.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

// ─── POST /register ──────────────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('returns 201 and creates user + org + membership in the database', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('alice@example.com');
    expect(res.body.organization.slug).toBe('smith-associates');

    // Verify real DB state
    const user = await db.user.findUnique({ where: { email: 'alice@example.com' } });
    expect(user).not.toBeNull();
    expect(user!.firstName).toBe('Alice');

    const org = await db.organization.findUnique({ where: { slug: 'smith-associates' } });
    expect(org).not.toBeNull();

    const membership = await db.organizationMember.findFirst({
      where: { userId: user!.id, organizationId: org!.id },
    });
    expect(membership?.role).toBe('OWNER');
  });

  it('returns a token when ?autoLogin=1', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register?autoLogin=1')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(typeof res.body.token).toBe('string');
  });

  it('returns 409 when the email is already taken', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ ...validPayload, organizationSlug: 'other-org', organizationName: 'Other Org' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/user already exists/i);
  });

  it('returns 409 when the organization slug is already taken', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ ...validPayload, email: 'bob@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/slug already taken/i);
  });

  it('returns 400 for an invalid email address', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ ...validPayload, email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when passwords do not match', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ ...validPayload, confirmPassword: 'Different99!' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when password is too weak (no uppercase)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ ...validPayload, password: 'lowercase1!', confirmPassword: 'lowercase1!' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when organizationName is missing in create mode', async () => {
    const { organizationName, ...rest } = validPayload;
    const res = await request(buildApp()).post('/api/auth/register').send(rest);
    expect(res.status).toBe(400);
  });
});

// ─── POST /login ─────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);
  });

  it('returns 200 with a JWT and user info for valid credentials', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'Password1!' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('alice@example.com');
    expect(Array.isArray(res.body.organizations)).toBe(true);
    expect(res.body.organizations[0].role).toBe('OWNER');
  });

  it('returns 401 for a wrong password', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'WrongPass1!' });

    expect(res.status).toBe(401);
  });

  it('returns 401 for a non-existent email', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Password1!' });

    expect(res.status).toBe(401);
  });

  it('returns 400 for a malformed email in the login body', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'whatever' });

    expect(res.status).toBe(400);
  });
});

// ─── GET /me ─────────────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  it('returns the authenticated user from a valid JWT', async () => {
    // Register then login to get a real token
    await request(buildApp()).post('/api/auth/register').send(validPayload);
    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'Password1!' });

    const { token } = loginRes.body;

    const res = await request(buildApp())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('alice@example.com');
  });

  it('returns 401 when no Authorization header is sent', async () => {
    const res = await request(buildApp()).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a tampered JWT', async () => {
    const res = await request(buildApp())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.tampered.signature');

    expect(res.status).toBe(401);
  });
});

// ─── POST /change-password ──────────────────────────────────────────────────
describe('POST /api/auth/change-password', () => {
  let token: string;

  beforeEach(async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    // Verify email so the requireEmailVerified guard passes
    await db.user.updateMany({
      where: { email: validPayload.email },
      data:  { emailVerifiedAt: new Date(), verifyToken: null, verifyTokenExp: null },
    });

    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: validPayload.password });
    token = loginRes.body.token;
  });

  it('returns 400 for invalid input (missing fields)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Password1!' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for a weak new password', async () => {
    const res = await request(buildApp())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Password1!', newPassword: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns 401 when current password is wrong', async () => {
    const res = await request(buildApp())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongPassword99!', newPassword: 'NewSecure123!@#' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/current password/i);
  });

  it('returns 200 on successful password change', async () => {
    const newPassword = 'BrandNewPass99!@';
    const res = await request(buildApp())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Password1!', newPassword: newPassword });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify the new password works for login
    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: newPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();
  });

  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/auth/change-password')
      .send({ currentPassword: 'Password1!', newPassword: 'NewSecure123!@#' });

    expect(res.status).toBe(401);
  });

  it('returns 403 when email is not verified', async () => {
    // Register a new user without verifying email
    const unverifiedPayload = {
      ...validPayload,
      email: 'unverified@example.com',
      organizationSlug: 'unverified-org',
      organizationName: 'Unverified Org',
    };
    await request(buildApp()).post('/api/auth/register?autoLogin=1').send(unverifiedPayload);
    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: unverifiedPayload.email, password: unverifiedPayload.password });
    const unverifiedToken = loginRes.body.token;

    const res = await request(buildApp())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${unverifiedToken}`)
      .send({ currentPassword: 'Password1!', newPassword: 'NewSecure123!@#' });

    expect(res.status).toBe(403);
  });
});

// ─── POST /logout ───────────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  it('returns ok:true and clears session', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);
    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: validPayload.password });
    const token = loginRes.body.token;

    const res = await request(buildApp())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns ok:true even without a token (graceful)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── POST /resend-verification ──────────────────────────────────────────────
describe('POST /api/auth/resend-verification', () => {
  it('returns 400 for invalid email', async () => {
    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('returns 200 for non-existent email (does not leak user existence)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: 'ghost@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 200 for already-verified email (does not leak verification status)', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);
    await db.user.updateMany({
      where: { email: validPayload.email },
      data:  { emailVerifiedAt: new Date(), verifyToken: null, verifyTokenExp: null },
    });

    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: validPayload.email });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 200 for an unverified user', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    // Set the verifyTokenExp far in the past so rate-limit check passes
    await db.user.updateMany({
      where: { email: validPayload.email },
      data:  { verifyTokenExp: new Date(Date.now() - 48 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000) },
    });

    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: validPayload.email });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── POST /forgot-password ──────────────────────────────────────────────────
describe('POST /api/auth/forgot-password', () => {
  it('returns 400 for invalid email', async () => {
    const res = await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('returns 200 for non-existent email (does not leak user existence)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 200 and sets resetToken for existing user', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    const res = await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: validPayload.email });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify the DB has a reset token
    const user = await db.user.findUnique({ where: { email: validPayload.email } });
    expect(user!.resetToken).not.toBeNull();
    expect(user!.resetTokenExp).not.toBeNull();
  });
});

// ─── POST /reset-password ───────────────────────────────────────────────────
describe('POST /api/auth/reset-password', () => {
  it('returns 400 for invalid input', async () => {
    const res = await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: '', newPassword: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid/expired token', async () => {
    const res = await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: 'some-bogus-token-value-that-does-not-exist', newPassword: 'NewSecure123!@#' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('returns 400 for expired reset token', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    // Trigger forgot-password to get a reset token in the DB
    await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: validPayload.email });

    // Manually expire the reset token
    await db.user.updateMany({
      where: { email: validPayload.email },
      data:  { resetTokenExp: new Date(Date.now() - 60 * 60 * 1000) },
    });

    // The hashed token is in the DB, but we need the raw token. Since we
    // cannot easily retrieve it, we create a known one.
    const crypto = await import('node:crypto');
    const rawToken   = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    await db.user.updateMany({
      where: { email: validPayload.email },
      data:  { resetToken: hashedToken, resetTokenExp: new Date(Date.now() - 1000) },
    });

    const res = await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewSecure123!@#' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('successfully resets password with a valid token', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    const crypto = await import('node:crypto');
    const rawToken   = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    await db.user.updateMany({
      where: { email: validPayload.email },
      data:  { resetToken: hashedToken, resetTokenExp: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const newPassword = 'ResetPassword99!@';
    const res = await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify old password no longer works
    const loginOld = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: validPayload.password });
    expect(loginOld.status).toBe(401);

    // Verify new password works
    const loginNew = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: newPassword });
    expect(loginNew.status).toBe(200);
    expect(loginNew.body.token).toBeTruthy();

    // Verify reset token is cleared
    const user = await db.user.findUnique({ where: { email: validPayload.email } });
    expect(user!.resetToken).toBeNull();
    expect(user!.resetTokenExp).toBeNull();
  });
});

// ─── Rate-limiting (login-guard) ────────────────────────────────────────────
describe('POST /api/auth/login — rate limiting', () => {
  beforeEach(async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);
  });

  it('returns 429 after 5 consecutive failed login attempts', async () => {
    const app = buildApp();
    const wrongCreds = { email: 'alice@example.com', password: 'WrongPass1!' };

    // Make 5 failed attempts to trigger lockout
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/login').send(wrongCreds);
      expect(res.status).toBe(401);
    }

    // 6th attempt should be rate-limited
    const res = await request(app).post('/api/auth/login').send(wrongCreds);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('account_locked');
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('returns 429 even with correct password after lockout', async () => {
    const app = buildApp();
    const wrongCreds = { email: 'alice@example.com', password: 'WrongPass1!' };
    const correctCreds = { email: 'alice@example.com', password: 'Password1!' };

    // Trigger lockout
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send(wrongCreds);
    }

    // Even correct password should be blocked
    const res = await request(app).post('/api/auth/login').send(correctCreds);
    expect(res.status).toBe(429);
  });
});

// ─── POST /register — redirect mode ────────────────────────────────────────
describe('POST /api/auth/register — redirect mode', () => {
  it('returns 303 when ?redirect=1 is set', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register?redirect=1')
      .send(validPayload);

    expect(res.status).toBe(303);
    expect(res.body.redirectTo).toBe('/login');
  });
});

// ─── GET /verify-email ──────────────────────────────────────────────────────
describe('GET /api/auth/verify-email', () => {
  it('returns 400 when token query param is missing', async () => {
    const res = await request(buildApp())
      .get('/api/auth/verify-email');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('returns 400 for invalid/expired verification token', async () => {
    const res = await request(buildApp())
      .get('/api/auth/verify-email?token=bogus-token-that-does-not-exist');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('verifies email and returns a new access token', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    const crypto = await import('node:crypto');
    const rawToken   = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const verifyTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.user.updateMany({
      where: { email: validPayload.email },
      data:  { verifyToken: hashedToken, verifyTokenExp, emailVerifiedAt: null },
    });

    const res = await request(buildApp())
      .get(`/api/auth/verify-email?token=${rawToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeTruthy();
  });

  it('returns 200 with message when email is already verified', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    const crypto = await import('node:crypto');
    const rawToken   = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const verifyTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.user.updateMany({
      where: { email: validPayload.email },
      data:  { verifyToken: hashedToken, verifyTokenExp, emailVerifiedAt: new Date() },
    });

    const res = await request(buildApp())
      .get(`/api/auth/verify-email?token=${rawToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already verified/i);
  });

  it('returns 400 for an expired verification token', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    const crypto = await import('node:crypto');
    const rawToken   = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    await db.user.updateMany({
      where: { email: validPayload.email },
      data:  { verifyToken: hashedToken, verifyTokenExp: new Date(Date.now() - 1000), emailVerifiedAt: null },
    });

    const res = await request(buildApp())
      .get(`/api/auth/verify-email?token=${rawToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });
});

// ─── POST /resend-verification — throttle ───────────────────────────────────
describe('POST /api/auth/resend-verification — rate throttle', () => {
  it('returns 429 when requesting resend too soon (within 8 hours)', async () => {
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    // The verifyTokenExp is set to 24h from now, so lastSent = verifyTokenExp - 24h = now.
    // hoursSinceLast ≈ 0, which is < 8, so it should return 429.
    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: validPayload.email });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/wait/i);
  });
});

// ─── POST /refresh-token ────────────────────────────────────────────────────
describe('POST /api/auth/refresh-token', () => {
  it('returns 401 when no refresh cookie is present', async () => {
    const res = await request(buildApp())
      .post('/api/auth/refresh-token');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no refresh token/i);
  });

  it('returns 401 for an invalid/expired refresh token cookie', async () => {
    // Note: the test buildApp() does not include cookie-parser, so
    // req.cookies is undefined and the route returns "No refresh token".
    // This still covers the 401 early-return path (line 380-382 of auth.ts).
    const res = await request(buildApp())
      .post('/api/auth/refresh-token')
      .set('Cookie', 'cc_rt=invalid-token-value');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/refresh token/i);
  });
});

// ─── POST /register — join mode ────────────────────────────────────────────
describe('POST /api/auth/register — join mode', () => {
  it('allows a new user to join an existing org', async () => {
    // First create an org
    await request(buildApp()).post('/api/auth/register').send(validPayload);

    const joinPayload = {
      email: 'joiner@example.com',
      password: 'Password1!',
      confirmPassword: 'Password1!',
      name: { firstName: 'Bob', lastName: 'Joiner' },
      role: 'CLIENT',
      orgMode: 'join',
      organizationSlug: 'smith-associates',
    };

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send(joinPayload);

    expect(res.status).toBe(201);
    expect(res.body.organization.slug).toBe('smith-associates');

    // Verify membership was created with MEMBER role
    const user = await db.user.findUnique({ where: { email: 'joiner@example.com' } });
    const membership = await db.organizationMember.findFirst({
      where: { userId: user!.id },
    });
    expect(membership!.role).toBe('MEMBER');
  });

  it('returns 404 when joining a non-existent org', async () => {
    const joinPayload = {
      email: 'joiner@example.com',
      password: 'Password1!',
      confirmPassword: 'Password1!',
      name: { firstName: 'Bob', lastName: 'Joiner' },
      role: 'CLIENT',
      orgMode: 'join',
      organizationSlug: 'non-existent-org',
    };

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send(joinPayload);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/organization not found/i);
  });
});

// ─── Session: MAX_SESSIONS eviction (session.ts lines 36-42) ───────────────
describe('POST /api/auth/login — MAX_SESSIONS enforcement', () => {
  const sessionEmail = 'session-evict@example.com';
  const sessionPayload = {
    ...validPayload,
    email: sessionEmail,
    organizationSlug: 'session-evict-org',
    organizationName: 'Session Evict Org',
  };

  beforeEach(async () => {
    await request(buildApp()).post('/api/auth/register').send(sessionPayload);
    await db.user.updateMany({
      where: { email: sessionEmail },
      data:  { emailVerifiedAt: new Date(), verifyToken: null, verifyTokenExp: null },
    });
  });

  it('evicts the oldest session when logging in more than 5 times', async () => {
    const app = buildApp({ cookies: true });
    const creds = { email: sessionEmail, password: validPayload.password };

    // Login 6 times — MAX_SESSIONS_PER_USER is 5
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post('/api/auth/login').send(creds);
      expect(res.status).toBe(200);
    }

    // There should be at most 5 active (non-revoked, non-expired) sessions
    const user = await db.user.findUnique({ where: { email: creds.email } });
    const activeSessions = await db.session.findMany({
      where: { userId: user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(activeSessions.length).toBeLessThanOrEqual(5);

    // There should be at least 1 revoked session from the eviction
    const revokedSessions = await db.session.findMany({
      where: { userId: user!.id, revokedAt: { not: null } },
    });
    expect(revokedSessions.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Session: refresh token rotation (session.ts lines 57-90) ──────────────
describe('POST /api/auth/refresh-token — rotation with cookie-parser', () => {
  const rotateEmail = 'rotate-refresh@example.com';
  const rotatePayload = {
    ...validPayload,
    email: rotateEmail,
    organizationSlug: 'rotate-org',
    organizationName: 'Rotate Org',
  };

  beforeEach(async () => {
    await request(buildApp()).post('/api/auth/register').send(rotatePayload);
    await db.user.updateMany({
      where: { email: rotateEmail },
      data:  { emailVerifiedAt: new Date(), verifyToken: null, verifyTokenExp: null },
    });
  });

  it('rotates the refresh token and returns a new access token', async () => {
    const app = buildApp({ cookies: true });

    // Login to get a refresh cookie
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: rotateEmail, password: validPayload.password });

    expect(loginRes.status).toBe(200);

    // Extract the cc_rt cookie from the Set-Cookie header
    const setCookieHeaders = loginRes.headers['set-cookie'];
    expect(setCookieHeaders).toBeDefined();

    const cookieArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const refreshCookie = cookieArray.find((c: string) => c.startsWith('cc_rt='));
    expect(refreshCookie).toBeDefined();

    // Use the cookie to call refresh-token
    const refreshRes = await request(app)
      .post('/api/auth/refresh-token')
      .set('Cookie', refreshCookie!);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.token).toBeTruthy();
    expect(typeof refreshRes.body.token).toBe('string');

    // The response should set a new refresh cookie (rotated)
    const newSetCookie = refreshRes.headers['set-cookie'];
    expect(newSetCookie).toBeDefined();
    const newCookieArray = Array.isArray(newSetCookie) ? newSetCookie : [newSetCookie];
    const newRefreshCookie = newCookieArray.find((c: string) => c.startsWith('cc_rt='));
    expect(newRefreshCookie).toBeDefined();
    // The new cookie should differ from the original
    expect(newRefreshCookie).not.toBe(refreshCookie);
  });

  it('rejects the old refresh token after rotation (replay protection)', async () => {
    const app = buildApp({ cookies: true });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: rotateEmail, password: validPayload.password });

    const setCookieHeaders = loginRes.headers['set-cookie'];
    const cookieArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const refreshCookie = cookieArray.find((c: string) => c.startsWith('cc_rt='));

    // First rotation — should succeed
    const firstRotation = await request(app)
      .post('/api/auth/refresh-token')
      .set('Cookie', refreshCookie!);
    expect(firstRotation.status).toBe(200);

    // Second rotation with the SAME (now-consumed) cookie — should fail
    const secondRotation = await request(app)
      .post('/api/auth/refresh-token')
      .set('Cookie', refreshCookie!);
    expect(secondRotation.status).toBe(401);
  });

  it('returns 401 for a completely invalid refresh token', async () => {
    const app = buildApp({ cookies: true });
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .set('Cookie', 'cc_rt=0000000000000000000000000000000000000000000000000000000000000000');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/refresh token/i);
  });
});
