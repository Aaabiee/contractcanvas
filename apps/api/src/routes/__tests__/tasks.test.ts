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
});

describe('GET /api/tasks/:id', () => {
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
});

describe('PATCH /api/tasks/:id', () => {
  it('returns 404 when task not found', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).patch('/task-999').send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('marks task complete when completedAt is set', async () => {
    const now = new Date().toISOString();
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask);
    mockPrisma.task.update.mockResolvedValue({ ...sampleTask, completedAt: new Date(now) });
    const res = await request(buildApp()).patch('/task-1').send({ completedAt: now });
    expect(res.status).toBe(200);
    expect(mockPrisma.task.update).toHaveBeenCalled();
  });

  it('returns 400 for invalid body', async () => {
    const res = await request(buildApp()).patch('/task-1').send({ title: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/tasks/:id', () => {
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
