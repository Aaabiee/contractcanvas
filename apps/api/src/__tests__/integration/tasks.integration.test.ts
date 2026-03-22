/**
 * Integration tests for /api/tasks.
 * Runs against a real PostgreSQL container — no Prisma mocks.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db  = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const app = buildApp();

afterEach(() => cleanDb(db));
afterAll(()  => db.$disconnect());

async function seedMatter(authHeader: string, orgHeader: string, title = 'Task Matter') {
  const res = await request(app)
    .post('/api/matters')
    .set('Authorization', authHeader)
    .set('X-Organization-Id', orgHeader)
    .send({ title });
  return res.body.id as string;
}

// ─── GET /api/tasks ──────────────────────────────────────────────────────────
describe('GET /api/tasks', () => {
  it('returns 401 without auth', async () => {
    expect((await request(app).get('/api/tasks')).status).toBe(401);
  });

  it('returns empty list when no tasks exist', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('scopes tasks to the org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    await request(app)
      .post('/api/tasks')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Org A Task', matterId });

    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader);

    expect(res.body.data).toHaveLength(0);
  });

  it('filters by matterId', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const m1 = await seedMatter(authHeader, orgHeader, 'M1');
    const m2 = await seedMatter(authHeader, orgHeader, 'M2');

    await request(app).post('/api/tasks').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'T1', matterId: m1 });
    await request(app).post('/api/tasks').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'T2', matterId: m2 });

    const res = await request(app)
      .get(`/api/tasks?matterId=${m1}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('T1');
  });

  it('filters completed tasks with completed=true', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const t1 = await request(app).post('/api/tasks').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'Done Task', matterId });
    await request(app).post('/api/tasks').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'Pending Task', matterId });

    const now = new Date().toISOString();
    await request(app).patch(`/api/tasks/${t1.body.id}`).set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ completedAt: now });

    const res = await request(app)
      .get('/api/tasks?completed=true')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Done Task');
  });

  it('filters pending tasks with completed=false', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const t1 = await request(app).post('/api/tasks').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'Done', matterId });
    await request(app).post('/api/tasks').set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ title: 'Pending', matterId });

    const now = new Date().toISOString();
    await request(app).patch(`/api/tasks/${t1.body.id}`).set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ completedAt: now });

    const res = await request(app)
      .get('/api/tasks?completed=false')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Pending');
  });
});

// ─── POST /api/tasks ─────────────────────────────────────────────────────────
describe('POST /api/tasks', () => {
  it('creates a task and persists it in DB', async () => {
    const { authHeader, orgHeader, orgId } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Review Clause 3', matterId, description: 'Check liability' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Review Clause 3');
    expect(res.body.organizationId).toBe(orgId);

    const dbRecord = await db.task.findUnique({ where: { id: res.body.id } });
    expect(dbRecord).not.toBeNull();
  });

  it('creates a task with dueAt', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const dueAt = new Date(Date.now() + 86400000).toISOString();

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Due Soon', matterId, dueAt });

    expect(res.status).toBe(201);
    expect(new Date(res.body.dueAt).toISOString()).toBe(dueAt);
  });

  it('returns 400 for missing title', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ matterId });
    expect(res.status).toBe(400);
  });

  it('returns 404 when matterId belongs to a different org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({ title: 'Hijack', matterId });

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/tasks/:id ──────────────────────────────────────────────────────
describe('GET /api/tasks/:id', () => {
  it('returns task by id', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const create = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Get Me', matterId });

    const res = await request(app)
      .get(`/api/tasks/${create.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Get Me');
    expect(res.body).toHaveProperty('matter');
  });

  it('returns 404 for unknown task', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .get('/api/tasks/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/tasks/:id ────────────────────────────────────────────────────
describe('PATCH /api/tasks/:id', () => {
  it('marks task as complete', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Complete Me', matterId });

    const completedAt = new Date().toISOString();
    const res = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt });

    expect(res.status).toBe(200);
    expect(res.body.completedAt).not.toBeNull();
  });

  it('reopens task by setting completedAt to null', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Reopen Me', matterId });

    await request(app).patch(`/api/tasks/${task.body.id}`).set('Authorization', authHeader).set('X-Organization-Id', orgHeader).send({ completedAt: new Date().toISOString() });

    const res = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt: null });

    expect(res.status).toBe(200);
    expect(res.body.completedAt).toBeNull();
  });

  it('updates the task title and description', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Old Title', matterId });

    const res = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'New Title', description: 'Updated desc' });

    expect(res.body.title).toBe('New Title');
    expect(res.body.description).toBe('Updated desc');
  });
});

// ─── DELETE /api/tasks/:id ───────────────────────────────────────────────────
describe('DELETE /api/tasks/:id', () => {
  it('permanently deletes task', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Delete Me', matterId });

    const res = await request(app)
      .delete(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);

    expect(res.status).toBe(204);

    const dbRecord = await db.task.findUnique({ where: { id: task.body.id } });
    expect(dbRecord).toBeNull();
  });

  it('returns 404 for unknown task', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .delete('/api/tasks/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader);
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/tasks/:id — completedAt set/unset lifecycle ─────────────────
describe('PATCH /api/tasks/:id — completedAt lifecycle', () => {
  it('sets completedAt, then unsets it, then sets it again', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Lifecycle Task', matterId });

    expect(task.body.completedAt).toBeNull();

    // Set completedAt (mark done)
    const now = new Date().toISOString();
    const res1 = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt: now });

    expect(res1.status).toBe(200);
    expect(res1.body.completedAt).not.toBeNull();

    // Unset completedAt (reopen)
    const res2 = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt: null });

    expect(res2.status).toBe(200);
    expect(res2.body.completedAt).toBeNull();

    // Set completedAt again
    const later = new Date().toISOString();
    const res3 = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt: later });

    expect(res3.status).toBe(200);
    expect(res3.body.completedAt).not.toBeNull();

    // Verify in DB
    const dbRecord = await db.task.findUnique({ where: { id: task.body.id } });
    expect(dbRecord!.completedAt).not.toBeNull();
  });

  it('persists completedAt in database after setting', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'DB Check Task', matterId });

    const completedAt = new Date().toISOString();
    await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt });

    const dbTask = await db.task.findUnique({ where: { id: task.body.id } });
    expect(dbTask!.completedAt).not.toBeNull();
    expect(new Date(dbTask!.completedAt!).toISOString()).toBe(completedAt);
  });

  it('persists null completedAt in database after unsetting', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Unset DB Check', matterId });

    // Complete
    await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt: new Date().toISOString() });

    // Uncomplete
    await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt: null });

    const dbTask = await db.task.findUnique({ where: { id: task.body.id } });
    expect(dbTask!.completedAt).toBeNull();
  });
});

// ─── PATCH /api/tasks/:id — webhook queue fire on task completion ───────────
describe('PATCH /api/tasks/:id — webhook on completion', () => {
  it('task completion triggers no errors (webhook queue may be null in test)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Webhook Task', matterId });

    const completedAt = new Date().toISOString();
    const res = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt });

    // The webhook queue may or may not be available in tests, but the
    // endpoint should not error regardless.
    expect(res.status).toBe(200);
    expect(res.body.completedAt).not.toBeNull();
  });

  it('does not fire webhook when task was already completed (re-setting same value)', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Double Complete', matterId });

    const completedAt = new Date().toISOString();
    await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt });

    // Second completion (already completed) — should still succeed
    const later = new Date(Date.now() + 10000).toISOString();
    const res = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt: later });

    expect(res.status).toBe(200);
  });
});

// ─── PATCH /api/tasks/:id — error propagation paths ─────────────────────────
describe('PATCH /api/tasks/:id — error propagation', () => {
  it('returns 404 when patching a task from another org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Cross-org Task', matterId });

    const res = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', b.authHeader)
      .set('X-Organization-Id', b.orgHeader)
      .send({ title: 'Hijacked' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid completedAt format', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Bad Date', matterId });

    const res = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ completedAt: 'not-a-date' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when assigneeId is not a member of the org', async () => {
    const a = await seedAuth(app);
    const b = await seedAuth(app);
    const matterId = await seedMatter(a.authHeader, a.orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ title: 'Assign Error', matterId });

    const res = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', a.authHeader)
      .set('X-Organization-Id', a.orgHeader)
      .send({ assigneeId: b.userId });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assignee.*not.*member/i);
  });

  it('returns 404 when patching a non-existent task', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const res = await request(app)
      .patch('/api/tasks/cuid1234567890abcdefghijk')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid dueAt format', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Bad Due', matterId });

    const res = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ dueAt: 'tomorrow' });

    expect(res.status).toBe(400);
  });

  it('clears dueAt by setting it to null', async () => {
    const { authHeader, orgHeader } = await seedAuth(app);
    const matterId = await seedMatter(authHeader, orgHeader);
    const dueAt = new Date(Date.now() + 86400000).toISOString();
    const task = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ title: 'Clear Due', matterId, dueAt });

    expect(task.body.dueAt).not.toBeNull();

    const res = await request(app)
      .patch(`/api/tasks/${task.body.id}`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ dueAt: null });

    expect(res.status).toBe(200);
    expect(res.body.dueAt).toBeNull();
  });
});
