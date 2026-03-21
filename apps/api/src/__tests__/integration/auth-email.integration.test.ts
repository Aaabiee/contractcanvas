import request from 'supertest';
import express, { type Express } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { router as authRouter } from '../../routes/auth.js';

const db = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

const validPayload = {
  email: 'verify@example.com',
  password: 'Password1!',
  confirmPassword: 'Password1!',
  name: { firstName: 'Vera', lastName: 'Test' },
  role: 'LAWYER',
  orgMode: 'create',
  organizationName: 'Verify Firm',
  organizationSlug: 'verify-firm',
  acceptTerms: true,
};

afterEach(async () => {
  await db.organizationMember.deleteMany();
  await db.organization.deleteMany();
  await db.user.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

async function registerUser(overrides: object = {}) {
  const res = await request(buildApp())
    .post('/api/auth/register')
    .send({ ...validPayload, ...overrides });
  return res;
}

describe('POST /api/auth/register — email verification fields', () => {
  it('stores verifyToken hash and expiry in the database', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });
    expect(user).not.toBeNull();
    expect(user!.verifyToken).not.toBeNull();
    expect(user!.verifyTokenExp).not.toBeNull();
    expect(user!.emailVerifiedAt).toBeNull();
  });

  it('responds with "verify your email" message', async () => {
    const res = await registerUser();
    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/verify your email/i);
  });
});

describe('POST /api/auth/login — emailVerified field', () => {
  it('returns emailVerified: false for unverified user', async () => {
    await registerUser();
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: validPayload.password });
    expect(res.status).toBe(200);
    expect(res.body.user.emailVerified).toBe(false);
  });
});

describe('GET /api/auth/verify-email', () => {
  it('returns 400 when token is missing', async () => {
    const res = await request(buildApp()).get('/api/auth/verify-email');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('returns 400 for an invalid or unknown token', async () => {
    const res = await request(buildApp())
      .get('/api/auth/verify-email?token=deadbeefdeadbeef');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('returns 400 for an expired token', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });
    await db.user.update({
      where: { id: user!.id },
      data:  { verifyTokenExp: new Date(Date.now() - 1000) },
    });

    const rawToken = 'somefakeraw64charspad0000000000000000000000000000000000000000000';
    const res = await request(buildApp())
      .get(`/api/auth/verify-email?token=${rawToken}`);
    expect(res.status).toBe(400);
  });

  it('verifies email and returns a new JWT', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });
    expect(user!.verifyToken).not.toBeNull();

    const rawToken = 'test_raw_token_placeholder';
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    await db.user.update({
      where: { id: user!.id },
      data:  {
        verifyToken:    hashed,
        verifyTokenExp: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(buildApp())
      .get(`/api/auth/verify-email?token=${rawToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.token).toBe('string');

    const updated = await db.user.findUnique({ where: { email: validPayload.email } });
    expect(updated!.emailVerifiedAt).not.toBeNull();
    expect(updated!.verifyToken).toBeNull();
  });

  it('returns 200 ok when email is already verified', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });

    const rawToken = 'test_raw_token_placeholder';
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    await db.user.update({
      where: { id: user!.id },
      data:  {
        verifyToken:    hashed,
        verifyTokenExp: new Date(Date.now() + 24 * 60 * 60 * 1000),
        emailVerifiedAt: new Date(),
      },
    });

    const res = await request(buildApp())
      .get(`/api/auth/verify-email?token=${rawToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already verified/i);
  });

  it('reflects emailVerified: true in login after verification', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });

    const rawToken = 'test_raw_token_2';
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    await db.user.update({
      where: { id: user!.id },
      data:  {
        verifyToken:    hashed,
        verifyTokenExp: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await request(buildApp()).get(`/api/auth/verify-email?token=${rawToken}`);

    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: validPayload.password });

    expect(loginRes.body.user.emailVerified).toBe(true);
  });
});

describe('POST /api/auth/resend-verification', () => {
  it('returns 400 for invalid email', async () => {
    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('returns 200 for unknown email (anti-enumeration)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 200 silently for already-verified user', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });
    await db.user.update({
      where: { id: user!.id },
      data:  { emailVerifiedAt: new Date() },
    });

    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: validPayload.email });
    expect(res.status).toBe(200);
  });

  it('returns 429 when email was recently sent (within 8 hours)', async () => {
    await registerUser();

    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: validPayload.email });
    expect(res.status).toBe(429);
  });

  it('issues a new token when cooldown has passed', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });
    await db.user.update({
      where: { id: user!.id },
      data:  { verifyTokenExp: new Date(Date.now() - 9 * 60 * 60 * 1000) },
    });

    const stale = await db.user.findUnique({ where: { email: validPayload.email } });
    const oldToken = stale!.verifyToken;

    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ email: validPayload.email });

    expect(res.status).toBe(200);
    const updated = await db.user.findUnique({ where: { email: validPayload.email } });
    expect(updated!.verifyToken).not.toEqual(oldToken);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('returns 400 for invalid email', async () => {
    const res = await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: 'not-valid' });
    expect(res.status).toBe(400);
  });

  it('always returns 200 for unknown email (anti-enumeration)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('stores hashed resetToken for known email', async () => {
    await registerUser();
    const res = await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: validPayload.email });

    expect(res.status).toBe(200);
    const user = await db.user.findUnique({ where: { email: validPayload.email } });
    expect(user!.resetToken).not.toBeNull();
    expect(user!.resetTokenExp).not.toBeNull();
    expect(user!.resetTokenExp!.getTime()).toBeGreaterThan(Date.now());
  });

  it('resetToken expires in ~1 hour', async () => {
    await registerUser();
    await request(buildApp())
      .post('/api/auth/forgot-password')
      .send({ email: validPayload.email });

    const user = await db.user.findUnique({ where: { email: validPayload.email } });
    const expMs  = user!.resetTokenExp!.getTime();
    const diffMs = expMs - Date.now();
    expect(diffMs).toBeGreaterThan(55 * 60 * 1000);
    expect(diffMs).toBeLessThan(65 * 60 * 1000);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('returns 400 for missing token', async () => {
    const res = await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: '', newPassword: 'NewPassword1!' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown/invalid token', async () => {
    const res = await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: 'invalidtoken', newPassword: 'NewPassword1!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('returns 400 for expired reset token', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });

    const rawToken = 'expiredrawtoken';
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    await db.user.update({
      where: { id: user!.id },
      data:  {
        resetToken:    hashed,
        resetTokenExp: new Date(Date.now() - 1000),
      },
    });

    const res = await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewPassword1!' });
    expect(res.status).toBe(400);
  });

  it('resets password and clears resetToken', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });

    const rawToken = 'validresettoken123';
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    await db.user.update({
      where: { id: user!.id },
      data:  {
        resetToken:    hashed,
        resetTokenExp: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const res = await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewSecurePass1!' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const updated = await db.user.findUnique({ where: { email: validPayload.email } });
    expect(updated!.resetToken).toBeNull();
    expect(updated!.resetTokenExp).toBeNull();
  });

  it('allows login with new password after reset', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });

    const rawToken = 'validresettoken456';
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    await db.user.update({
      where: { id: user!.id },
      data:  {
        resetToken:    hashed,
        resetTokenExp: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewSecurePass1!' });

    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: 'NewSecurePass1!' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();
  });

  it('rejects login with old password after reset', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });

    const rawToken = 'validresettoken789';
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    await db.user.update({
      where: { id: user!.id },
      data:  {
        resetToken:    hashed,
        resetTokenExp: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewSecurePass1!' });

    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: validPayload.email, password: validPayload.password });

    expect(loginRes.status).toBe(401);
  });

  it('returns 400 when newPassword is too weak', async () => {
    await registerUser();
    const user = await db.user.findUnique({ where: { email: validPayload.email } });

    const rawToken = 'weakpassresettoken';
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
    await db.user.update({
      where: { id: user!.id },
      data:  {
        resetToken:    hashed,
        resetTokenExp: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const res = await request(buildApp())
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'weakpass' });

    expect(res.status).toBe(400);
  });
});
