/**
 * Integration tests for /api/organizations/:orgId/webhooks.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

function hookUrl(orgId: string, hookId?: string) {
  const base = `/api/organizations/${orgId}/webhooks`;
  return hookId ? `${base}/${hookId}` : base;
}

const VALID_WEBHOOK = {
  url:    'https://example.com/webhook',
  events: ['contract.created', 'matter.updated'],
};

// ─── GET /api/organizations/:orgId/webhooks ──────────────────────────────────
describe('GET /api/organizations/:orgId/webhooks', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/organizations/any/webhooks');
    expect(res.status).toBe(401);
  });

  it('returns 403 for MEMBER role', async () => {
    const { authHeader, orgHeader, userId, email } = await seedAuth(app);

    await db.organizationMember.updateMany({
      where: { userId, organizationId: orgHeader },
      data:  { role: 'MEMBER' },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Password1!' });
    const memberHeader = `Bearer ${loginRes.body.token}`;

    const res = await request(app)
      .get(hookUrl(orgHeader))
      .set('Authorization', memberHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(403);
  });

  it('returns empty list when no webhooks exist', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 403 when requesting webhooks for a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const res = await request(app)
      .get(hookUrl(b.orgHeader))
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/organizations/:orgId/webhooks ─────────────────────────────────
describe('POST /api/organizations/:orgId/webhooks', () => {
  it('creates a webhook with valid URL and events', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    expect(res.status).toBe(201);
    expect(res.body.url).toBe(VALID_WEBHOOK.url);
    expect(res.body.events).toEqual(expect.arrayContaining(VALID_WEBHOOK.events));
    expect(res.body.isActive).toBe(true);
    expect(res.body.secret).toBeDefined();
    expect(res.body.warning).toMatch(/secret.*not.*shown again/i);

    // Verify persisted in DB
    const dbHook = await db.outboundWebhook.findUnique({ where: { id: res.body.id } });
    expect(dbHook).not.toBeNull();
    expect(dbHook!.secret).toBeDefined();
  });

  it('returns 400 for invalid URL', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ url: 'not-a-url', events: ['contract.created'] });

    expect(res.status).toBe(400);
  });

  it('returns 400 for private/internal IP address', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ url: 'https://192.168.1.1/hook', events: ['contract.created'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private|internal/i);
  });

  it('returns 400 for localhost URL', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ url: 'https://localhost/hook', events: ['contract.created'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private|internal/i);
  });

  it('returns 400 for invalid event names', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ url: 'https://example.com/hook', events: ['bogus.event'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Ii]nvalid events/);
    expect(res.body.details.invalidEvents).toContain('bogus.event');
  });

  it('returns 400 for empty events array', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ url: 'https://example.com/hook', events: [] });

    expect(res.status).toBe(400);
  });

  it('created webhook appears in GET list', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const listRes = await request(app)
      .get(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].url).toBe(VALID_WEBHOOK.url);
  });
});

// ─── PATCH /api/organizations/:orgId/webhooks/:webhookId ─────────────────────
describe('PATCH /api/organizations/:orgId/webhooks/:webhookId', () => {
  it('updates webhook URL', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .patch(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ url: 'https://new-endpoint.example.com/hook' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://new-endpoint.example.com/hook');
  });

  it('updates webhook events', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .patch(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ events: ['document.uploaded'] });

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual(['document.uploaded']);
  });

  it('deactivates a webhook', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .patch(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it('returns 404 for non-existent webhook', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .patch(hookUrl(orgHeader, 'cuid1234567890abcdefghijk'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ isActive: false });

    expect(res.status).toBe(404);
  });

  it('returns 400 for private URL on update', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .patch(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ url: 'https://10.0.0.1/hook' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private|internal/i);
  });
});

// ─── DELETE /api/organizations/:orgId/webhooks/:webhookId ────────────────────
describe('DELETE /api/organizations/:orgId/webhooks/:webhookId', () => {
  it('deletes a webhook', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .delete(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(204);

    // Verify deleted from DB
    const dbHook = await db.outboundWebhook.findUnique({ where: { id: webhookId } });
    expect(dbHook).toBeNull();
  });

  it('returns 404 for non-existent webhook', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .delete(hookUrl(orgHeader, 'cuid1234567890abcdefghijk'))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns 403 when deleting a webhook from a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(a.orgHeader))
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .delete(hookUrl(a.orgHeader, webhookId))
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/organizations/:orgId/webhooks/:webhookId/deliveries ────────────
describe('GET /api/organizations/:orgId/webhooks/:webhookId/deliveries', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/organizations/any/webhooks/any/deliveries');
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent webhook', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const res = await request(app)
      .get(hookUrl(orgHeader, 'cuid1234567890abcdefghijk') + '/deliveries')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns empty deliveries list for a new webhook', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .get(hookUrl(orgHeader, webhookId) + '/deliveries')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns deliveries seeded in the DB', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    // Seed deliveries directly in the DB
    await db.outboundWebhookDelivery.createMany({
      data: [
        { webhookId, event: 'contract.created', payload: {}, statusCode: 200, success: true,  attempts: 1 },
        { webhookId, event: 'matter.updated',   payload: {}, statusCode: 500, success: false, attempts: 3 },
      ],
    });

    const res = await request(app)
      .get(hookUrl(orgHeader, webhookId) + '/deliveries')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    const delivery = res.body.data.find((d: { event: string }) => d.event === 'contract.created');
    expect(delivery).toBeDefined();
    expect(delivery.statusCode).toBe(200);
    expect(delivery.success).toBe(true);
    expect(delivery.attempts).toBe(1);
  });
});

// ─── PATCH — combined URL and events change ─────────────────────────────────
describe('PATCH /api/organizations/:orgId/webhooks/:webhookId (combined changes)', () => {
  it('updates URL and events in a single PATCH request', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .patch(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        url:    'https://updated-hook.example.com/v2',
        events: ['document.uploaded', 'signature.completed'],
      });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://updated-hook.example.com/v2');
    expect(res.body.events).toEqual(['document.uploaded', 'signature.completed']);
  });

  it('updates URL, events, and isActive simultaneously', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .patch(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({
        url:      'https://all-in-one.example.com/hook',
        events:   ['task.completed'],
        isActive: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://all-in-one.example.com/hook');
    expect(res.body.events).toEqual(['task.completed']);
    expect(res.body.isActive).toBe(false);
  });
});

// ─── PATCH — toggle isActive ────────────────────────────────────────────────
describe('PATCH /api/organizations/:orgId/webhooks/:webhookId (toggle isActive)', () => {
  it('deactivates and reactivates a webhook', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;
    expect(createRes.body.isActive).toBe(true);

    // Deactivate
    const deactivate = await request(app)
      .patch(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ isActive: false });

    expect(deactivate.status).toBe(200);
    expect(deactivate.body.isActive).toBe(false);

    // Reactivate
    const reactivate = await request(app)
      .patch(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ isActive: true });

    expect(reactivate.status).toBe(200);
    expect(reactivate.body.isActive).toBe(true);

    // Verify in DB
    const dbHook = await db.outboundWebhook.findUnique({ where: { id: webhookId } });
    expect(dbHook!.isActive).toBe(true);
  });
});

// ─── PATCH — invalid events on update ───────────────────────────────────────
describe('PATCH /api/organizations/:orgId/webhooks/:webhookId (invalid events)', () => {
  it('returns 400 for invalid event names on update', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .patch(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ events: ['not.a.valid.event'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Ii]nvalid events/);
    expect(res.body.details.invalidEvents).toContain('not.a.valid.event');
  });

  it('returns 400 for invalid body schema on update', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .patch(hookUrl(orgHeader, webhookId))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ url: 'not-a-valid-url' });

    expect(res.status).toBe(400);
  });
});

// ─── PATCH — cross-org isolation ────────────────────────────────────────────
describe('PATCH /api/organizations/:orgId/webhooks/:webhookId (cross-org)', () => {
  it('returns 403 when patching a webhook from a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(a.orgHeader))
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .patch(hookUrl(a.orgHeader, webhookId))
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({ isActive: false });

    expect(res.status).toBe(403);
  });
});

// ─── Deliveries — cross-org isolation ───────────────────────────────────────
describe('GET /api/organizations/:orgId/webhooks/:webhookId/deliveries (cross-org)', () => {
  it('returns 403 when requesting deliveries from a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(a.orgHeader))
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    const res = await request(app)
      .get(hookUrl(a.orgHeader, webhookId) + '/deliveries')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(403);
  });
});

// ─── Deliveries — with seeded data and pagination ───────────────────────────
describe('GET /api/organizations/:orgId/webhooks/:webhookId/deliveries (seeded data)', () => {
  it('returns deliveries with correct fields', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);

    const createRes = await request(app)
      .post(hookUrl(orgHeader))
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send(VALID_WEBHOOK);

    const webhookId = createRes.body.id;

    await db.outboundWebhookDelivery.createMany({
      data: [
        { webhookId, event: 'contract.created', payload: { contractId: 'c1' }, statusCode: 200, success: true,  attempts: 1 },
        { webhookId, event: 'matter.updated',   payload: { matterId: 'm1' },   statusCode: 500, success: false, attempts: 3 },
        { webhookId, event: 'document.uploaded', payload: { docId: 'd1' },      statusCode: 200, success: true,  attempts: 1 },
      ],
    });

    const res = await request(app)
      .get(hookUrl(orgHeader, webhookId) + '/deliveries')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);

    // Verify each delivery has expected fields
    for (const delivery of res.body.data) {
      expect(delivery).toHaveProperty('id');
      expect(delivery).toHaveProperty('event');
      expect(delivery).toHaveProperty('statusCode');
      expect(delivery).toHaveProperty('success');
      expect(delivery).toHaveProperty('attempts');
      expect(delivery).toHaveProperty('createdAt');
    }

    // Verify failed delivery
    const failed = res.body.data.find((d: { event: string }) => d.event === 'matter.updated');
    expect(failed).toBeDefined();
    expect(failed.statusCode).toBe(500);
    expect(failed.success).toBe(false);
    expect(failed.attempts).toBe(3);
  });
});

// ─── POST — creating webhook for a different org returns 403 ────────────────
describe('POST /api/organizations/:orgId/webhooks (cross-org)', () => {
  it('returns 403 when creating a webhook for a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    const res = await request(app)
      .post(hookUrl(b.orgHeader))
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send(VALID_WEBHOOK);

    expect(res.status).toBe(403);
  });
});
