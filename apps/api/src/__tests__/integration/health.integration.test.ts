import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, cleanDb } from './helpers.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

afterEach(() => cleanDb(db));
afterAll(() => db.$disconnect());

describe('GET /health', () => {
  it('returns 200 with ok:true and a checks object', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks).toBeDefined();
  });

  it('reports db:ok when connected', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');
    expect(res.body.checks.db).toBe('ok');
  });

  it('includes env field', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');
    expect(typeof res.body.env).toBe('string');
  });
});
