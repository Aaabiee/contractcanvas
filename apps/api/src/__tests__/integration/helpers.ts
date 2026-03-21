
import express, { type Express } from 'express';
import request from 'supertest';
import { protect } from '../../middleware/auth.js';
import { router as authRouter }          from '../../routes/auth.js';
import mattersRouter                      from '../../routes/matters.js';
import contractsRouter                    from '../../routes/contracts.js';
import tasksRouter                        from '../../routes/tasks.js';
import commentsRouter                     from '../../routes/comments.js';
import { router as organizationsRouter }  from '../../routes/organizations.js';
import notificationsRouter                from '../../routes/notifications.js';
import clausesRouter                      from '../../routes/clauses.js';
import { router as documentsRouter }      from '../../routes/documents.js';
import { router as billingRouter }        from '../../routes/billing.js';
import searchRouter                        from '../../routes/search.js';
import remindersRouter                     from '../../routes/reminders.js';
import { router as shareLinksRouter, shareTokenRouter } from '../../routes/share-links.js';
import eventsRouter from '../../routes/events.js';
import healthRouter from '../../routes/health.js';
import analyticsRouter from '../../routes/analytics.js';
import usersRouter from '../../routes/users.js';
import apiKeysRouter from '../../routes/api-keys.js';
import webhooksRouter from '../../routes/webhooks.js';
import auditLogsRouter from '../../routes/audit-logs.js';
import { PrismaClient }                   from '@prisma/client';

export function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/auth',          authRouter);
  app.use('/api/matters',       protect, mattersRouter);
  app.use('/api/contracts',     protect, contractsRouter);
  app.use('/api/tasks',         protect, tasksRouter);
  app.use('/api/comments',      protect, commentsRouter);
  app.use('/api/organizations', protect, organizationsRouter);
  app.use('/api/notifications', protect, notificationsRouter);
  app.use('/api/clauses',       protect, clausesRouter);
  app.use('/api/documents',     protect, documentsRouter);
  // billing: /invoice has protect inline; /webhooks/stripe is intentionally public
  app.use('/api/billing', billingRouter);
  app.use('/api/search',     protect, searchRouter);
  app.use('/api/reminders',   protect, remindersRouter);
  app.use('/api/share-links', shareLinksRouter);
  app.use('/api/share',       shareTokenRouter);
  app.use('/api/events',      eventsRouter);
  app.use('/health',                              healthRouter);
  app.use('/api/analytics',                       protect, analyticsRouter);
  app.use('/api/users',                           protect, usersRouter);
  app.use('/api/organizations/:orgId/api-keys',   protect, apiKeysRouter);
  app.use('/api/organizations/:orgId/webhooks',   protect, webhooksRouter);
  app.use('/api/organizations/:orgId/audit-logs', protect, auditLogsRouter);
  return app;
}

const BASE_PAYLOAD = {
  password:        'Password1!',
  confirmPassword: 'Password1!',
  name:            { firstName: 'Test', lastName: 'User' },
  role:            'LAWYER',
  orgMode:         'create',
  acceptTerms:     true,
};

let _counter = 0;
function uid() { return `${Date.now()}-${++_counter}`; }

const _seedDb = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

/** Register a unique user+org, verify their email, and return auth credentials. */
export async function seedAuth(
  app: Express,
  opts?: { email?: string; orgSlug?: string; orgName?: string }
) {
  const id      = uid();
  const email   = opts?.email   ?? `user-${id}@test.example`;
  const orgSlug = opts?.orgSlug ?? `org-${id}`;
  const orgName = opts?.orgName ?? `Org ${id}`;

  const res = await request(app)
    .post('/api/auth/register?autoLogin=1')
    .send({ ...BASE_PAYLOAD, email, organizationSlug: orgSlug, organizationName: orgName });

  if (res.status !== 201) {
    throw new Error(`seedAuth failed ${res.status}: ${JSON.stringify(res.body)}`);
  }

  const userId = res.body.user.id as string;
  const orgId  = res.body.organization.id as string;

  await _seedDb.user.update({
    where: { id: userId },
    data:  { emailVerifiedAt: new Date(), verifyToken: null, verifyTokenExp: null },
  });

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: BASE_PAYLOAD.password });

  if (loginRes.status !== 200) {
    throw new Error(`seedAuth login failed ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
  }

  const token = loginRes.body.token as string;

  return {
    token,
    userId,
    orgId,
    email,
    authHeader: `Bearer ${token}`,
    /** Pass as X-Organization-Id header to activate org context. */
    orgHeader:  orgId,
  };
}

/** Wipe all mutable tables in FK-safe order. */
export async function cleanDb(db: PrismaClient): Promise<void> {
  await db.auditLog.deleteMany();
  await db.outboundWebhookDelivery.deleteMany();
  await db.outboundWebhook.deleteMany();
  await db.subscription.deleteMany();
  await db.apiKey.deleteMany();
  await db.notification.deleteMany();
  await db.comment.deleteMany();
  await db.task.deleteMany();
  await db.contractVersion.deleteMany();
  await db.signatureEnvelope.deleteMany();
  await db.document.deleteMany();
  await db.contract.deleteMany();
  await db.matter.deleteMany();
  await db.clause.deleteMany();
  await db.organizationMember.deleteMany();
  await db.organization.deleteMany();
  await db.user.deleteMany();
}
