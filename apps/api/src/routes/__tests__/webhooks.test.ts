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
  outboundWebhook: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  outboundWebhookDelivery: {
    findMany: vi.fn(),
  },
};
vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

const router = (await import('../webhooks.js')).default;

function buildApp(orgId = 'org-1', userId = 'user-1', orgRole = 'OWNER') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: userId, organizationId: orgId, orgRole };
    next();
  });
  app.use('/orgs/:orgId/webhooks', router);
  return app;
}

function buildAppWithRole(orgRole: string) {
  return buildApp('org-1', 'user-1', orgRole);
}

function buildWithErrHandler(orgId = 'org-1', orgRole = 'OWNER') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', organizationId: orgId, orgRole };
    next();
  });
  app.use('/orgs/:orgId/webhooks', router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

const sampleHook = {
  id: 'wh-1',
  url: 'https://example.com/hook',
  events: ['matter.created'],
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/*  requireOrgRole guard                                              */
/* ------------------------------------------------------------------ */
describe('requireOrgRole guard', () => {
  it('returns 403 when orgRole is MEMBER', async () => {
    const app = buildAppWithRole('MEMBER');
    const res = await request(app).get('/orgs/org-1/webhooks');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 403 when orgRole is missing', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: 'user-1', organizationId: 'org-1' };
      next();
    });
    app.use('/orgs/:orgId/webhooks', router);
    const res = await request(app).get('/orgs/org-1/webhooks');
    expect(res.status).toBe(403);
  });

  it('allows OWNER role', async () => {
    mockPrisma.outboundWebhook.findMany.mockResolvedValue([]);
    const app = buildAppWithRole('OWNER');
    const res = await request(app).get('/orgs/org-1/webhooks');
    expect(res.status).toBe(200);
  });

  it('allows ADMIN role', async () => {
    mockPrisma.outboundWebhook.findMany.mockResolvedValue([]);
    const app = buildAppWithRole('ADMIN');
    const res = await request(app).get('/orgs/org-1/webhooks');
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/*  GET /orgs/:orgId/webhooks                                         */
/* ------------------------------------------------------------------ */
describe('GET /orgs/:orgId/webhooks', () => {
  it('returns 403 when orgId does not match user organizationId', async () => {
    mockPrisma.outboundWebhook.findMany.mockResolvedValue([]);
    const app = buildApp('org-1');
    const res = await request(app).get('/orgs/org-other/webhooks');
    expect(res.status).toBe(403);
  });

  it('returns list of webhooks', async () => {
    mockPrisma.outboundWebhook.findMany.mockResolvedValue([sampleHook]);
    const app = buildApp();
    const res = await request(app).get('/orgs/org-1/webhooks');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('wh-1');
  });
});

/* ------------------------------------------------------------------ */
/*  POST /orgs/:orgId/webhooks                                        */
/* ------------------------------------------------------------------ */
describe('POST /orgs/:orgId/webhooks', () => {
  it('returns 403 when orgId does not match', async () => {
    const app = buildApp('org-1');
    const res = await request(app)
      .post('/orgs/org-other/webhooks')
      .send({ url: 'https://example.com/hook', events: ['matter.created'] });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid input (missing url)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ events: ['matter.created'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });

  it('returns 400 for invalid input (empty events)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ url: 'https://example.com/hook', events: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid events', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ url: 'https://example.com/hook', events: ['bogus.event'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid events');
    expect(res.body.details.invalidEvents).toContain('bogus.event');
  });

  it('returns 400 for private IP (127.x.x.x)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ url: 'https://127.0.0.1/hook', events: ['matter.created'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private/i);
  });

  it('returns 400 for private IP (10.x.x.x)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ url: 'https://10.0.0.1/hook', events: ['matter.created'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private/i);
  });

  it('returns 400 for private IP (192.168.x.x)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ url: 'https://192.168.1.1/hook', events: ['matter.created'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private/i);
  });

  it('returns 400 for localhost URL', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ url: 'https://localhost/hook', events: ['matter.created'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private/i);
  });

  it('returns 400 for .local domain', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ url: 'https://myhost.local/hook', events: ['matter.created'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private/i);
  });

  it('returns 400 for .internal domain', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ url: 'https://myhost.internal/hook', events: ['matter.created'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private/i);
  });

  it('returns 400 for malformed URL', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ url: 'not-a-url', events: ['matter.created'] });
    expect(res.status).toBe(400);
  });

  it('creates webhook and returns 201 with secret', async () => {
    mockPrisma.outboundWebhook.create.mockResolvedValue({
      id: 'wh-new',
      url: 'https://example.com/hook',
      events: ['matter.created'],
      isActive: true,
      createdAt: new Date(),
    });
    const app = buildApp();
    const res = await request(app)
      .post('/orgs/org-1/webhooks')
      .send({ url: 'https://example.com/hook', events: ['matter.created'] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('wh-new');
    expect(res.body.secret).toBeDefined();
    expect(res.body.warning).toMatch(/not be shown again/i);
  });

  it('rejects HTTP in production', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const app = buildApp();
      const res = await request(app)
        .post('/orgs/org-1/webhooks')
        .send({ url: 'http://example.com/hook', events: ['matter.created'] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/https/i);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /orgs/:orgId/webhooks/:webhookId                            */
/* ------------------------------------------------------------------ */
describe('PATCH /orgs/:orgId/webhooks/:webhookId', () => {
  it('returns 403 when orgId does not match', async () => {
    const app = buildApp('org-1');
    const res = await request(app)
      .patch('/orgs/org-other/webhooks/wh-1')
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid input', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch('/orgs/org-1/webhooks/wh-1')
      .send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when webhook not found', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .patch('/orgs/org-1/webhooks/wh-999')
      .send({ isActive: false });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Webhook not found');
  });

  it('returns 400 for private URL on update', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(sampleHook);
    const app = buildApp();
    const res = await request(app)
      .patch('/orgs/org-1/webhooks/wh-1')
      .send({ url: 'https://127.0.0.1/hook' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private/i);
  });

  it('returns 400 for invalid events on update', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(sampleHook);
    const app = buildApp();
    const res = await request(app)
      .patch('/orgs/org-1/webhooks/wh-1')
      .send({ events: ['bogus.event'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid events');
  });

  it('updates and returns webhook on success', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(sampleHook);
    const updated = { ...sampleHook, isActive: false };
    mockPrisma.outboundWebhook.update.mockResolvedValue(updated);
    const app = buildApp();
    const res = await request(app)
      .patch('/orgs/org-1/webhooks/wh-1')
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it('rejects HTTP in production on update', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      mockPrisma.outboundWebhook.findFirst.mockResolvedValue(sampleHook);
      const app = buildApp();
      const res = await request(app)
        .patch('/orgs/org-1/webhooks/wh-1')
        .send({ url: 'http://example.com/hook' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/https/i);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});

/* ------------------------------------------------------------------ */
/*  DELETE /orgs/:orgId/webhooks/:webhookId                           */
/* ------------------------------------------------------------------ */
describe('DELETE /orgs/:orgId/webhooks/:webhookId', () => {
  it('returns 403 when orgId does not match', async () => {
    const app = buildApp('org-1');
    const res = await request(app).delete('/orgs/org-other/webhooks/wh-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when webhook not found', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).delete('/orgs/org-1/webhooks/wh-999');
    expect(res.status).toBe(404);
  });

  it('deletes webhook and returns 204', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(sampleHook);
    mockPrisma.outboundWebhook.delete.mockResolvedValue(sampleHook);
    const app = buildApp();
    const res = await request(app).delete('/orgs/org-1/webhooks/wh-1');
    expect(res.status).toBe(204);
    expect(mockPrisma.outboundWebhook.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'wh-1' } })
    );
  });
});

/* ------------------------------------------------------------------ */
/*  GET /orgs/:orgId/webhooks/:webhookId/deliveries                   */
/* ------------------------------------------------------------------ */
describe('GET /orgs/:orgId/webhooks/:webhookId/deliveries', () => {
  it('returns 403 when orgId does not match', async () => {
    const app = buildApp('org-1');
    const res = await request(app).get('/orgs/org-other/webhooks/wh-1/deliveries');
    expect(res.status).toBe(403);
  });

  it('returns 404 when webhook not found', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/orgs/org-1/webhooks/wh-999/deliveries');
    expect(res.status).toBe(404);
  });

  it('returns deliveries on success', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(sampleHook);
    const deliveries = [
      { id: 'd1', event: 'matter.created', statusCode: 200, success: true, attempts: 1, createdAt: new Date() },
    ];
    mockPrisma.outboundWebhookDelivery.findMany.mockResolvedValue(deliveries);
    const app = buildApp();
    const res = await request(app).get('/orgs/org-1/webhooks/wh-1/deliveries');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].event).toBe('matter.created');
  });
});

/* ------------------------------------------------------------------ */
/*  error propagation via next(err)                                   */
/* ------------------------------------------------------------------ */
describe('error propagation via next(err)', () => {
  it('GET / propagates DB errors', async () => {
    mockPrisma.outboundWebhook.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/orgs/org-1/webhooks');
    expect(res.status).toBe(500);
  });

  it('POST / propagates DB errors', async () => {
    mockPrisma.outboundWebhook.create.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler())
      .post('/orgs/org-1/webhooks')
      .send({ url: 'https://example.com/hook', events: ['matter.created'] });
    expect(res.status).toBe(500);
  });

  it('PATCH /:webhookId propagates DB errors', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(sampleHook);
    mockPrisma.outboundWebhook.update.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler())
      .patch('/orgs/org-1/webhooks/wh-1')
      .send({ isActive: false });
    expect(res.status).toBe(500);
  });

  it('DELETE /:webhookId propagates DB errors', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(sampleHook);
    mockPrisma.outboundWebhook.delete.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).delete('/orgs/org-1/webhooks/wh-1');
    expect(res.status).toBe(500);
  });

  it('GET /:webhookId/deliveries propagates DB errors', async () => {
    mockPrisma.outboundWebhook.findFirst.mockResolvedValue(sampleHook);
    mockPrisma.outboundWebhookDelivery.findMany.mockRejectedValue(new Error('DB'));
    const res = await request(buildWithErrHandler()).get('/orgs/org-1/webhooks/wh-1/deliveries');
    expect(res.status).toBe(500);
  });
});
