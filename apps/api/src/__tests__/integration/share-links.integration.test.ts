import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

afterEach(() => cleanDb(db));
afterAll(() => db.$disconnect());

async function seedContract(orgId: string, userId: string) {
  const matter = await db.matter.create({
    data: { title: 'Test Matter', organizationId: orgId, ownerId: userId },
  });
  return db.contract.create({
    data: { title: 'Test Contract', organizationId: orgId, matterId: matter.id },
  });
}

describe('POST /api/share-links', () => {
  it('returns 401 when unauthenticated', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/share-links').send({});
    expect(res.status).toBe(401);
  });

  it('creates a share link for a contract', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'contract', resourceId: contract.id, role: 'viewer' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.resourceId).toBe(contract.id);
    expect(res.body.role).toBe('viewer');
    expect(res.body.expiresAt).toBeNull();
  });

  it('creates a link with an expiry date', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'contract', resourceId: contract.id, role: 'viewer', expiresAt });

    expect(res.status).toBe(201);
    expect(res.body.expiresAt).toBeTruthy();
  });

  it('returns 400 for invalid resourceType', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'invoice', resourceId: contract.id, role: 'viewer' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when resource belongs to another org', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);
    const { orgId: otherOrgId, userId: otherUserId } = await seedAuth(app);
    const otherContract = await seedContract(otherOrgId, otherUserId);

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'contract', resourceId: otherContract.id, role: 'viewer' });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/share/:token', () => {
  it('returns resource for a valid token', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'contract', resourceId: contract.id, role: 'viewer' });

    const { token } = createRes.body;

    const res = await request(app).get(`/api/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('contract');
    expect(res.body.resource.id).toBe(contract.id);
    expect(res.body.role).toBe('viewer');
  });

  it('returns 404 for unknown token', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/share/unknowntoken123');
    expect(res.status).toBe(404);
  });

  it('returns 410 for an expired link', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const expiresAt = new Date(Date.now() - 1000).toISOString();
    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'contract', resourceId: contract.id, role: 'viewer', expiresAt });

    const { token } = createRes.body;
    const res = await request(app).get(`/api/share/${token}`);
    expect(res.status).toBe(410);
  });
});

describe('DELETE /api/share-links/:id', () => {
  it('deletes a share link', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'contract', resourceId: contract.id, role: 'viewer' });

    const linkId = createRes.body.id as string;

    const res = await request(app)
      .delete(`/api/share-links/${linkId}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(204);
  });

  it('returns 404 for link in another org', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);
    const { orgId: otherOrgId, userId: otherUserId } = await seedAuth(app);
    const otherContract = await seedContract(otherOrgId, otherUserId);

    const link = await db.shareLink.create({
      data: {
        organizationId: otherOrgId,
        resourceType:   'contract',
        resourceId:     otherContract.id,
        token:          'tok-other-org',
        role:           'viewer',
      },
    });

    const res = await request(app)
      .delete(`/api/share-links/${link.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/share-links (list) ────────────────────────────────────────────
describe('GET /api/share-links', () => {
  it('returns 401 when unauthenticated', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/share-links');
    expect(res.status).toBe(401);
  });

  it('lists all share links for the org', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    // Create two links
    await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'contract', resourceId: contract.id, role: 'viewer' });

    await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'contract', resourceId: contract.id, role: 'editor' });

    const res = await request(app)
      .get('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it('returns empty when no share links exist', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('filters by resourceType', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'contract', resourceId: contract.id, role: 'viewer' });

    const res = await request(app)
      .get('/api/share-links?resourceType=contract')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].resourceType).toBe('contract');
  });

  it('does not return share links from another org', async () => {
    const app = buildApp();
    const { authHeader, orgHeader } = await seedAuth(app);
    const { orgId: otherOrgId, userId: otherUserId } = await seedAuth(app);
    const otherContract = await seedContract(otherOrgId, otherUserId);

    await db.shareLink.create({
      data: {
        organizationId: otherOrgId,
        resourceType:   'contract',
        resourceId:     otherContract.id,
        token:          'tok-list-other',
        role:           'viewer',
      },
    });

    const res = await request(app)
      .get('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ─── POST /api/share-links (matter & document resource types) ───────────────
describe('POST /api/share-links (matter & document)', () => {
  it('creates a share link for a matter', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const matter = await db.matter.create({
      data: { title: 'Share Matter', organizationId: orgId, ownerId: userId },
    });

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'matter', resourceId: matter.id, role: 'viewer' });

    expect(res.status).toBe(201);
    expect(res.body.resourceType).toBe('matter');
    expect(res.body.resourceId).toBe(matter.id);
    expect(res.body.token).toBeTruthy();
  });

  it('creates a share link for a document', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const matter = await db.matter.create({
      data: { title: 'Doc Matter', organizationId: orgId, ownerId: userId },
    });
    const doc = await db.document.create({
      data: {
        organizationId: orgId,
        matterId:       matter.id,
        filename:       'shared.pdf',
        storageKey:     'fake/shared.pdf',
        mimeType:       'application/pdf',
        sizeBytes:      200,
      },
    });

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'document', resourceId: doc.id, role: 'commenter' });

    expect(res.status).toBe(201);
    expect(res.body.resourceType).toBe('document');
    expect(res.body.resourceId).toBe(doc.id);
    expect(res.body.role).toBe('commenter');
  });

  it('creates a link with editor role', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const contract = await seedContract(orgId, userId);

    const res = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'contract', resourceId: contract.id, role: 'editor' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('editor');
  });
});

// ─── GET /api/share/:token (matter & document) ─────────────────────────────
describe('GET /api/share/:token (matter & document)', () => {
  it('returns matter resource for a valid token', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const matter = await db.matter.create({
      data: { title: 'Shared Matter', organizationId: orgId, ownerId: userId },
    });

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'matter', resourceId: matter.id, role: 'viewer' });

    const res = await request(app).get(`/api/share/${createRes.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('matter');
    expect(res.body.resource.id).toBe(matter.id);
  });

  it('returns document resource for a valid token', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId, userId } = await seedAuth(app);
    const matter = await db.matter.create({
      data: { title: 'DocShare Matter', organizationId: orgId, ownerId: userId },
    });
    const doc = await db.document.create({
      data: {
        organizationId: orgId,
        matterId:       matter.id,
        filename:       'token-doc.pdf',
        storageKey:     'fake/token-doc.pdf',
        mimeType:       'application/pdf',
        sizeBytes:      100,
      },
    });

    const createRes = await request(app)
      .post('/api/share-links')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ resourceType: 'document', resourceId: doc.id, role: 'viewer' });

    const res = await request(app).get(`/api/share/${createRes.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('document');
    expect(res.body.resource.id).toBe(doc.id);
  });
});
