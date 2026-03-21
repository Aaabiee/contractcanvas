import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn:              process.env.SENTRY_DSN,
    environment:      process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { pinoHttp } from 'pino-http';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { prisma } from './prisma.js';
import { app as appCfg, db } from './config.js';
import { logger, asyncLocalStorage } from './lib/logger.js';

import { auth, matters, contracts, documents, organizations, signatures, signatureWebhookRouter, billing, tasks, comments, notifications, clauses, search, reminders, shareLinks, shareTokenRouter, events, auditLogs, apiKeys, webhooks, analytics, users } from './routes/index.js';
import healthRouter from './routes/health.js';
import { startReminderScheduler } from './lib/reminder-scheduler.js';
import { protect } from './middleware/auth.js';
import { applySecurityHeaders } from './middleware/security.js';
import { initQueues, getQueues } from './queues/index.js';
import { startEmailWorker } from './queues/email.worker.js';
import { startWebhookWorker } from './queues/webhook.worker.js';
import { startPdfWorker } from './queues/pdf.worker.js';
import { startCleanupWorker } from './queues/cleanup.worker.js';
import { closeBrowser } from './services/pdf.service.js';

const app = express();

app.set('trust proxy', 1);
applySecurityHeaders(app);

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:4200')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  credentials: true,
}));

app.use(pinoHttp({ logger }));
app.use(cookieParser());

app.use((req, _res, next) => {
  const ctx = {
    requestId: req.id as string | undefined,
    userId: req.user?.id,
    organizationId: req.user?.organizationId,
  };
  asyncLocalStorage.run(ctx, () => next());
});

const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'too_many_requests', message: 'Too many requests, please try again later.' },
});

// Only treat the header as a real API key if it matches the expected prefix format.
// This prevents attackers from sending an empty or garbage x-api-key header to
// bypass the stricter per-IP rate limit and land in the more generous API-key bucket.
const API_KEY_RE = /^cc_(live|test)_[a-f0-9]{16,}$/;
const hasValidApiKeyHeader = (req: express.Request): boolean => API_KEY_RE.test(req.header('x-api-key') ?? '');

const apiLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             300,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            hasValidApiKeyHeader,
  message:         { error: 'too_many_requests', message: 'Too many requests, please try again later.' },
});

const apiKeyLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             1000,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => {
    const key = req.header('x-api-key');
    return key ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) : (req.ip ?? 'unknown');
  },
  skip:            (req) => !hasValidApiKeyHeader(req),
  message:         { error: 'too_many_requests', message: 'Too many requests, please try again later.' },
});

app.use('/api/', apiKeyLimiter, apiLimiter);
app.use('/api/billing', billing);

app.use(express.json({ limit: '1mb' }));

const noCacheHeaders: express.RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
};

app.use('/api/auth', authLimiter, noCacheHeaders, auth);

app.use('/health', healthRouter);

app.get('/', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const port = Number(process.env.PORT || appCfg.port || 3333);

const enrichContext: express.RequestHandler = (req, _res, next) => {
  const store = asyncLocalStorage.getStore();
  if (store && req.user) {
    store.userId = req.user.id;
    store.organizationId = req.user.organizationId;
  }
  if (req.user) {
    Sentry.setUser({ id: req.user.id, email: req.user.email });
    Sentry.setTag('organizationId', req.user.organizationId ?? 'none');
  }
  next();
};

app.use('/api/matters',       protect, enrichContext, matters);
app.use('/api/contracts',     protect, enrichContext, contracts);
app.use('/api/documents',     protect, enrichContext, documents);
app.use('/api/organizations', protect, enrichContext, organizations);
app.use('/api/signatures',    protect, enrichContext, signatures);
app.use('/api/signatures/webhook', signatureWebhookRouter);
app.use('/api/tasks',         protect, enrichContext, tasks);
app.use('/api/comments',      protect, enrichContext, comments);
app.use('/api/notifications', protect, enrichContext, notifications);
app.use('/api/clauses',       protect, enrichContext, clauses);
app.use('/api/search',        protect, enrichContext, search);
app.use('/api/reminders',     protect, enrichContext, reminders);
app.use('/api/share-links',   shareLinks);
app.use('/api/share',         shareTokenRouter);
app.use('/api/events',        events);
app.use('/api/analytics',     protect, enrichContext, analytics);
app.use('/api/users',         protect, enrichContext, noCacheHeaders, users);
app.use('/api/organizations/:orgId/api-keys',    protect, enrichContext, noCacheHeaders, apiKeys);
app.use('/api/organizations/:orgId/webhooks',    protect, enrichContext, noCacheHeaders, webhooks);
app.use('/api/organizations/:orgId/audit-logs',  protect, enrichContext, auditLogs);

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

if (process.env.SENTRY_DSN) {
  app.use(Sentry.expressErrorHandler());
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  const statusCode = (err as any).statusCode || 500;
  const isProd = appCfg.env === 'production';
  res.status(statusCode).json({
    error:   (err as any).code || 'internal_error',
    message: isProd ? 'An unexpected error occurred' : (err instanceof Error ? err.message : 'An unexpected error occurred'),
    ...(isProd ? {} : { detail: String(err) }),
  });
});

if (process.env['NODE_ENV'] !== 'test') {
  startReminderScheduler();

  if (process.env['REDIS_URL']) {
    const { initSsePubSub } = await import('./lib/sse-registry.js');
    initSsePubSub();
    initQueues();

    const emailWorker   = startEmailWorker();
    const webhookWorker = startWebhookWorker();
    const pdfWorker     = startPdfWorker();
    const cleanupWorker = startCleanupWorker();

    const { createBullBoard } = await import('@bull-board/api');
    const { BullMQAdapter }   = await import('@bull-board/api/bullMQAdapter');
    const { ExpressAdapter }  = await import('@bull-board/express');

    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
      queues:        getQueues().map(q => new BullMQAdapter(q)),
      serverAdapter,
    });

    const ADMIN_TOKEN = process.env['ADMIN_QUEUE_TOKEN'];
    app.use('/admin/queues', (req, res, next) => {
      if (!ADMIN_TOKEN) { res.status(503).json({ error: 'Queue admin not configured' }); return; }
      if (req.headers['x-admin-token'] !== ADMIN_TOKEN) { res.status(401).json({ error: 'unauthorized' }); return; }
      next();
    }, serverAdapter.getRouter());

    logger.info('BullMQ workers and Bull Board initialized');

    process.on('exit', () => {
      emailWorker?.close();
      webhookWorker?.close();
      pdfWorker?.close();
      cleanupWorker?.close();
    });
  }
}

const server = app.listen(port, () => {
  logger.info({ port, db: { host: db.host, name: db.name } }, 'API server listening');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received');
  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await closeBrowser();
      await prisma.$disconnect();
      logger.info('Prisma disconnected');
    } catch (e) {
      logger.error({ err: e }, 'Error during shutdown cleanup');
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
