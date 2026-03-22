import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret-key-for-testing-minimum-32!!';
process.env.NODE_ENV = 'test';

vi.mock('../../config.js', () => ({
  app: { env: 'test', port: 3333 },
  db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
  s3: { region: 'us-east-1', bucket: 'test', forcePathStyle: true },
  stripe: {},
  jwt: { secret: 'test-secret-key-for-testing-minimum-32!!' },
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
}));

const mockPrisma = {
  reminder: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  contract: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const router = (await import('../reminders.js')).default;

function buildApp(orgId = 'org-1', userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: userId, organizationId: orgId };
    next();
  });
  app.use('/', router);
  return app;
}

function buildAppNoOrg() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'user-1' };
    next();
  });
  app.use('/', router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET / ────────────────────────────────────────────────────────────────────

describe('GET /api/reminders', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).get('/');
    expect(res.status).toBe(403);
  });

  it('returns list of reminders', async () => {
    const data = [{ id: 'r1', type: 'DEADLINE', dueAt: new Date() }];
    mockPrisma.$transaction.mockResolvedValue([data, 1]);
    const app = buildApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });
});

// ── POST / ───────────────────────────────────────────────────────────────────

describe('POST /api/reminders', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app)
      .post('/')
      .send({ contractId: 'clxxxxxxxxxxxxxxxxxxxx', type: 'DEADLINE', dueAt: '2026-06-01T00:00:00Z' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid type', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ contractId: 'clxxxxxxxxxxxxxxxxxxxx', type: 'INVALID_TYPE', dueAt: '2026-06-01T00:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 400 for invalid date', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ contractId: 'clxxxxxxxxxxxxxxxxxxxx', type: 'DEADLINE', dueAt: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when contract not found', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ contractId: 'clxxxxxxxxxxxxxxxxxxxx', type: 'DEADLINE', dueAt: '2026-06-01T00:00:00Z' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Contract not found');
  });

  it('creates reminder on success', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx' });
    const reminder = { id: 'r1', type: 'DEADLINE', dueAt: new Date(), contract: { id: 'clxxxxxxxxxxxxxxxxxxxx', title: 'Test' } };
    mockPrisma.reminder.create.mockResolvedValue(reminder);
    const app = buildApp();
    const res = await request(app)
      .post('/')
      .send({ contractId: 'clxxxxxxxxxxxxxxxxxxxx', type: 'DEADLINE', dueAt: '2026-06-01T00:00:00Z' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('r1');
  });
});

// ── PATCH /:id ───────────────────────────────────────────────────────────────

describe('PATCH /api/reminders/:id', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).patch('/r1').send({ type: 'RENEWAL' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid type', async () => {
    const app = buildApp();
    const res = await request(app).patch('/r1').send({ type: 'BAD_TYPE' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when reminder not found', async () => {
    mockPrisma.reminder.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).patch('/r1').send({ type: 'RENEWAL' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Reminder not found');
  });

  it('updates reminder on success', async () => {
    mockPrisma.reminder.findFirst.mockResolvedValue({ id: 'r1', organizationId: 'org-1' });
    const updated = { id: 'r1', type: 'RENEWAL', contract: { id: 'c1', title: 'Test' } };
    mockPrisma.reminder.update.mockResolvedValue(updated);
    const app = buildApp();
    const res = await request(app).patch('/r1').send({ type: 'RENEWAL' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('RENEWAL');
  });

  it('resets sentAt when dueAt is changed', async () => {
    mockPrisma.reminder.findFirst.mockResolvedValue({ id: 'r1', organizationId: 'org-1', sentAt: new Date() });
    const updated = { id: 'r1', dueAt: '2026-07-01T00:00:00Z', sentAt: null, contract: { id: 'c1', title: 'Test' } };
    mockPrisma.reminder.update.mockResolvedValue(updated);
    const app = buildApp();
    const res = await request(app).patch('/r1').send({ dueAt: '2026-07-01T00:00:00Z' });
    expect(res.status).toBe(200);
    expect(mockPrisma.reminder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sentAt: null }),
      }),
    );
  });
});

// ── DELETE /:id ──────────────────────────────────────────────────────────────

describe('DELETE /api/reminders/:id', () => {
  it('returns 403 when no active organization', async () => {
    const app = buildAppNoOrg();
    const res = await request(app).delete('/r1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when reminder not found', async () => {
    mockPrisma.reminder.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).delete('/r1');
    expect(res.status).toBe(404);
  });

  it('deletes reminder and returns 204', async () => {
    mockPrisma.reminder.findFirst.mockResolvedValue({ id: 'r1', organizationId: 'org-1' });
    mockPrisma.reminder.delete.mockResolvedValue({});
    const app = buildApp();
    const res = await request(app).delete('/r1');
    expect(res.status).toBe(204);
  });
});

// ── error propagation via next(err) ──────────────────────────────────────────

describe('error propagation via next(err)', () => {
  function buildWithErrHandler(orgId = 'org-1') {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', organizationId: orgId };
      next();
    });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: err.message });
    });
    return app;
  }

  it('GET / propagates DB errors', async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error('DB error'));
    const res = await request(buildWithErrHandler()).get('/');
    expect(res.status).toBe(500);
  });

  it('POST / propagates DB errors', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'clxxxxxxxxxxxxxxxxxxxx' });
    mockPrisma.reminder.create.mockRejectedValue(new Error('DB error'));
    const res = await request(buildWithErrHandler())
      .post('/')
      .send({ contractId: 'clxxxxxxxxxxxxxxxxxxxx', type: 'DEADLINE', dueAt: '2026-06-01T00:00:00Z' });
    expect(res.status).toBe(500);
  });

  it('PATCH /:id propagates DB errors', async () => {
    mockPrisma.reminder.findFirst.mockResolvedValue({ id: 'r1', organizationId: 'org-1' });
    mockPrisma.reminder.update.mockRejectedValue(new Error('DB error'));
    const res = await request(buildWithErrHandler()).patch('/r1').send({ type: 'RENEWAL' });
    expect(res.status).toBe(500);
  });

  it('DELETE /:id propagates DB errors', async () => {
    mockPrisma.reminder.findFirst.mockResolvedValue({ id: 'r1', organizationId: 'org-1' });
    mockPrisma.reminder.delete.mockRejectedValue(new Error('DB error'));
    const res = await request(buildWithErrHandler()).delete('/r1');
    expect(res.status).toBe(500);
  });
});
