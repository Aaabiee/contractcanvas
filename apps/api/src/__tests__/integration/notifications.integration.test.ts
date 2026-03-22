/**
 * Integration tests for /api/notifications.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';
import { createNotification, createNotifications } from '../../lib/notify.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

/** Directly inserts a notification row for testing. */
async function seedNotification(
  userId: string,
  orgId:  string,
  title:  string,
  readAt?: Date
) {
  return db.notification.create({
    data: {
      userId,
      organizationId: orgId,
      type:           'SYSTEM',
      title,
      readAt:         readAt ?? null,
    },
  });
}

// ─── GET /api/notifications ──────────────────────────────────────────────────
describe('GET /api/notifications', () => {
  it('returns 401 without auth', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });

  it('returns empty list when no notifications exist', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.unreadCount).toBe(0);
  });

  it('returns notifications scoped to the current user', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    await seedNotification(a.userId, a.orgId, 'Hello A');
    await seedNotification(b.userId, b.orgId, 'Hello B');

    const resA = await request(app)
      .get('/api/notifications')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader);

    const resB = await request(app)
      .get('/api/notifications')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(resA.body.data).toHaveLength(1);
    expect(resA.body.data[0].title).toBe('Hello A');
    expect(resB.body.data).toHaveLength(1);
  });

  it('filters to unread when unread=true', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);
    await seedNotification(userId, orgId, 'Unread 1');
    await seedNotification(userId, orgId, 'Already Read', new Date());

    const res = await request(app)
      .get('/api/notifications?unread=true')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Unread 1');
  });

  it('returns correct unreadCount', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);
    await seedNotification(userId, orgId, 'Unread 1');
    await seedNotification(userId, orgId, 'Unread 2');
    await seedNotification(userId, orgId, 'Read One', new Date());

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.total).toBe(3);
    expect(res.body.unreadCount).toBe(2);
  });
});

// ─── PATCH /api/notifications/:id/read ──────────────────────────────────────
describe('PATCH /api/notifications/:id/read', () => {
  it('marks a single notification as read', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);
    const n = await seedNotification(userId, orgId, 'Mark me');

    const res = await request(app)
      .patch(`/api/notifications/${n.id}/read`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.readAt).not.toBeNull();

    const dbRecord = await db.notification.findUnique({ where: { id: n.id } });
    expect(dbRecord!.readAt).not.toBeNull();
  });

  it("returns 404 for a notification that belongs to another user", async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const n = await seedNotification(a.userId, a.orgId, 'For A only');

    const res = await request(app)
      .patch(`/api/notifications/${n.id}/read`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent notification', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .patch('/api/notifications/cuid1234567890abcdefghijk/read')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/notifications/read-all ──────────────────────────────────────
describe('PATCH /api/notifications/read-all', () => {
  it('marks all unread notifications as read and returns count', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);
    await seedNotification(userId, orgId, 'N1');
    await seedNotification(userId, orgId, 'N2');
    await seedNotification(userId, orgId, 'N3 already read', new Date());

    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(2);

    const remaining = await db.notification.count({ where: { userId, readAt: null } });
    expect(remaining).toBe(0);
  });

  it('returns ok: true with updated: 0 when no unread notifications', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
  });
});

// ─── PATCH /api/notifications/:id/read — idempotent (already-read) ─────────
describe('PATCH /api/notifications/:id/read (already-read)', () => {
  it('succeeds when marking an already-read notification as read', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);
    const n = await seedNotification(userId, orgId, 'Already Read', new Date());

    const res = await request(app)
      .patch(`/api/notifications/${n.id}/read`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.readAt).not.toBeNull();
    // readAt should be updated to a new timestamp
    expect(res.body.id).toBe(n.id);
  });

  it('does not change unreadCount when marking an already-read notification', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);
    await seedNotification(userId, orgId, 'Unread One');
    const alreadyRead = await seedNotification(userId, orgId, 'Already Read', new Date());

    // Get unreadCount before
    const before = await request(app)
      .get('/api/notifications')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);
    expect(before.body.unreadCount).toBe(1);

    // Mark the already-read one as read again
    await request(app)
      .patch(`/api/notifications/${alreadyRead.id}/read`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    // unreadCount should remain 1
    const after = await request(app)
      .get('/api/notifications')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);
    expect(after.body.unreadCount).toBe(1);
  });
});

// ─── PATCH /api/notifications/read-all — all already read ──────────────────
describe('PATCH /api/notifications/read-all (all already read)', () => {
  it('returns updated: 0 when all notifications are already read', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);
    await seedNotification(userId, orgId, 'Read 1', new Date());
    await seedNotification(userId, orgId, 'Read 2', new Date());

    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(0);
  });

  it('only marks unread notifications in a mixed set', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);
    await seedNotification(userId, orgId, 'Read', new Date());
    await seedNotification(userId, orgId, 'Unread 1');
    await seedNotification(userId, orgId, 'Unread 2');

    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);

    // Verify all are now read
    const after = await request(app)
      .get('/api/notifications')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(after.body.unreadCount).toBe(0);
    expect(after.body.total).toBe(3);
  });

  it('does not affect other users notifications', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);

    await seedNotification(a.userId, a.orgId, 'A unread');
    await seedNotification(b.userId, b.orgId, 'B unread');

    // User A marks all read
    await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader);

    // User B should still have unread
    const resB = await request(app)
      .get('/api/notifications')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(resB.body.unreadCount).toBe(1);
  });
});

// ─── Error / guard paths ─────────────────────────────────────────────────────
describe('Notifications error/guard paths', () => {
  it('GET supports pagination with limit and offset', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);

    // Seed 5 notifications
    for (let i = 0; i < 5; i++) {
      await seedNotification(userId, orgId, `Paginated ${i}`);
    }

    const page1 = await request(app)
      .get('/api/notifications?limit=2&offset=0')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.total).toBe(5);
    expect(page1.body.limit).toBe(2);
    expect(page1.body.offset).toBe(0);

    const page2 = await request(app)
      .get('/api/notifications?limit=2&offset=2')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(2);
    expect(page2.body.offset).toBe(2);

    // No overlap between pages
    const ids1 = page1.body.data.map((d: { id: string }) => d.id);
    const ids2 = page2.body.data.map((d: { id: string }) => d.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });

  it('PATCH /api/notifications/read-all returns 401 without auth', async () => {
    const res = await request(app).patch('/api/notifications/read-all');
    expect(res.status).toBe(401);
  });

  it('PATCH /api/notifications/:id/read returns 401 without auth', async () => {
    const res = await request(app).patch('/api/notifications/some-id/read');
    expect(res.status).toBe(401);
  });

  it('GET returns correct total and data length', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);

    await seedNotification(userId, orgId, 'N1');
    await seedNotification(userId, orgId, 'N2');
    await seedNotification(userId, orgId, 'N3');

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.total).toBe(3);
  });
});

// ─── lib/notify.ts — createNotification (lines 7-13) ────────────────────────
describe('createNotification (lib/notify.ts)', () => {
  it('creates a notification row in the database and returns it', async () => {
    const { userId, orgId } = await seedAuth(app);

    const notification = await createNotification({
      user:           { connect: { id: userId } },
      organization:   { connect: { id: orgId } },
      type:           'SYSTEM',
      title:          'Test via createNotification',
      body:           'Integration test body',
    });

    expect(notification).toBeDefined();
    expect(notification.id).toBeTruthy();
    expect(notification.userId).toBe(userId);
    expect(notification.title).toBe('Test via createNotification');

    // Verify in DB
    const dbRecord = await db.notification.findUnique({ where: { id: notification.id } });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.type).toBe('SYSTEM');
  });

  it('notification created via createNotification appears in GET /api/notifications', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);

    await createNotification({
      user:           { connect: { id: userId } },
      organization:   { connect: { id: orgId } },
      type:           'SYSTEM',
      title:          'Visible via API',
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Visible via API');
  });
});

// ─── lib/notify.ts — createNotifications (lines 15-23) ──────────────────────
describe('createNotifications (lib/notify.ts)', () => {
  it('creates multiple notifications in bulk', async () => {
    const { userId, orgId } = await seedAuth(app);

    const items = [
      { userId, organizationId: orgId, type: 'SYSTEM' as const, title: 'Bulk 1' },
      { userId, organizationId: orgId, type: 'SYSTEM' as const, title: 'Bulk 2' },
      { userId, organizationId: orgId, type: 'REMINDER' as const, title: 'Bulk 3' },
    ];

    await createNotifications(items);

    const count = await db.notification.count({ where: { userId } });
    expect(count).toBe(3);
  });

  it('is a no-op when items array is empty', async () => {
    await seedAuth(app);

    // Should not throw and not create any rows
    await createNotifications([]);

    const total = await db.notification.count();
    expect(total).toBe(0);
  });

  it('bulk notifications appear in GET /api/notifications', async () => {
    const { authHeader, orgHeader, userId, orgId } = await seedAuth(app);

    await createNotifications([
      { userId, organizationId: orgId, type: 'SYSTEM' as const, title: 'Bulk A' },
      { userId, organizationId: orgId, type: 'SYSTEM' as const, title: 'Bulk B' },
    ]);

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.unreadCount).toBe(2);
  });
});
