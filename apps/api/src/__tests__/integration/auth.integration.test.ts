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
import { PrismaClient } from '@prisma/client';
import { router as authRouter } from '../../routes/auth.js';

// Direct PrismaClient using the live test database URL set by global setup
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
