import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.NODE_ENV = 'test';

vi.mock('../../config.js', () => ({
  app: { env: 'test', port: 3333 },
  db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
  s3: { region: 'us-east-1', bucket: 'test', forcePathStyle: true },
  stripe: {},
  jwt: { secret: 'test-secret-key-for-testing' },
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
}));

const mockBcrypt = { hash: vi.fn(), compare: vi.fn() };
vi.mock('bcrypt', () => ({ default: mockBcrypt }));

const mockPrisma = {
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
  organization: { findUnique: vi.fn(), create: vi.fn() },
  organizationMember: { findMany: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

vi.mock('../../lib/session.js', () => ({
  createSession:          vi.fn().mockResolvedValue('mock-raw-refresh-token'),
  rotateSession:          vi.fn(),
  deleteSession:          vi.fn(),
  revokeAllUserSessions:  vi.fn(),
  REFRESH_COOKIE:         'cc_rt',
  REFRESH_COOKIE_OPTS:    { httpOnly: true, secure: false, sameSite: 'strict', path: '/api/auth', maxAge: 2592000000 },
}));

vi.mock('../../services/email.service.js', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../queues/index.js', () => ({ emailQueue: null }));

vi.mock('../../middleware/auth.js', () => ({
  protect: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: 'test@example.com', roles: ['LAWYER'] };
    next();
  },
  requireEmailVerified: (_req: any, _res: any, next: any) => { next(); },
  default: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: 'test@example.com', roles: ['LAWYER'] };
    next();
  },
}));

const { router } = await import('../auth.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', router);
  return app;
}

const validRegisterPayload = {
  email: 'new@example.com',
  password: 'Password1!',
  confirmPassword: 'Password1!',
  name: { firstName: 'Alice', lastName: 'Smith' },
  role: 'CLIENT',
  orgMode: 'create',
  organizationName: 'Acme Law',
  organizationSlug: 'acme-law',
  acceptTerms: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/register', () => {
  it('returns 400 when email is invalid', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is too short', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, password: 'short', confirmPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when passwords do not match', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, confirmPassword: 'differentpassword' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when acceptTerms is false in create mode', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, acceptTerms: false });
    expect(res.status).toBe(400);
  });

  it('returns 400 when organizationName is missing in create mode', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, organizationName: undefined });
    expect(res.status).toBe(400);
  });

  it('returns 409 when email already exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
    const app = buildApp();
    const res = await request(app).post('/auth/register').send(validRegisterPayload);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('returns 409 when org slug already taken', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'existing-org' });
    const app = buildApp();
    const res = await request(app).post('/auth/register').send(validRegisterPayload);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/slug/i);
  });

  it('creates user and org and returns 201', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    mockBcrypt.hash.mockResolvedValue('hashed-password');

    const newUser = { id: 'u1', email: 'new@example.com', firstName: 'Alice', lastName: 'Smith', name: 'Alice Smith', role: 'CLIENT', createdAt: new Date() };
    const newOrg = { id: 'org-1', name: 'Acme Law', slug: 'acme-law' };
    mockPrisma.$transaction.mockResolvedValue({ user: newUser, organization: newOrg });

    const app = buildApp();
    const res = await request(app).post('/auth/register').send(validRegisterPayload);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('new@example.com');
    expect(res.body.organization.slug).toBe('acme-law');
    expect(res.body.redirectTo).toBe('/login');
  });

  it('returns 404 when joining non-existent org', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({
        ...validRegisterPayload,
        orgMode: 'join',
        organizationSlug: 'non-existent',
        organizationName: undefined,
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/organization not found/i);
  });
});

describe('POST /api/auth/login', () => {
  it('returns 400 for invalid email format', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'pass' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nonexistent@example.com', password: 'pass' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when password is wrong', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: 'hash' });
    mockBcrypt.compare.mockResolvedValue(false);
    const app = buildApp();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('returns JWT token on successful login', async () => {
    const user = { id: 'u1', email: 'a@b.com', firstName: 'A', lastName: 'B', name: 'A B', role: 'LAWYER', passwordHash: 'hash' };
    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockBcrypt.compare.mockResolvedValue(true);
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      { role: 'OWNER', createdAt: new Date(), organization: { id: 'org-1', name: 'Acme', slug: 'acme' } },
    ]);
    const app = buildApp();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'correctpassword' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('a@b.com');
    expect(res.body.organizations).toHaveLength(1);
    const decoded = jwt.verify(res.body.token, 'test-secret-key-for-testing') as any;
    expect(decoded.sub).toBe('u1');
  });

  it('embeds organizations in the JWT payload', async () => {
    const user = { id: 'u1', email: 'a@b.com', firstName: 'A', lastName: 'B', name: 'A B', role: 'LAWYER', passwordHash: 'hash' };
    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockBcrypt.compare.mockResolvedValue(true);
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      { role: 'MEMBER', createdAt: new Date(), organization: { id: 'org-2', name: 'Beta', slug: 'beta' } },
    ]);
    const app = buildApp();
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'pass' });
    const decoded = jwt.verify(res.body.token, 'test-secret-key-for-testing') as any;
    expect(decoded.organizations).toHaveLength(1);
    expect(decoded.organizations[0].id).toBe('org-2');
  });
});

describe('POST /api/auth/register — schema validation edge cases', () => {
  it('returns 400 when organizationSlug is missing in create mode', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, organizationSlug: undefined });
    expect(res.status).toBe(400);
  });

  it('returns 400 when organizationSlug is missing in join mode', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({
        ...validRegisterPayload,
        orgMode: 'join',
        organizationSlug: undefined,
        organizationName: undefined,
        acceptTerms: undefined,
      });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/register — join mode', () => {
  it('returns 404 when orgMode is join and org slug does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({
        ...validRegisterPayload,
        orgMode: 'join',
        organizationSlug: 'non-existent',
        organizationName: undefined,
        acceptTerms: undefined,
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/organization not found/i);
  });

  it('registers user as MEMBER when joining existing org', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: 'Acme', slug: 'acme' });
    mockBcrypt.hash.mockResolvedValue('hashed-password');

    const newUser = { id: 'u1', email: 'new@example.com', firstName: 'Alice', lastName: 'Smith', name: 'Alice Smith', role: 'CLIENT', createdAt: new Date() };
    const newOrg  = { id: 'org-1', name: 'Acme', slug: 'acme' };
    mockPrisma.$transaction.mockResolvedValue({ user: newUser, organization: newOrg });

    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({
        ...validRegisterPayload,
        orgMode: 'join',
        organizationSlug: 'acme',
        organizationName: undefined,
        acceptTerms: undefined,
      });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('new@example.com');
    expect(res.body.redirectTo).toBe('/login');
  });
});

describe('POST /api/auth/register — password validation', () => {
  it('returns 400 when password has no uppercase letter', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, password: 'password1!', confirmPassword: 'password1!' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password has no lowercase letter', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, password: 'PASSWORD1!', confirmPassword: 'PASSWORD1!' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password has no number', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, password: 'Password!!', confirmPassword: 'Password!!' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password has no special character', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, password: 'Password123', confirmPassword: 'Password123' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/register — autoLogin and redirect flags', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    mockBcrypt.hash.mockResolvedValue('hashed-password');
    const newUser = { id: 'u1', email: 'new@example.com', firstName: 'Alice', lastName: 'Smith', name: 'Alice Smith', role: 'CLIENT', createdAt: new Date() };
    const newOrg  = { id: 'org-1', name: 'Acme Law', slug: 'acme-law' };
    mockPrisma.$transaction.mockResolvedValue({ user: newUser, organization: newOrg });
    // buildTokenPayload needs findMany for org memberships when autoLogin=1
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      { role: 'OWNER', createdAt: new Date(), organization: { id: 'org-1', name: 'Acme Law', slug: 'acme-law' } },
    ]);
  });

  it('returns a token when autoLogin=1 is set', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register?autoLogin=1')
      .send(validRegisterPayload);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, 'test-secret-key-for-testing') as any;
    expect(decoded.sub).toBe('u1');
  });

  it('does not return a token when autoLogin is not set', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send(validRegisterPayload);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeUndefined();
  });

  it('returns 303 with redirectTo when redirect=1 is set', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/register?redirect=1')
      .send(validRegisterPayload);
    expect(res.status).toBe(303);
    expect(res.body.redirectTo).toBe('/login');
  });
});

describe('POST /api/auth/register — transaction callback executed', () => {
  it('executes the transaction callback (create mode) and creates user, org, and membership', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    mockBcrypt.hash.mockResolvedValue('hashed-password');

    const newUser = { id: 'u1', email: 'new@example.com', firstName: 'Alice', lastName: 'Smith', name: 'Alice Smith', role: 'CLIENT', createdAt: new Date() };
    const newOrg  = { id: 'org-1', name: 'Acme Law', slug: 'acme-law' };

    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        user: { create: vi.fn().mockResolvedValue(newUser) },
        organization: { create: vi.fn().mockResolvedValue(newOrg) },
        organizationMember: { create: vi.fn().mockResolvedValue({}) },
        subscription: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const app = buildApp();
    const res = await request(app).post('/auth/register').send(validRegisterPayload);

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('new@example.com');
    expect(res.body.organization.slug).toBe('acme-law');
  });

  it('executes the transaction callback (join mode) and creates user and membership in existing org', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: 'Acme', slug: 'acme' });
    mockBcrypt.hash.mockResolvedValue('hashed-password');

    const newUser = { id: 'u2', email: 'new@example.com', firstName: 'Alice', lastName: 'Smith', name: 'Alice Smith', role: 'CLIENT', createdAt: new Date() };

    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        user: { create: vi.fn().mockResolvedValue(newUser) },
        organization: { create: vi.fn() },
        organizationMember: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const app = buildApp();
    const res = await request(app)
      .post('/auth/register')
      .send({ ...validRegisterPayload, orgMode: 'join', organizationSlug: 'acme', organizationName: undefined, acceptTerms: undefined });

    expect(res.status).toBe(201);
  });
});

describe('POST /api/auth/register — P2002 conflict handling', () => {
  it('returns 409 with email message when Prisma P2002 targets email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    mockBcrypt.hash.mockResolvedValue('hash');

    const err: any = new Error('Unique');
    err.code = 'P2002';
    err.meta = { target: ['email'] };
    mockPrisma.$transaction.mockRejectedValue(err);

    const app = buildApp();
    const res = await request(app).post('/auth/register').send(validRegisterPayload);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('returns 409 with slug message when Prisma P2002 targets slug', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    mockBcrypt.hash.mockResolvedValue('hash');

    const err: any = new Error('Unique');
    err.code = 'P2002';
    err.meta = { target: ['slug'] };
    mockPrisma.$transaction.mockRejectedValue(err);

    const app = buildApp();
    const res = await request(app).post('/auth/register').send(validRegisterPayload);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/slug/i);
  });
});

describe('POST /api/auth/login — error paths', () => {
  it('propagates unexpected errors from login via next(err)', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB crash'));
    const app = buildApp();
    const appWithHandler = express();
    appWithHandler.use(express.json());
    appWithHandler.use('/auth', (await import('../auth.js')).router);
    appWithHandler.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: err.message });
    });
    const res = await request(appWithHandler).post('/auth/login').send({ email: 'a@b.com', password: 'pass' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/auth/refresh-token', () => {
  it('returns 401 when no refresh cookie is present', async () => {
    const app = buildApp();
    const res = await request(app).post('/auth/refresh-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No refresh token');
  });

  it('returns 401 when the refresh token is invalid or expired', async () => {
    const { rotateSession } = await import('../../lib/session.js');
    (rotateSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await request(app)
      .post('/auth/refresh-token')
      .set('Cookie', 'cc_rt=invalid-token');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Refresh token invalid or expired');
  });

  it('returns a new JWT and rotates the cookie on valid refresh token', async () => {
    const { rotateSession } = await import('../../lib/session.js');
    (rotateSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      newRaw: 'new-raw-token',
      userId: 'u1',
    });

    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'LAWYER' });
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      { role: 'OWNER', createdAt: new Date(), organization: { id: 'org-1', name: 'Acme', slug: 'acme' } },
    ]);

    const app = buildApp();
    const res = await request(app)
      .post('/auth/refresh-token')
      .set('Cookie', 'cc_rt=valid-raw-token');

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, 'test-secret-key-for-testing') as any;
    expect(decoded.sub).toBe('u1');
    expect(decoded.organizations).toHaveLength(1);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the authenticated user from req.user', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer any-token');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-1');
    expect(res.body.email).toBe('test@example.com');
  });
});

// ── POST /change-password ────────────────────────────────────────────────────

describe('POST /api/auth/change-password', () => {
  it('returns 400 when body is invalid (missing fields)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/change-password')
      .set('Authorization', 'Bearer any-token')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 400 when newPassword is too short', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/change-password')
      .set('Authorization', 'Bearer any-token')
      .send({ currentPassword: 'OldPassword1!', newPassword: 'Short1!' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when current password is wrong', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', passwordHash: 'hashed' });
    mockBcrypt.compare.mockResolvedValue(false);
    const app = buildApp();
    const res = await request(app)
      .post('/auth/change-password')
      .set('Authorization', 'Bearer any-token')
      .send({ currentPassword: 'WrongPassword1!', newPassword: 'NewPassword123!' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Current password is incorrect');
  });

  it('returns 200 on success, revokes sessions, and clears cookie', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', passwordHash: 'hashed' });
    mockBcrypt.compare.mockResolvedValue(true);
    mockBcrypt.hash.mockResolvedValue('new-hashed');
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.$transaction.mockResolvedValue([{}]);

    const { revokeAllUserSessions } = await import('../../lib/session.js');
    const app = buildApp();
    const res = await request(app)
      .post('/auth/change-password')
      .set('Authorization', 'Bearer any-token')
      .send({ currentPassword: 'OldPassword1!', newPassword: 'NewPassword123!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(revokeAllUserSessions).toHaveBeenCalledWith('user-1');
  });
});

// ── POST /resend-verification ────────────────────────────────────────────────

describe('POST /api/auth/resend-verification', () => {
  it('returns 400 when email is invalid', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid email address');
  });

  it('returns 200 even when user does not exist (no leak)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 200 when user is already verified (no leak)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@b.com', firstName: 'A', emailVerifiedAt: new Date(), verifyTokenExp: null,
    });
    const app = buildApp();
    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 429 when rate-limited (sent too recently)', async () => {
    // verifyTokenExp set to now + 24h means it was just sent
    const recentExp = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@b.com', firstName: 'A', emailVerifiedAt: null, verifyTokenExp: recentExp,
    });
    const app = buildApp();
    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(429);
  });

  it('returns 200 and sends email when enough time has passed', async () => {
    // verifyTokenExp set far in the past means it was sent long ago
    const oldExp = new Date(Date.now() - 48 * 60 * 60 * 1000);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@b.com', firstName: 'A', emailVerifiedAt: null, verifyTokenExp: oldExp,
    });
    mockPrisma.user.update = vi.fn().mockResolvedValue({});
    const { sendEmail } = await import('../../services/email.service.js');
    const app = buildApp();
    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalled();
  });
});

// ── POST /forgot-password ────────────────────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {
  it('returns 200 even when user does not exist (no leak)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 200 and sends email when user exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', firstName: 'A' });
    mockPrisma.user.update = vi.fn().mockResolvedValue({});
    const { sendEmail } = await import('../../services/email.service.js');
    const app = buildApp();
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalled();
  });

  it('returns 400 for invalid email format', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

// ── POST /reset-password ─────────────────────────────────────────────────────

describe('POST /api/auth/reset-password', () => {
  it('returns 400 when body is invalid (missing token)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ newPassword: 'NewPassword123!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 400 when newPassword does not meet requirements', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'some-token', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when token is expired or invalid', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      resetTokenExp: new Date(Date.now() - 3600 * 1000), // expired
    });
    const app = buildApp();
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'expired-token-value', newPassword: 'NewPassword123!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('returns 400 when token does not match any user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'nonexistent-token', newPassword: 'NewPassword123!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('returns 200 on success and revokes all sessions', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      resetTokenExp: new Date(Date.now() + 3600 * 1000), // valid
    });
    mockBcrypt.hash.mockResolvedValue('new-hashed');
    mockPrisma.user.update = vi.fn().mockResolvedValue({});

    const { revokeAllUserSessions } = await import('../../lib/session.js');
    const app = buildApp();
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'valid-token', newPassword: 'NewPassword123!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(revokeAllUserSessions).toHaveBeenCalledWith('u1');
  });
});

// ── POST /logout ─────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('returns ok when called with a Bearer token', async () => {
    const app = buildApp();
    const token = jwt.sign({ sub: 'u1', jti: 'jti-1', exp: Math.floor(Date.now() / 1000) + 3600 }, 'test-secret-key-for-testing');
    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns ok when called with a refresh cookie', async () => {
    const { deleteSession } = await import('../../lib/session.js');
    const app = buildApp();
    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', 'cc_rt=some-refresh-token');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(deleteSession).toHaveBeenCalledWith('some-refresh-token');
  });

  it('returns ok even when called without any token', async () => {
    const app = buildApp();
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── Error propagation tests (next(err) catch blocks) ────────────────────────

function buildAppWithErrorHandler() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

describe('POST /api/auth/register — next(err) for non-P2002 errors', () => {
  it('propagates non-P2002 errors to the error handler via next()', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    mockBcrypt.hash.mockResolvedValue('hash');
    mockPrisma.$transaction.mockRejectedValue(new Error('unexpected DB failure'));

    const app = buildAppWithErrorHandler();
    const res = await request(app).post('/auth/register').send(validRegisterPayload);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('unexpected DB failure');
  });
});

describe('POST /api/auth/login — rate-limit (account_locked)', () => {
  it('returns 429 when account is locked due to too many failed attempts', async () => {
    // Trigger enough failed attempts to lock the account
    const email = `locked-${Date.now()}@example.com`;
    const payload = { email, password: 'wrongpassword' };

    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email, passwordHash: 'hash' });
    mockBcrypt.compare.mockResolvedValue(false);

    const app = buildApp();

    // Make 5 failed login attempts to trigger the lockout
    for (let i = 0; i < 5; i++) {
      await request(app).post('/auth/login').send(payload);
    }

    // The 6th attempt should be blocked
    const res = await request(app).post('/auth/login').send(payload);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('account_locked');
    expect(res.body.retryAfterSeconds).toBeDefined();
  });
});

describe('POST /api/auth/refresh-token — next(err) error propagation', () => {
  it('propagates unexpected errors via next()', async () => {
    const { rotateSession } = await import('../../lib/session.js');
    (rotateSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('session crash'));

    const app = buildAppWithErrorHandler();
    const res = await request(app)
      .post('/auth/refresh-token')
      .set('Cookie', 'cc_rt=some-token');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('session crash');
  });
});

describe('POST /api/auth/logout — next(err) error propagation', () => {
  it('propagates unexpected errors via next()', async () => {
    const { deleteSession } = await import('../../lib/session.js');
    (deleteSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('redis down'));

    const app = buildAppWithErrorHandler();
    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', 'cc_rt=some-refresh-token');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('redis down');
  });
});

describe('POST /api/auth/change-password — next(err) error propagation', () => {
  it('propagates unexpected errors via next()', async () => {
    mockPrisma.user.findUniqueOrThrow.mockRejectedValue(new Error('DB read failure'));

    const app = buildAppWithErrorHandler();
    const res = await request(app)
      .post('/auth/change-password')
      .set('Authorization', 'Bearer any-token')
      .send({ currentPassword: 'OldPassword1!', newPassword: 'NewPassword123!' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB read failure');
  });
});

describe('GET /api/auth/verify-email — next(err) error propagation', () => {
  it('propagates unexpected errors via next()', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB lookup failure'));

    const app = buildAppWithErrorHandler();
    const res = await request(app)
      .get('/auth/verify-email?token=some-token');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB lookup failure');
  });
});

describe('POST /api/auth/resend-verification — edge cases', () => {
  it('computes lastSent=0 when verifyTokenExp is null (never sent)', async () => {
    // When verifyTokenExp is null, the code takes the path: lastSent = 0
    // which means hoursSinceLast will be large and the rate-limit won't trigger.
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@b.com', firstName: 'A', emailVerifiedAt: null, verifyTokenExp: null,
    });
    mockPrisma.user.update = vi.fn().mockResolvedValue({});
    const { sendEmail } = await import('../../services/email.service.js');

    const app = buildApp();
    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalled();
  });

  it('propagates unexpected errors via next()', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB lookup failure'));

    const app = buildAppWithErrorHandler();
    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB lookup failure');
  });
});

describe('POST /api/auth/forgot-password — next(err) error propagation', () => {
  it('propagates unexpected errors via next()', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB failure'));

    const app = buildAppWithErrorHandler();
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB failure');
  });
});

describe('POST /api/auth/reset-password — next(err) error propagation', () => {
  it('propagates unexpected errors via next()', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB failure'));

    const app = buildAppWithErrorHandler();
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'some-token', newPassword: 'NewPassword123!' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB failure');
  });
});

// ── enqueueEmail with emailQueue present (line 24) ──────────────────────────

describe('POST /api/auth/register — emailQueue path', () => {
  it('enqueues email via emailQueue.add when emailQueue is not null', async () => {
    // Override the emailQueue mock to provide a working queue
    const { emailQueue } = await import('../../queues/index.js');
    const mockAdd = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    (emailQueue as any) ?? undefined; // ensure we can assign
    const queuesMod = await import('../../queues/index.js');
    // Directly mutate the module export for this test
    Object.defineProperty(queuesMod, 'emailQueue', { value: { add: mockAdd }, writable: true });

    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    mockBcrypt.hash.mockResolvedValue('hashed-password');

    const newUser = { id: 'u1', email: 'new@example.com', firstName: 'Alice', lastName: 'Smith', name: 'Alice Smith', role: 'CLIENT', createdAt: new Date() };
    const newOrg = { id: 'org-1', name: 'Acme Law', slug: 'acme-law' };
    mockPrisma.$transaction.mockResolvedValue({ user: newUser, organization: newOrg });

    const app = buildApp();
    const res = await request(app).post('/auth/register').send(validRegisterPayload);
    expect(res.status).toBe(201);
    expect(mockAdd).toHaveBeenCalledWith('send', expect.objectContaining({ to: 'new@example.com' }));

    // Restore emailQueue to null
    Object.defineProperty(queuesMod, 'emailQueue', { value: null, writable: true });
  });
});
