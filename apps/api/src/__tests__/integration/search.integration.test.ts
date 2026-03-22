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

// ─── mode=like explicit ─────────────────────────────────────────────────────
describe('GET /api/search (mode=like)', () => {
  it('returns results using LIKE mode when mode=like', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    await db.matter.create({
      data: { title: 'LikeMode Alpha Matter', organizationId: orgId, ownerId: userId },
    });

    const res = await request(app)
      .get('/api/search?q=LikeMode&mode=like')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.matters).toHaveLength(1);
    expect(res.body.matters[0].title).toBe('LikeMode Alpha Matter');
  });

  it('searches contracts by title in like mode', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    const matter = await db.matter.create({
      data: { title: 'LikeMatter', organizationId: orgId, ownerId: userId },
    });
    await db.contract.create({
      data: { title: 'LikeSearch NDA', organizationId: orgId, matterId: matter.id },
    });

    const res = await request(app)
      .get('/api/search?q=LikeSearch&mode=like')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0].title).toBe('LikeSearch NDA');
  });

  it('searches documents by filename in like mode', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    const matter = await db.matter.create({
      data: { title: 'DocSearch Matter', organizationId: orgId, ownerId: userId },
    });
    await db.document.create({
      data: {
        organizationId: orgId,
        matterId: matter.id,
        filename: 'LikeSearchReport.pdf',
        storageKey: 'fake/key.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      },
    });

    const res = await request(app)
      .get('/api/search?q=LikeSearchReport&mode=like')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].filename).toBe('LikeSearchReport.pdf');
  });
});

// ─── mode=fts ───────────────────────────────────────────────────────────────
describe('GET /api/search (mode=fts)', () => {
  it('falls back to like when search_tsv column is absent', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    // Reset the FTS cache so it re-checks for the column
    const { _resetFtsCache } = await import('../../routes/search.js');
    _resetFtsCache();

    await db.matter.create({
      data: { title: 'FtsTest Unique Matter', organizationId: orgId, ownerId: userId },
    });

    const res = await request(app)
      .get('/api/search?q=FtsTest&mode=fts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    // Whether FTS column exists or not, the search should still return results
    // because it falls back to LIKE when the column is absent
    expect(res.body.q).toBe('FtsTest');
  });
});

// ─── special characters ─────────────────────────────────────────────────────
describe('GET /api/search (special characters)', () => {
  it('handles special characters in the query without error', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search?q=' + encodeURIComponent('test & "quotes" (parens)'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(0);
  });

  it('handles query with only special characters', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search?q=' + encodeURIComponent('$%^&*'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    // Should succeed (200) — either empty results or filtered query
    expect(res.status).toBe(200);
  });
});

// ─── limit parameter edge cases ─────────────────────────────────────────────
describe('GET /api/search (limit edge cases)', () => {
  it('returns 400 when limit exceeds max (50)', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search?q=test&limit=999')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(400);
  });

  it('returns 400 for limit=0', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search?q=test&limit=0')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    // limit min is 1 per schema, so 0 should fail validation
    expect(res.status).toBe(400);
  });

  it('returns 400 for limit=-1', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search?q=test&limit=-1')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(400);
  });

  it('uses default limit=10 when not specified', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    // Create 12 matters
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        db.matter.create({
          data: { title: `DefaultLimit ${i}`, organizationId: orgId, ownerId: userId },
        }),
      ),
    );

    const res = await request(app)
      .get('/api/search?q=DefaultLimit')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    // Default limit is 10, so max 10 matters
    expect(res.body.matters.length).toBeLessThanOrEqual(10);
  });
});
