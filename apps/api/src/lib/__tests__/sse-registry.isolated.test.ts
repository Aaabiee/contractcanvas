/**
 * Isolated tests for sse-registry.ts Redis pub/sub paths that require
 * process.env.REDIS_URL and module re-loading.
 *
 * Covers:
 *   - Lines 12-35: initSsePubSub (Redis pub/sub setup)
 *   - Lines 58-60: pushToUser in Redis mode (publish via pub client)
 *   - Lines 68-71: closeSsePubSub (clean shutdown)
 */

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

/** Create a mock Redis instance with spies. */
function createMockRedis() {
  const handlers = new Map<string, (...args: any[]) => void>();
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
    }),
    subscribe: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(1),
    unsubscribe: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
    _handlers: handlers,
    _triggerError(err: Error) {
      handlers.get('error')?.(err);
    },
    _triggerMessage(channel: string, message: string) {
      handlers.get('message')?.(channel, message);
    },
  };
}

async function importWithRedis(redisUrl: string) {
  process.env.REDIS_URL = redisUrl;

  const mockPub = createMockRedis();
  const mockSub = createMockRedis();
  let constructCount = 0;

  vi.doMock('ioredis', () => ({
    Redis: vi.fn().mockImplementation(() => {
      constructCount++;
      return constructCount === 1 ? mockPub : mockSub;
    }),
  }));

  vi.doMock('../logger.js', () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }));

  const mod = await import('../sse-registry.js');
  return { mod, mockPub, mockSub };
}

// ── initSsePubSub (lines 12-35) ─────────────────────────────────────────
describe('sse-registry.ts — initSsePubSub with Redis (lines 12-35)', () => {
  it('does nothing when REDIS_URL is not set', async () => {
    delete process.env.REDIS_URL;

    vi.doMock('ioredis', () => ({
      Redis: vi.fn(),
    }));

    vi.doMock('../logger.js', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    }));

    const mod = await import('../sse-registry.js');
    mod.initSsePubSub();
    // Should return early without creating Redis instances
    const { Redis } = await import('ioredis');
    expect(Redis).not.toHaveBeenCalled();
  });

  it('creates pub and sub Redis clients and subscribes to SSE channel', async () => {
    const { mod, mockPub, mockSub } = await importWithRedis('redis://localhost:6379');

    mod.initSsePubSub();

    // Both clients should register error handlers
    expect(mockPub.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockSub.on).toHaveBeenCalledWith('error', expect.any(Function));

    // Sub should subscribe to the channel
    expect(mockSub.subscribe).toHaveBeenCalledWith('sse:notifications');

    // Sub should register a message handler
    expect(mockSub.on).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('error handlers log warnings without crashing', async () => {
    const { mod, mockPub, mockSub } = await importWithRedis('redis://localhost:6379');

    mod.initSsePubSub();

    // Trigger error handlers - should not throw
    expect(() => mockPub._triggerError(new Error('pub error'))).not.toThrow();
    expect(() => mockSub._triggerError(new Error('sub error'))).not.toThrow();
  });

  it('message handler dispatches to local clients', async () => {
    const { mod, mockSub } = await importWithRedis('redis://localhost:6379');

    mod.initSsePubSub();

    const mockRes = { write: vi.fn() } as any;
    mod.addClient('user-x', mockRes);

    // Simulate receiving a pub/sub message
    mockSub._triggerMessage(
      'sse:notifications',
      JSON.stringify({ userId: 'user-x', event: 'update', data: { msg: 'hi' } }),
    );

    expect(mockRes.write).toHaveBeenCalledWith(
      expect.stringContaining('event: update'),
    );
    expect(mockRes.write).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"hi"'),
    );
  });

  it('message handler logs warning on invalid JSON', async () => {
    const { mod, mockSub } = await importWithRedis('redis://localhost:6379');
    const { logger } = await import('../logger.js');

    mod.initSsePubSub();

    // Send invalid JSON through the message handler
    mockSub._triggerMessage('sse:notifications', '{bad json');

    expect(logger.warn).toHaveBeenCalledWith('Invalid SSE pub/sub message');
  });
});

// ── pushToUser in Redis mode (lines 57-60) ───────────────────────────────
describe('sse-registry.ts — pushToUser in Redis mode (lines 58-60)', () => {
  it('publishes to Redis when pub client is available', async () => {
    const { mod, mockPub } = await importWithRedis('redis://localhost:6379');

    mod.initSsePubSub();
    mod.pushToUser('user-abc', 'notify', { foo: 'bar' });

    expect(mockPub.publish).toHaveBeenCalledWith(
      'sse:notifications',
      JSON.stringify({ userId: 'user-abc', event: 'notify', data: { foo: 'bar' } }),
    );
  });

  it('does not write to local clients when pub is available (returns early)', async () => {
    const { mod, mockPub } = await importWithRedis('redis://localhost:6379');

    mod.initSsePubSub();

    const mockRes = { write: vi.fn() } as any;
    mod.addClient('user-abc', mockRes);

    mod.pushToUser('user-abc', 'notify', { data: 1 });

    // Should publish to Redis, not write locally (the sub handler would do that)
    expect(mockPub.publish).toHaveBeenCalled();
    // Local write should NOT happen because pub exists => early return
    expect(mockRes.write).not.toHaveBeenCalled();
  });
});

// ── closeSsePubSub (lines 68-71) ────────────────────────────────────────
describe('sse-registry.ts — closeSsePubSub (lines 68-71)', () => {
  it('unsubscribes and quits both Redis clients', async () => {
    const { mod, mockPub, mockSub } = await importWithRedis('redis://localhost:6379');

    mod.initSsePubSub();
    await mod.closeSsePubSub();

    expect(mockSub.unsubscribe).toHaveBeenCalled();
    expect(mockSub.quit).toHaveBeenCalled();
    expect(mockPub.quit).toHaveBeenCalled();
  });

  it('is safe to call when no Redis was initialized', async () => {
    delete process.env.REDIS_URL;

    vi.doMock('ioredis', () => ({
      Redis: vi.fn(),
    }));

    vi.doMock('../logger.js', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    }));

    const mod = await import('../sse-registry.js');
    // Should not throw even if pub/sub are null
    await expect(mod.closeSsePubSub()).resolves.toBeUndefined();
  });

  it('calling closeSsePubSub twice does not error', async () => {
    const { mod } = await importWithRedis('redis://localhost:6379');

    mod.initSsePubSub();
    await mod.closeSsePubSub();
    // Second call should be safe (pub/sub already nulled)
    await expect(mod.closeSsePubSub()).resolves.toBeUndefined();
  });
});

// ── removeClient + connectedUserCount (lines 42-45, 64-66) ───────────────
describe('sse-registry.ts — removeClient and connectedUserCount', () => {
  async function importNoRedis() {
    delete process.env.REDIS_URL;
    vi.doMock('ioredis', () => ({ Redis: vi.fn() }));
    vi.doMock('../logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    return import('../sse-registry.js');
  }

  it('removeClient deletes the connection and cleans up empty sets (lines 42-45)', async () => {
    const mod = await importNoRedis();
    const res = { write: vi.fn() } as any;
    mod.addClient('u1', res);
    expect(mod.connectedUserCount()).toBe(1);

    mod.removeClient('u1', res);
    expect(mod.connectedUserCount()).toBe(0);
  });

  it('pushToUser writes to local clients when no Redis pub (lines 61-62)', async () => {
    const mod = await importNoRedis();
    const res = { write: vi.fn() } as any;
    mod.addClient('u2', res);

    mod.pushToUser('u2', 'test-event', { x: 1 });
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: test-event'));
  });

  it('stale connection is removed on write error (line 22/52)', async () => {
    const mod = await importNoRedis();
    const badRes = { write: vi.fn(() => { throw new Error('closed'); }) } as any;
    const goodRes = { write: vi.fn() } as any;
    mod.addClient('u3', badRes);
    mod.addClient('u3', goodRes);

    mod.pushToUser('u3', 'evt', {});
    expect(goodRes.write).toHaveBeenCalled();
    expect(mod.connectedUserCount()).toBe(1);
  });

  it('sub.subscribe rejection triggers error log (line 22)', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const mockSub = createMockRedis();
    mockSub.subscribe = vi.fn().mockRejectedValue(new Error('sub failed'));
    let count = 0;
    vi.doMock('ioredis', () => ({
      Redis: vi.fn().mockImplementation(() => {
        count++;
        return count === 1 ? createMockRedis() : mockSub;
      }),
    }));
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    vi.doMock('../logger.js', () => ({ logger: mockLogger }));

    const mod = await import('../sse-registry.js');
    mod.initSsePubSub();

    await vi.waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to subscribe to SSE channel',
      );
    });
  });
});
