import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.NODE_ENV = 'test';

vi.mock('../../config.js', () => ({
  app: { env: 'test', port: 3333 },
  db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
  s3: { region: 'us-east-1', bucket: 'test', forcePathStyle: true },
  stripe: {},
  jwt: { secret: 'test-secret-key-for-testing' },
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
}));

const mockPrisma = {
  task: {
    findMany:  vi.fn(),
    findFirst: vi.fn(),
    create:    vi.fn(),
    update:    vi.fn(),
    delete:    vi.fn(),
    count:     vi.fn(),
  },
  matter: {
    findFirst: vi.fn(),
  },
  organizationMember: {
    findFirst: vi.fn(),
  },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const { default: router } = await import('../tasks.js');

function buildApp(orgId = 'org-1', userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: userId, organizationId: orgId };
    next();
  });
  app.use('/', router);
  return app;
}

function buildAppNoOrg() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1' };
    next();
  });
  app.use('/', router);
  return app;
}

const sampleTask = {
  id:             'task-1',
  title:          'Draft contract',
  description:    null,
  matterId:       'matter-1',
  organizationId: 'org-1',
  assigneeId:     null,
  dueAt:          null,
  completedAt:    null,
  createdAt:      new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/tasks', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).get('/');
    expect(res.status).toBe(403);
  });

  it('returns paginated tasks for org', async () => {
    mockPrisma.task.findMany.mockResolvedValue([sampleTask]);
    mockPrisma.task.count.mockResolvedValue(1);
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('scopes to organizationId', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.task.count.mockResolvedValue(0);
    await request(buildApp('org-99')).get('/');
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-99' }) })
    );
  });

  it('filters by matterId when provided', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.task.count.mockResolvedValue(0);
    await request(buildApp()).get('/?matterId=matter-5');
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ matterId: 'matter-5' }) })
    );
  });

  it('filters completed tasks when completed=true', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.task.count.mockResolvedValue(0);
    await request(buildApp()).get('/?completed=true');
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ completedAt: { not: null } }) })
    );
  });

  it('filters pending tasks when completed=false', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.task.count.mockResolvedValue(0);
    await request(buildApp()).get('/?completed=false');
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ completedAt: null }) })
    );
  });

  it('filters by assigneeId when provided', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.task.count.mockResolvedValue(0);
    await request(buildApp()).get('/?assigneeId=user-5');
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assigneeId: 'user-5' }) })
    );
  });
});

describe('GET /api/tasks/:id', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).get('/task-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when task not found', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).get('/task-999');
    expect(res.status).toBe(404);
  });

  it('returns task when found', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask);
    const res = await request(buildApp()).get('/task-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('task-1');
  });
});

describe('POST /api/tasks', () => {
  it('returns 403 when no org', async () => {
    const res = await request(buildAppNoOrg()).post('/').send({ title: 'T', matterId: 'cltest1234567890123456789' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing title', async () => {
    const res = await request(buildApp()).post('/').send({ matterId: 'cltest1234567890123456789' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when matter not found in org', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).post('/').send({ title: 'Task', matterId: 'cltest1234567890123456789' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Matter not found/);
  });

  it('creates task with dueAt when provided', async () => {
    const dueAt = '2026-12-31T00:00:00.000Z';
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'matter-1' });
    mockPrisma.task.create.mockResolvedValue({ ...sampleTask, dueAt: new Date(dueAt) });
    const res = await request(buildApp('org-1', 'user-5'))
      .post('/')
      .send({ title: 'Task with due date', matterId: 'cltest1234567890123456789', dueAt });
    expect(res.status).toBe(201);
    expect(mockPrisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dueAt: expect.any(Date) }),
      })
    );
  });

  it('creates task with organizationId', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'matter-1' });
    mockPrisma.task.create.mockResolvedValue({ ...sampleTask, title: 'New Task' });
    const res = await request(buildApp('org-1', 'user-5'))
      .post('/')
      .send({ title: 'New Task', matterId: 'cltest1234567890123456789' });
    expect(res.status).toBe(201);
    expect(mockPrisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', title: 'New Task' }),
      })
    );
  });

  it('returns 400 when assigneeId is not a member of the org (IDOR guard)', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'matter-1' });
    mockPrisma.organizationMember.findFirst.mockResolvedValue(null); // foreign user
    const res = await request(buildApp())
      .post('/')
      .send({ title: 'T', matterId: 'cltest1234567890123456789', assigneeId: 'clforeign1234567890123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a member/i);
  });

  it('creates task with valid assigneeId from same org', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'matter-1' });
    mockPrisma.organizationMember.findFirst.mockResolvedValue({ userId: 'user-2' });
    mockPrisma.task.create.mockResolvedValue({ ...sampleTask, assigneeId: 'user-2' });
    const res = await request(buildApp())
      .post('/')
      .send({ title: 'T', matterId: 'cltest1234567890123456789', assigneeId: 'cltest1234567890123456789' });
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/tasks/:id', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).patch('/task-1').send({ title: 'X' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when task not found', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).patch('/task-999').send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when assigneeId on update is not a member of the org (IDOR guard)', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask);
    mockPrisma.organizationMember.findFirst.mockResolvedValue(null); // foreign user
    const res = await request(buildApp())
      .patch('/task-1')
      .send({ assigneeId: 'clforeign1234567890123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a member/i);
  });

  it('marks task complete when completedAt is set', async () => {
    const now = new Date().toISOString();
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask);
    mockPrisma.task.update.mockResolvedValue({ ...sampleTask, completedAt: new Date(now) });
    const res = await request(buildApp()).patch('/task-1').send({ completedAt: now });
    expect(res.status).toBe(200);
    expect(mockPrisma.task.update).toHaveBeenCalled();
  });

  it('clears completedAt when set to null (reopen)', async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ ...sampleTask, completedAt: new Date() });
    mockPrisma.task.update.mockResolvedValue({ ...sampleTask, completedAt: null });
    const res = await request(buildApp()).patch('/task-1').send({ completedAt: null });
    expect(res.status).toBe(200);
    expect(mockPrisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completedAt: null }) })
    );
  });

  it('updates dueAt when provided as a date string', async () => {
    const dueAt = '2026-12-31T00:00:00.000Z';
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask);
    mockPrisma.task.update.mockResolvedValue({ ...sampleTask, dueAt: new Date(dueAt) });
    const res = await request(buildApp()).patch('/task-1').send({ dueAt });
    expect(res.status).toBe(200);
  });

  it('clears dueAt when set to null', async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ ...sampleTask, dueAt: new Date() });
    mockPrisma.task.update.mockResolvedValue({ ...sampleTask, dueAt: null });
    const res = await request(buildApp()).patch('/task-1').send({ dueAt: null });
    expect(res.status).toBe(200);
    expect(mockPrisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dueAt: null }) })
    );
  });

  it('returns 400 for invalid body', async () => {
    const res = await request(buildApp()).patch('/task-1').send({ title: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('returns 403 when no active organization', async () => {
    const res = await request(buildAppNoOrg()).delete('/task-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when task not found', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).delete('/task-999');
    expect(res.status).toBe(404);
  });

  it('deletes task and returns 204', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask);
    mockPrisma.task.delete.mockResolvedValue(sampleTask);
    const res = await request(buildApp()).delete('/task-1');
    expect(res.status).toBe(204);
    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: 'task-1' } });
  });
});

describe('error propagation via next(err)', () => {
  function buildAppWithErrorHandler(orgId = 'org-1') {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'user-1', organizationId: orgId }; next(); });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: err.message }); });
    return app;
  }

  it('GET / propagates DB errors', async () => {
    mockPrisma.task.findMany.mockRejectedValue(new Error('DB error'));
    const res = await request(buildAppWithErrorHandler()).get('/');
    expect(res.status).toBe(500);
  });

  it('GET /:id propagates DB errors', async () => {
    mockPrisma.task.findFirst.mockRejectedValue(new Error('DB error'));
    const res = await request(buildAppWithErrorHandler()).get('/task-1');
    expect(res.status).toBe(500);
  });

  it('POST / propagates DB errors', async () => {
    mockPrisma.matter.findFirst.mockResolvedValue({ id: 'cltest1234567890123456789' });
    mockPrisma.task.create.mockRejectedValue(new Error('DB error'));
    const res = await request(buildAppWithErrorHandler())
      .post('/')
      .send({ title: 'T', matterId: 'cltest1234567890123456789' });
    expect(res.status).toBe(500);
  });

  it('PATCH /:id propagates DB errors', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask);
    mockPrisma.task.update.mockRejectedValue(new Error('DB error'));
    const res = await request(buildAppWithErrorHandler()).patch('/task-1').send({ title: 'X' });
    expect(res.status).toBe(500);
  });

  it('DELETE /:id propagates DB errors', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask);
    mockPrisma.task.delete.mockRejectedValue(new Error('DB error'));
    const res = await request(buildAppWithErrorHandler()).delete('/task-1');
    expect(res.status).toBe(500);
  });
});
