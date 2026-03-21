import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { prisma } from './prisma.js';
import { app as appCfg, db } from './config.js';
import { logger } from './lib/logger.js';

import { auth, matters, contracts, documents, organizations, signatures, billing, tasks, comments, notifications, clauses, search, reminders, shareLinks, shareTokenRouter, events } from './routes/index.js';
import healthRouter from './routes/health.js';
import { startReminderScheduler } from './lib/reminder-scheduler.js';
import { protect } from './middleware/auth.js';
import { applySecurityHeaders } from './middleware/security.js';

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

const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'too_many_requests', message: 'Too many requests, please try again later.' },
});

const apiLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             300,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'too_many_requests', message: 'Too many requests, please try again later.' },
});

app.use('/api/', apiLimiter);
app.use('/api/billing', billing);

app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', authLimiter, auth);

app.use('/health', healthRouter);

app.get('/', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const port = Number(process.env.PORT || appCfg.port || 3333);

app.use('/api/matters',       protect, matters);
app.use('/api/contracts',     protect, contracts);
app.use('/api/documents',     protect, documents);
app.use('/api/organizations', protect, organizations);
app.use('/api/signatures',    protect, signatures);
app.use('/api/tasks',         protect, tasks);
app.use('/api/comments',      protect, comments);
app.use('/api/notifications', protect, notifications);
app.use('/api/clauses',       protect, clauses);
app.use('/api/search',        protect, search);
app.use('/api/reminders',     protect, reminders);
app.use('/api/share-links',   shareLinks);
app.use('/api/share',         shareTokenRouter);
app.use('/api/events',        events);

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  const statusCode = (err as any).statusCode || 500;
  res.status(statusCode).json({
    error:   (err as any).code || 'internal_error',
    message: err instanceof Error ? err.message : 'An unexpected error occurred',
    detail:  appCfg.env !== 'production' ? String(err) : undefined,
  });
});

if (process.env['NODE_ENV'] !== 'test') {
  startReminderScheduler();
}

const server = app.listen(port, () => {
  logger.info({ port, db: { host: db.host, name: db.name } }, 'API server listening');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received');
  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await prisma.$disconnect();
      logger.info('Prisma disconnected');
    } catch (e) {
      logger.error({ err: e }, 'Error disconnecting Prisma');
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
