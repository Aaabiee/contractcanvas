// apps/api/src/server.ts
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import { prisma } from './prisma.js';
import { app as appCfg, DATABASE_URL as pgUrl, db } from './config.js';

// Import all routers from the barrel file
import { auth, matters, contracts, documents, organizations, signatures, billing } from './routes/index.js';
import { protect } from './middleware/auth.js'; // Assuming you have this

const app = express();

// --- Security / basics ---
app.set('trust proxy', true);
app.use(helmet());
app.use(cors()); // Configure CORS options as needed for production
app.use(morgan('dev'));

// --- STRIPE WEBHOOK RAW BODY EXCEPTION ---
app.use('/api/billing/webhooks/stripe', billing); // Mount billing router here FIRST for webhook

// --- Global JSON Parser ---
app.use(express.json({ limit: '20mb' }));

// --- Public Routes ---
app.use('/api/auth', auth);

// Health Check
app.get('/health', (_req, res) => {
  res.json(
    {
      ok: true,
      env: appCfg.env,
      db: { host: db.host, name: db.name },
      comment: 'Everything is looking good!'
    }
  );
});

// HomePage route
app.get('/', (_req, res) => {
  res.status(200).json({ status: 'ok', comment: 'API Home' });
});

const port = Number(process.env.PORT || appCfg.port || 3333);

// --- Protected Routes (Apply auth middleware) ---
app.use('/api/matters', protect, matters);
app.use('/api/contracts', protect, contracts); // Protect contracts routes
app.use('/api/documents', protect, documents);
app.use('/api/organizations', protect, organizations); // Protect org routes
app.use('/api/signatures', protect, signatures); // Protect e-sign routes
// Add protection to specific billing routes if needed (e.g., listing invoices)

// --- 404 Handler ---
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// --- Central Error Handler ---
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[ErrorHandler]', err); // Log the actual error
    const statusCode = (err as any).statusCode || 500;
    res.status(statusCode).json({
      error: (err as any).code || 'internal_error', // Use error code if available
      message: (err instanceof Error) ? err.message : 'An unexpected error occurred',
      detail: appCfg.env !== 'production' ? String(err) : undefined, // Stack trace in dev
    });
  }
);

// --- Server Start & Shutdown ---
const server = app.listen(port, () => {
  console.log(`[API] Server listening on http://localhost:${port} (DB: ${pgUrl.replace(db.password, '****')})`);
});

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  server.close(async () => {
    console.log('HTTP server closed.');
    try {
      await prisma.$disconnect();
      console.log('Prisma disconnected.');
    } catch (e) {
      console.error('Error disconnecting Prisma:', e);
    } finally {
      process.exit(0);
    }
  });
  // Force shutdown if graceful fails after timeout
  setTimeout(() => {
    console.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10000); // 10 seconds
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;