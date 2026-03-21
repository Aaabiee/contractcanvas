import http from 'node:http';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

afterEach(() => cleanDb(db));
afterAll(() => db.$disconnect());

function sseGet(
  server: http.Server,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string>; firstChunk: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path, headers },
      res => {
        let firstChunk = '';
        res.once('data', chunk => {
          firstChunk = (chunk as Buffer).toString();
          req.destroy();
        });
        res.once('end', () => resolve({ status: res.statusCode!, headers: res.headers as any, firstChunk }));
        res.once('close', () => resolve({ status: res.statusCode!, headers: res.headers as any, firstChunk }));
      },
    );
    req.on('error', err => { if ((err as any).code === 'ECONNRESET') return; reject(err); });
    req.end();
  });
}

describe('GET /api/events/stream', () => {
  it('returns 401 when unauthenticated', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/events/stream');
    expect(res.status).toBe(401);
  });

  it('returns 200 with text/event-stream and sends initial connected comment', async () => {
    const app = buildApp();
    const { authHeader } = await seedAuth(app);

    const server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));

    try {
      const { status, headers, firstChunk } = await sseGet(server, '/api/events/stream', {
        Authorization: authHeader,
      });

      expect(status).toBe(200);
      expect(headers['content-type']).toMatch(/text\/event-stream/);
      expect(firstChunk).toContain(': connected');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
