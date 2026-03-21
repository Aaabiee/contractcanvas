import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';
import { disconnectRedis } from '../../lib/redis.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

afterEach(() => cleanDb(db));
afterAll(async () => {
  await db.$disconnect();
  await disconnectRedis();
});

describe('POST /api/auth/logout — token blacklist', () => {
  it('invalidates the access token after logout', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', authHeader)
      .expect(200, { ok: true });

    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/revoked/i);
  });

  it('allows a new token obtained after logout', async () => {
    const app = buildApp();
    const { email, orgHeader } = await seedAuth(app);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Password1!' })
      .expect(200);

    const firstToken = `Bearer ${loginRes.body.token as string}`;

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', firstToken)
      .expect(200);

    const loginRes2 = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Password1!' })
      .expect(200);

    const secondToken = `Bearer ${loginRes2.body.token as string}`;

    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', secondToken)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
  });

  it('logout without Authorization header still succeeds', async () => {
    const app = buildApp();
    await seedAuth(app);

    const res = await request(app)
      .post('/api/auth/logout')
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('logout with a malformed token still succeeds', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer not.a.valid.token')
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('protected route still works before logout', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
  });
});
