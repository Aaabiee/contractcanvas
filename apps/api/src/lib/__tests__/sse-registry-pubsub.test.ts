import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockOn = vi.fn();
const mockSubscribe = vi.fn().mockResolvedValue(undefined);
const mockPublish = vi.fn().mockResolvedValue(1);
const mockUnsubscribe = vi.fn();
const mockQuit = vi.fn().mockResolvedValue('OK');
const mockWarn = vi.fn();
const mockInfo = vi.fn();
const mockError = vi.fn();

vi.mock('../logger.js', () => ({
  logger: { info: mockInfo, warn: mockWarn, error: mockError },
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    on: mockOn,
    subscribe: mockSubscribe,
    publish: mockPublish,
    unsubscribe: mockUnsubscribe,
    quit: mockQuit,
  })),
}));

describe('sse-registry (Redis Pub/Sub mode)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Re-apply the default mock implementations after clearAllMocks
    mockSubscribe.mockResolvedValue(undefined);
    mockPublish.mockResolvedValue(1);
    mockQuit.mockResolvedValue('OK');
  });

  afterEach(() => {
    delete process.env['REDIS_URL'];
  });

  it('initSsePubSub initializes pub/sub when REDIS_URL is set', async () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';

    const mod = await import('../sse-registry.js');
    mod.initSsePubSub();

    const { Redis } = await import('ioredis');
    // Two Redis instances should be created (pub + sub)
    expect(Redis).toHaveBeenCalledTimes(2);
    expect(mockSubscribe).toHaveBeenCalledWith('sse:notifications');
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockInfo).toHaveBeenCalledWith('SSE Redis Pub/Sub bridge initialized');
  });

  it('pushToUser publishes via Redis when pub client exists', async () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';

    const mod = await import('../sse-registry.js');
    mod.initSsePubSub();
    mod.pushToUser('user-x', 'test-event', { hello: 'world' });

    expect(mockPublish).toHaveBeenCalledWith(
      'sse:notifications',
      JSON.stringify({ userId: 'user-x', event: 'test-event', data: { hello: 'world' } }),
    );
  });

  it('closeSsePubSub disconnects pub and sub clients', async () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';

    const mod = await import('../sse-registry.js');
    mod.initSsePubSub();
    await mod.closeSsePubSub();

    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockQuit).toHaveBeenCalledTimes(2); // sub.quit + pub.quit
  });

  it('handles invalid JSON in sub.on("message") callback', async () => {
    // Capture the message callback by intercepting mockOn calls
    let messageCallback: ((_channel: string, message: string) => void) | undefined;
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === 'message') messageCallback = cb;
    });

    process.env['REDIS_URL'] = 'redis://localhost:6379';

    const mod = await import('../sse-registry.js');
    mod.initSsePubSub();

    expect(messageCallback).toBeDefined();

    // Call with invalid JSON — should not throw, should log warning
    messageCallback!('sse:notifications', 'not-valid-json');
    expect(mockWarn).toHaveBeenCalledWith('Invalid SSE pub/sub message');
  });

  it('dispatches valid JSON messages to local clients via sub.on("message")', async () => {
    let messageCallback: ((_channel: string, message: string) => void) | undefined;
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === 'message') messageCallback = cb;
    });

    process.env['REDIS_URL'] = 'redis://localhost:6379';

    const mod = await import('../sse-registry.js');
    mod.initSsePubSub();

    // Add a local client
    const mockRes: any = { write: vi.fn() };
    mod.addClient('user-abc', mockRes);

    expect(messageCallback).toBeDefined();

    // Simulate a message from Redis
    messageCallback!('sse:notifications', JSON.stringify({
      userId: 'user-abc',
      event: 'update',
      data: { msg: 'hello' },
    }));

    expect(mockRes.write).toHaveBeenCalledWith(
      expect.stringContaining('event: update'),
    );
    expect(mockRes.write).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"hello"'),
    );
  });

  it('initSsePubSub does nothing when REDIS_URL is not set', async () => {
    delete process.env['REDIS_URL'];

    const { Redis } = await import('ioredis');
    const callsBefore = (Redis as ReturnType<typeof vi.fn>).mock.calls.length;

    const mod = await import('../sse-registry.js');
    mod.initSsePubSub();

    // No new Redis instances created
    expect((Redis as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });
});
