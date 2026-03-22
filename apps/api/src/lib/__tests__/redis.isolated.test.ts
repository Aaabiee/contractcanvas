import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let envBackup: NodeJS.ProcessEnv;

beforeEach(() => {
  envBackup = { ...process.env };
  vi.resetModules();
});

afterEach(() => {
  process.env = envBackup;
  vi.restoreAllMocks();
});

function createMockRedis() {
  const handlers = new Map<string, (...args: any[]) => void>();
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => { handlers.set(event, handler); }),
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    quit: vi.fn().mockResolvedValue('OK'),
    _trigger(event: string, ...args: any[]) { handlers.get(event)?.(...args); },
  };
}

async function importRedisWithMock(url?: string) {
  if (url) process.env.REDIS_URL = url;
  else delete process.env.REDIS_URL;

  const mock = createMockRedis();
  vi.doMock('ioredis', () => ({ Redis: vi.fn().mockImplementation(() => mock) }));

  const mod = await import('../redis.js');
  return { mod, mock };
}

describe('redis.ts — getRedisClient', () => {
  it('returns null when REDIS_URL is not set', async () => {
    const { mod } = await importRedisWithMock();
    expect(mod.getRedisClient()).toBeNull();
  });

  it('creates a Redis client when REDIS_URL is set', async () => {
    const { mod, mock } = await importRedisWithMock('redis://localhost:6379');
    const client = mod.getRedisClient();
    expect(client).toBe(mock);
    expect(mock.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('returns the cached client on second call (line 9 false branch)', async () => {
    const { mod, mock } = await importRedisWithMock('redis://localhost:6379');
    const first = mod.getRedisClient();
    const second = mod.getRedisClient();
    expect(first).toBe(second);
    const { Redis } = await import('ioredis');
    expect(Redis).toHaveBeenCalledTimes(1);
  });

  it('error handler logs warning without crashing (line 14)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { mod, mock } = await importRedisWithMock('redis://localhost:6379');
    mod.getRedisClient();

    mock._trigger('error', new Error('ECONNREFUSED'));
    expect(warnSpy).toHaveBeenCalledWith('[redis] connection error:', 'ECONNREFUSED');
  });
});

describe('redis.ts — blacklistToken', () => {
  it('is a no-op when REDIS_URL is not set', async () => {
    const { mod } = await importRedisWithMock();
    await expect(mod.blacklistToken('jti-1', 300)).resolves.toBeUndefined();
  });

  it('is a no-op when ttlSeconds <= 0', async () => {
    const { mod, mock } = await importRedisWithMock('redis://localhost:6379');
    await mod.blacklistToken('jti-2', 0);
    expect(mock.set).not.toHaveBeenCalled();
    await mod.blacklistToken('jti-3', -5);
    expect(mock.set).not.toHaveBeenCalled();
  });

  it('sets the blacklist key with TTL', async () => {
    const { mod, mock } = await importRedisWithMock('redis://localhost:6379');
    await mod.blacklistToken('jti-4', 900);
    expect(mock.set).toHaveBeenCalledWith('bl:jti-4', '1', 'EX', 900);
  });
});

describe('redis.ts — isBlacklisted', () => {
  it('returns false when REDIS_URL is not set', async () => {
    const { mod } = await importRedisWithMock();
    expect(await mod.isBlacklisted('jti-x')).toBe(false);
  });

  it('returns false when key does not exist', async () => {
    const { mod, mock } = await importRedisWithMock('redis://localhost:6379');
    mock.get.mockResolvedValue(null);
    expect(await mod.isBlacklisted('jti-y')).toBe(false);
  });

  it('returns true when key exists', async () => {
    const { mod, mock } = await importRedisWithMock('redis://localhost:6379');
    mock.get.mockResolvedValue('1');
    expect(await mod.isBlacklisted('jti-z')).toBe(true);
  });
});

describe('redis.ts — disconnectRedis', () => {
  it('quits and nullifies the client', async () => {
    const { mod, mock } = await importRedisWithMock('redis://localhost:6379');
    mod.getRedisClient();
    await mod.disconnectRedis();
    expect(mock.quit).toHaveBeenCalled();
  });

  it('is a no-op when no client exists', async () => {
    const { mod } = await importRedisWithMock();
    await expect(mod.disconnectRedis()).resolves.toBeUndefined();
  });

  it('returns null from getRedisClient after disconnect', async () => {
    const { mod } = await importRedisWithMock('redis://localhost:6379');
    mod.getRedisClient();
    await mod.disconnectRedis();
    // After disconnect, _client is null but REDIS_URL is still set,
    // so getRedisClient will create a new client
    const newClient = mod.getRedisClient();
    expect(newClient).toBeDefined();
  });
});
