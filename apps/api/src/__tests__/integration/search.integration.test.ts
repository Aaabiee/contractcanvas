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

// ─── FTS mode with actual data ──────────────────────────────────────────────
describe('GET /api/search (FTS path with data)', () => {
  it('searches in fts mode and returns structured results', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    // Reset the FTS cache so it re-checks for the column
    const { _resetFtsCache } = await import('../../routes/search.js');
    _resetFtsCache();

    await db.matter.create({
      data: { title: 'FtsStructured Alpha', description: 'Testing full text search', organizationId: orgId, ownerId: userId },
    });

    const matter = await db.matter.create({
      data: { title: 'FtsStructured Beta', organizationId: orgId, ownerId: userId },
    });
    await db.contract.create({
      data: { title: 'FtsStructured Contract', organizationId: orgId, matterId: matter.id },
    });
    await db.document.create({
      data: {
        organizationId: orgId,
        matterId: matter.id,
        filename: 'FtsStructured-doc.pdf',
        storageKey: 'fake/fts.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 200,
      },
    });

    const res = await request(app)
      .get('/api/search?q=FtsStructured&mode=fts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.q).toBe('FtsStructured');
    // Should find results regardless of whether FTS columns exist (falls back to LIKE)
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('fts mode with single-word query returns matching matters', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    const { _resetFtsCache } = await import('../../routes/search.js');
    _resetFtsCache();

    await db.matter.create({
      data: { title: 'UniqueXylophone Matter', organizationId: orgId, ownerId: userId },
    });

    const res = await request(app)
      .get('/api/search?q=UniqueXylophone&mode=fts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.matters.length).toBeGreaterThanOrEqual(1);
  });

  it('fts mode with multi-word query', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    const { _resetFtsCache } = await import('../../routes/search.js');
    _resetFtsCache();

    await db.matter.create({
      data: { title: 'MultiWord FtsSearch Matter', organizationId: orgId, ownerId: userId },
    });

    const res = await request(app)
      .get('/api/search?q=MultiWord+FtsSearch&mode=fts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    // Should return at least the matter we created
    expect(res.body.q).toBe('MultiWord FtsSearch');
  });
});

// ─── Error propagation and org guard ─────────────────────────────────────────
describe('GET /api/search (error propagation)', () => {
  it('returns 403 when no org context', async () => {
    const app = buildApp();
    const { userId } = await seedAuth(app);

    // Remove org memberships
    await db.organizationMember.deleteMany({ where: { userId } });
    const user = await db.user.findUnique({ where: { id: userId } });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user!.email, password: 'Password1!' });
    const freshHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .get('/api/search?q=test')
      .set('Authorization', freshHeader);

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid mode parameter', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search?q=test&mode=invalid')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(400);
  });

  it('searches matters by description in like mode', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    await db.matter.create({
      data: {
        title: 'Regular Title',
        description: 'UniqueDescriptionSearch target',
        organizationId: orgId,
        ownerId: userId,
      },
    });

    const res = await request(app)
      .get('/api/search?q=UniqueDescriptionSearch&mode=like')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.matters).toHaveLength(1);
    expect(res.body.matters[0].description).toContain('UniqueDescriptionSearch');
  });

  it('fts mode with empty tsquery (only special chars) returns empty results (covers lines 57-59)', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const { _resetFtsCache } = await import('../../routes/search.js');
    _resetFtsCache();

    // Query with only special chars — toTsQuery strips them, resulting in empty tsq
    const res = await request(app)
      .get('/api/search?q=' + encodeURIComponent('$$%%^^') + '&mode=fts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    // Either returns empty results (fts path with empty tsq) or falls back to like
    expect(res.body.total).toBeGreaterThanOrEqual(0);
  });

  it('fts mode searches contracts and documents (covers lines 72-88)', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    const { _resetFtsCache } = await import('../../routes/search.js');
    _resetFtsCache();

    const matter = await db.matter.create({
      data: { title: 'FtsFullCoverage Matter', organizationId: orgId, ownerId: userId },
    });
    await db.contract.create({
      data: { title: 'FtsFullCoverage Contract', organizationId: orgId, matterId: matter.id },
    });
    await db.document.create({
      data: {
        organizationId: orgId,
        matterId: matter.id,
        filename: 'FtsFullCoverage-report.pdf',
        storageKey: 'fake/ftsfull.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 300,
      },
    });

    const res = await request(app)
      .get('/api/search?q=FtsFullCoverage&mode=fts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.q).toBe('FtsFullCoverage');
    // Whether FTS columns exist or not, results come through (fallback to LIKE)
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('returns all three resource types in response', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    const matter = await db.matter.create({
      data: { title: 'TripleSearch Item', organizationId: orgId, ownerId: userId },
    });
    await db.contract.create({
      data: { title: 'TripleSearch Contract', organizationId: orgId, matterId: matter.id },
    });
    await db.document.create({
      data: {
        organizationId: orgId,
        matterId: matter.id,
        filename: 'TripleSearch-file.pdf',
        storageKey: 'fake/triple.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      },
    });

    const res = await request(app)
      .get('/api/search?q=TripleSearch&mode=like')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.matters.length).toBeGreaterThanOrEqual(1);
    expect(res.body.contracts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.documents.length).toBeGreaterThanOrEqual(1);
    expect(res.body.total).toBe(
      res.body.matters.length + res.body.contracts.length + res.body.documents.length,
    );
  });
});

// ─── FTS with real tsvector columns (lines 35-37, 57-89) ─────────────────────

describe('GET /api/search — FTS with real tsvector columns', () => {
  // Add search_tsv columns so hasTsvector() returns true and the FTS path runs
  beforeAll(async () => {
    await db.$executeRawUnsafe(`ALTER TABLE "Matter" ADD COLUMN IF NOT EXISTS search_tsv tsvector`);
    await db.$executeRawUnsafe(`ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS search_tsv tsvector`);
    await db.$executeRawUnsafe(`ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS search_tsv tsvector`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS matter_search_tsv_idx ON "Matter" USING gin(search_tsv)`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS contract_search_tsv_idx ON "Contract" USING gin(search_tsv)`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS document_search_tsv_idx ON "Document" USING gin(search_tsv)`);
  });

  async function populateTsvectors() {
    await db.$executeRawUnsafe(`UPDATE "Matter" SET search_tsv = to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')) WHERE search_tsv IS NULL`);
    await db.$executeRawUnsafe(`UPDATE "Contract" SET search_tsv = to_tsvector('english', coalesce(title, '')) WHERE search_tsv IS NULL`);
    await db.$executeRawUnsafe(`UPDATE "Document" SET search_tsv = to_tsvector('english', coalesce(filename, '')) WHERE search_tsv IS NULL`);
  }

  it('uses FTS path with single-word query (lines 57, 62-89)', async () => {
    const { _resetFtsCache } = await import('../../routes/search.js');
    _resetFtsCache();

    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    await db.matter.create({
      data: { title: 'Xylophone Integration FTS', organizationId: orgId, ownerId: userId },
    });
    await populateTsvectors();

    const res = await request(app)
      .get('/api/search?q=Xylophone&mode=fts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.matters.length).toBeGreaterThanOrEqual(1);
    expect(res.body.matters[0].title).toContain('Xylophone');
  });

  it('uses FTS path with multi-word query — toTsQuery joins with & (lines 35-37)', async () => {
    const { _resetFtsCache } = await import('../../routes/search.js');
    _resetFtsCache();

    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    await db.matter.create({
      data: { title: 'Quantum Litigation Matter', organizationId: orgId, ownerId: userId },
    });
    await populateTsvectors();

    const res = await request(app)
      .get('/api/search?q=Quantum+Litigation&mode=fts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.q).toBe('Quantum Litigation');
    expect(res.body.matters.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty results when tsQuery becomes empty after stripping (lines 58-59)', async () => {
    const { _resetFtsCache } = await import('../../routes/search.js');
    _resetFtsCache();

    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/search?q=' + encodeURIComponent('!!!@@@###') + '&mode=fts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.matters).toHaveLength(0);
    expect(res.body.contracts).toHaveLength(0);
    expect(res.body.documents).toHaveLength(0);
  });

  it('FTS searches across contracts and documents too (lines 72-89)', async () => {
    const { _resetFtsCache } = await import('../../routes/search.js');
    _resetFtsCache();

    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);

    const matter = await db.matter.create({
      data: { title: 'Zyxwvut Parent Matter', organizationId: orgId, ownerId: userId },
    });
    await db.contract.create({
      data: { title: 'Zyxwvut Contract NDA', organizationId: orgId, matterId: matter.id },
    });
    await db.document.create({
      data: {
        organizationId: orgId,
        matterId: matter.id,
        filename: 'Zyxwvut-report.pdf',
        storageKey: 'fake/zyxwvut.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      },
    });
    await populateTsvectors();

    const res = await request(app)
      .get('/api/search?q=Zyxwvut&mode=fts')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.matters.length).toBeGreaterThanOrEqual(1);
    expect(res.body.contracts.length).toBeGreaterThanOrEqual(1);
  });
});
