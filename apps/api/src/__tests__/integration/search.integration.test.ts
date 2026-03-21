import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

afterEach(() => cleanDb(db));
afterAll(() => db.$disconnect());

describe('GET /api/search', () => {
  it('returns 401 when unauthenticated', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/search?q=test');
    expect(res.status).toBe(401);
  });

  it('returns 400 when q is missing', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(400);
  });

  it('returns 400 when q is empty string', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search?q=')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(400);
  });

  it('returns empty results for a query that matches nothing', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search?q=xyzzy-nomatch-12345')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.matters).toHaveLength(0);
    expect(res.body.contracts).toHaveLength(0);
    expect(res.body.documents).toHaveLength(0);
  });

  it('finds a matter by title', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    await db.matter.create({
      data: { title: 'Acme Contract Dispute', organizationId: orgId, ownerId: userId },
    });

    const res = await request(app)
      .get('/api/search?q=acme')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.matters).toHaveLength(1);
    expect(res.body.matters[0].title).toBe('Acme Contract Dispute');
    expect(res.body.total).toBe(1);
  });

  it('finds a contract by title', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    const matter = await db.matter.create({
      data: { title: 'Test Matter', organizationId: orgId, ownerId: userId },
    });
    await db.contract.create({
      data: { title: 'NDA with BigCorp', organizationId: orgId, matterId: matter.id },
    });

    const res = await request(app)
      .get('/api/search?q=bigcorp')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0].title).toBe('NDA with BigCorp');
  });

  it('does not return results from another organization', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);
    const { orgId: otherOrgId, userId: otherUserId } = await seedAuth(app);

    await db.matter.create({
      data: { title: 'Secret Matter XYZ', organizationId: otherOrgId, ownerId: otherUserId },
    });

    const res = await request(app)
      .get('/api/search?q=Secret+Matter+XYZ')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.matters).toHaveLength(0);
  });

  it('respects the limit parameter', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        db.matter.create({
          data: { title: `SearchableItem ${i}`, organizationId: orgId, ownerId: userId },
        }),
      ),
    );

    const res = await request(app)
      .get('/api/search?q=SearchableItem&limit=3')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.matters.length).toBeLessThanOrEqual(3);
  });

  it('echoes the q parameter in the response', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search?q=hello')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.q).toBe('hello');
  });
});
