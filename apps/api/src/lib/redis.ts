import { Redis } from 'ioredis';

let _client: Redis | null = null;

export function getRedisClient(): Redis | null {
  const url = process.env['REDIS_URL'];
  if (!url) return null;

  if (!_client) {
    _client = new Redis(url, {
      maxRetriesPerRequest: 1,
    });
    _client.on('error', (err: Error) =>
      console.warn('[redis] connection error:', err.message),
    );
  }
  return _client;
}

export async function blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
  const r = getRedisClient();
  if (!r || ttlSeconds <= 0) return;
  await r.set(`bl:${jti}`, '1', 'EX', ttlSeconds);
}

export async function isBlacklisted(jti: string): Promise<boolean> {
  const r = getRedisClient();
  if (!r) return false;
  const val = await r.get(`bl:${jti}`);
  return val !== null;
}

export async function disconnectRedis(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
  }
}
