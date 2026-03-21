import type { Response } from 'express';
import { Redis } from 'ioredis';
import { logger } from './logger.js';

const clients = new Map<string, Set<Response>>();
const SSE_CHANNEL = 'sse:notifications';

let pub: Redis | null = null;
let sub: Redis | null = null;

export function initSsePubSub(): void {
  const url = process.env['REDIS_URL'];
  if (!url) return;

  pub = new Redis(url, { maxRetriesPerRequest: 1 });
  sub = new Redis(url, { maxRetriesPerRequest: 1 });

  pub.on('error', (err: Error) => logger.warn({ err: err.message }, 'SSE pub Redis error'));
  sub.on('error', (err: Error) => logger.warn({ err: err.message }, 'SSE sub Redis error'));

  sub.subscribe(SSE_CHANNEL).catch(err =>
    logger.error({ err }, 'Failed to subscribe to SSE channel'),
  );

  sub.on('message', (_channel: string, message: string) => {
    try {
      const { userId, event, data } = JSON.parse(message);
      writeToLocalClients(userId, event, data);
    } catch {
      logger.warn('Invalid SSE pub/sub message');
    }
  });

  logger.info('SSE Redis Pub/Sub bridge initialized');
}

export function addClient(userId: string, res: Response): void {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(res);
}

export function removeClient(userId: string, res: Response): void {
  clients.get(userId)?.delete(res);
  if (clients.get(userId)?.size === 0) clients.delete(userId);
}

function writeToLocalClients(userId: string, event: string, data: unknown): void {
  const conns = clients.get(userId);
  if (!conns?.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of conns) {
    try { res.write(payload); } catch { removeClient(userId, res); }
  }
}

export function pushToUser(userId: string, event: string, data: unknown): void {
  if (pub) {
    pub.publish(SSE_CHANNEL, JSON.stringify({ userId, event, data })).catch(() => {});
    return;
  }
  writeToLocalClients(userId, event, data);
}

export function connectedUserCount(): number {
  return clients.size;
}

export async function closeSsePubSub(): Promise<void> {
  if (sub) { sub.unsubscribe(); await sub.quit(); sub = null; }
  if (pub) { await pub.quit(); pub = null; }
}
