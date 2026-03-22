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
  notification: {
    findMany:    vi.fn(),
    findFirst:   vi.fn(),
    update:      vi.fn(),
    updateMany:  vi.fn(),
    count:       vi.fn(),
  },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const { default: router } = await import('../notifications.js');

function buildApp(userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: userId, organizationId: 'org-1' };
    next();
  });
  app.use('/', router);
  return app;
}

const sampleNotification = {
  id:             'notif-1',
  userId:         'user-1',
  organizationId: 'org-1',
  type:           'SYSTEM',
  title:          'Contract updated',
  body:           null,
  data:           null,
  readAt:         null,
  createdAt:      new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/notifications', () => {
  it('returns paginated notifications for user', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([sampleNotification]);
    mockPrisma.notification.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(typeof res.body.unreadCount).toBe('number');
  });

  it('filters to unread when unread=true', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);
    await request(buildApp()).get('/?unread=true');
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1', readAt: null }),
      })
    );
  });

  it('scopes to logged-in userId', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);
    await request(buildApp('user-42')).get('/');
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-42' }) })
    );
  });
});

describe('PATCH /api/notifications/read-all', () => {
  it('marks all unread notifications as read', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });
    const res = await request(buildApp()).patch('/read-all');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(3);
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', readAt: null },
      data:  { readAt: expect.any(Date) },
    });
  });
});

describe('PATCH /api/notifications/:id/read', () => {
  it('returns 404 when notification not found', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(null);
    const res = await request(buildApp()).patch('/notif-999/read');
    expect(res.status).toBe(404);
  });

  it('marks single notification as read', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(sampleNotification);
    mockPrisma.notification.update.mockResolvedValue({ ...sampleNotification, readAt: new Date() });
    const res = await request(buildApp()).patch('/notif-1/read');
    expect(res.status).toBe(200);
    expect(mockPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'notif-1' },
      data:  { readAt: expect.any(Date) },
    });
  });
});

describe('error propagation via next(err)', () => {
  function buildAppWithErrorHandler() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'user-1' }; next(); });
    app.use('/', router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: err.message });
    });
    return app;
  }

  it('GET / propagates DB errors to next(err)', async () => {
    mockPrisma.notification.findMany.mockRejectedValue(new Error('DB failure'));
    const res = await request(buildAppWithErrorHandler()).get('/');
    expect(res.status).toBe(500);
  });

  it('PATCH /read-all propagates DB errors to next(err)', async () => {
    mockPrisma.notification.updateMany.mockRejectedValue(new Error('DB failure'));
    const res = await request(buildAppWithErrorHandler()).patch('/read-all');
    expect(res.status).toBe(500);
  });

  it('PATCH /:id/read propagates DB errors to next(err)', async () => {
    mockPrisma.notification.findFirst.mockRejectedValue(new Error('DB failure'));
    const res = await request(buildAppWithErrorHandler()).patch('/notif-1/read');
    expect(res.status).toBe(500);
  });
});
