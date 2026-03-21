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

const mockWriteAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/audit.js', () => ({
  writeAuditLog: mockWriteAuditLog,
}));

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  organizationMember: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  matter: {
    findMany: vi.fn(),
  },
  comment: {
    findMany: vi.fn(),
  },
  notification: {
    findMany: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
  session: {
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const { router } = await import('../users.js');

function buildApp(userId = 'user-1', organizationId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: userId, ...(organizationId ? { organizationId } : {}) };
    next();
  });
  app.use('/', router);
  return app;
}

function buildAppNoUser() {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function buildWithErrHandler(userId = 'user-1', organizationId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: userId, ...(organizationId ? { organizationId } : {}) };
    next();
  });
  app.use('/', router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

const sampleUser = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  role: 'LAWYER',
  emailVerifiedAt: new Date(),
  tosAcceptedAt: new Date(),
  onboardingStep: 'DONE',
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/*  GET /me                                                           */
/* ------------------------------------------------------------------ */
describe('GET /me', () => {
  it('returns 401 when no user on request', async () => {
    const app = buildAppNoUser();
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('returns 404 when user not found in DB', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/me');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('returns user on success', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(sampleUser);
    const app = buildApp();
    const res = await request(app).get('/me');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-1');
    expect(res.body.email).toBe('test@example.com');
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /me                                                         */
/* ------------------------------------------------------------------ */
describe('PATCH /me', () => {
  it('returns 401 when no user on request', async () => {
    const app = buildAppNoUser();
    const res = await request(app).patch('/me').send({ firstName: 'New' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid input (extra fields rejected by passthrough)', async () => {
    const app = buildApp();
    // Zod strict mode: send something that doesn't match schema at all
    const res = await request(app).patch('/me').send({ firstName: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('updates and returns the user on success', async () => {
    const updated = { ...sampleUser, firstName: 'Updated' };
    mockPrisma.user.update.mockResolvedValue(updated);
    const app = buildApp();
    const res = await request(app).patch('/me').send({ firstName: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Updated');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { firstName: 'Updated' },
      })
    );
  });

  it('allows updating multiple fields', async () => {
    const updated = { ...sampleUser, firstName: 'A', lastName: 'B' };
    mockPrisma.user.update.mockResolvedValue(updated);
    const app = buildApp();
    const res = await request(app).patch('/me').send({ firstName: 'A', lastName: 'B' });
    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { firstName: 'A', lastName: 'B' },
      })
    );
  });

  it('allows updating avatarUrl', async () => {
    const updated = { ...sampleUser, avatarUrl: 'https://example.com/img.png' };
    mockPrisma.user.update.mockResolvedValue(updated);
    const app = buildApp();
    const res = await request(app).patch('/me').send({ avatarUrl: 'https://example.com/img.png' });
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /me/onboarding                                              */
/* ------------------------------------------------------------------ */
describe('PATCH /me/onboarding', () => {
  it('returns 401 when no user on request', async () => {
    const app = buildAppNoUser();
    const res = await request(app).patch('/me/onboarding').send({ step: 'DONE' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid step value', async () => {
    const app = buildApp();
    const res = await request(app).patch('/me/onboarding').send({ step: 'INVALID_STEP' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 400 when step is missing', async () => {
    const app = buildApp();
    const res = await request(app).patch('/me/onboarding').send({});
    expect(res.status).toBe(400);
  });

  it('updates onboarding step on success', async () => {
    mockPrisma.user.update.mockResolvedValue({ id: 'user-1', onboardingStep: 'DONE' });
    const app = buildApp();
    const res = await request(app).patch('/me/onboarding').send({ step: 'DONE' });
    expect(res.status).toBe(200);
    expect(res.body.onboardingStep).toBe('DONE');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { onboardingStep: 'DONE' },
      })
    );
  });

  it('accepts all valid onboarding step values', async () => {
    const steps = ['VERIFY_EMAIL', 'CUSTOMIZE_ORG', 'CREATE_MATTER', 'INVITE_MEMBER', 'UPLOAD_DOCUMENT', 'DONE'];
    for (const step of steps) {
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1', onboardingStep: step });
      const app = buildApp();
      const res = await request(app).patch('/me/onboarding').send({ step });
      expect(res.status).toBe(200);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  POST /me/data-export                                              */
/* ------------------------------------------------------------------ */
describe('POST /me/data-export', () => {
  it('returns 401 when no user on request', async () => {
    const app = buildAppNoUser();
    const res = await request(app).post('/me/data-export');
    expect(res.status).toBe(401);
  });

  it('returns data export JSON on success', async () => {
    const memberships = [{ id: 'm1', userId: 'user-1', organization: { name: 'Acme' } }];
    const matters = [{ id: 'mat-1', title: 'Matter 1' }];
    const comments = [{ id: 'c1', body: 'hello' }];
    const notifications = [{ id: 'n1', type: 'INFO' }];
    const tasks = [{ id: 't1', title: 'Task 1' }];

    mockPrisma.user.findUnique.mockResolvedValue(sampleUser);
    mockPrisma.organizationMember.findMany.mockResolvedValue(memberships);
    mockPrisma.matter.findMany.mockResolvedValue(matters);
    mockPrisma.comment.findMany.mockResolvedValue(comments);
    mockPrisma.notification.findMany.mockResolvedValue(notifications);
    mockPrisma.task.findMany.mockResolvedValue(tasks);

    const app = buildApp('user-1');
    const res = await request(app).post('/me/data-export');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.matters).toHaveLength(1);
    expect(res.body.comments).toHaveLength(1);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.headers['content-disposition']).toMatch(/data-export/);
  });

  it('writes audit log when user has organizationId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(sampleUser);
    mockPrisma.organizationMember.findMany.mockResolvedValue([]);
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.comment.findMany.mockResolvedValue([]);
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.task.findMany.mockResolvedValue([]);

    const app = buildApp('user-1', 'org-1');
    await request(app).post('/me/data-export');
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        actorId: 'user-1',
        entity: 'User',
        entityId: 'user-1',
        action: 'DATA_EXPORT',
      })
    );
  });

  it('does not write audit log when user has no organizationId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(sampleUser);
    mockPrisma.organizationMember.findMany.mockResolvedValue([]);
    mockPrisma.matter.findMany.mockResolvedValue([]);
    mockPrisma.comment.findMany.mockResolvedValue([]);
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.task.findMany.mockResolvedValue([]);

    const app = buildApp('user-1'); // no org
    await request(app).post('/me/data-export');
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  DELETE /me                                                        */
/* ------------------------------------------------------------------ */
describe('DELETE /me', () => {
  it('returns 401 when no user on request', async () => {
    const app = buildAppNoUser();
    const res = await request(app).delete('/me').send({ confirm: 'DELETE MY ACCOUNT' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when confirm string is missing', async () => {
    const app = buildApp();
    const res = await request(app).delete('/me').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Confirmation required/);
  });

  it('returns 400 when confirm string is wrong', async () => {
    const app = buildApp();
    const res = await request(app).delete('/me').send({ confirm: 'wrong' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Confirmation required/);
  });

  it('deletes user account and returns ok on success (no org)', async () => {
    mockPrisma.$transaction.mockResolvedValue(undefined);
    const app = buildApp('user-1');
    const res = await request(app).delete('/me').send({ confirm: 'DELETE MY ACCOUNT' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it('writes audit log when user has organizationId', async () => {
    mockPrisma.$transaction.mockResolvedValue(undefined);
    const app = buildApp('user-1', 'org-1');
    const res = await request(app).delete('/me').send({ confirm: 'DELETE MY ACCOUNT' });
    expect(res.status).toBe(200);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        actorId: 'user-1',
        entity: 'User',
        entityId: 'user-1',
        action: 'ACCOUNT_DELETED',
      })
    );
  });
});

/* ------------------------------------------------------------------ */
/*  error propagation via next(err)                                   */
/* ------------------------------------------------------------------ */
describe('error propagation via next(err)', () => {
  it('GET /me propagates DB errors', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/me');
    expect(res.status).toBe(500);
  });

  it('PATCH /me propagates DB errors', async () => {
    mockPrisma.user.update.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).patch('/me').send({ firstName: 'X' });
    expect(res.status).toBe(500);
  });

  it('PATCH /me/onboarding propagates DB errors', async () => {
    mockPrisma.user.update.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).patch('/me/onboarding').send({ step: 'DONE' });
    expect(res.status).toBe(500);
  });

  it('POST /me/data-export propagates DB errors', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).post('/me/data-export');
    expect(res.status).toBe(500);
  });

  it('DELETE /me propagates DB errors', async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler())
      .delete('/me')
      .send({ confirm: 'DELETE MY ACCOUNT' });
    expect(res.status).toBe(500);
  });
});
