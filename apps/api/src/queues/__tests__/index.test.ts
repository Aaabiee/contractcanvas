import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockQueueInstances: Array<{ name: string }> = [];

vi.mock('bullmq', () => {
  const MockQueue = vi.fn().mockImplementation((name: string) => {
    const instance = { name, add: vi.fn(), close: vi.fn() };
    mockQueueInstances.push(instance);
    return instance;
  });

  return {
    Queue: MockQueue,
    Worker: vi.fn(),
    QueueEvents: vi.fn(),
  };
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('queues/index', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQueueInstances.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initQueues with no REDIS_URL (no connection)', () => {
    it('does not create any queues', async () => {
      delete process.env['REDIS_URL'];

      const { initQueues, getQueues } = await import('../index.js');

      initQueues();

      expect(mockQueueInstances).toHaveLength(0);
      expect(getQueues()).toEqual([]);
    });
  });

  describe('initQueues with REDIS_URL set', () => {
    it('creates 4 queues (email, webhook, pdf, cleanup)', async () => {
      process.env['REDIS_URL'] = 'redis://:password@localhost:6379/0';

      const { initQueues } = await import('../index.js');

      initQueues();

      expect(mockQueueInstances).toHaveLength(4);
      const names = mockQueueInstances.map(q => q.name);
      expect(names).toContain('email');
      expect(names).toContain('webhook');
      expect(names).toContain('pdf');
      expect(names).toContain('cleanup');
    });
  });

  describe('getQueues', () => {
    it('returns empty array before initQueues is called', async () => {
      delete process.env['REDIS_URL'];

      const { getQueues } = await import('../index.js');

      expect(getQueues()).toEqual([]);
    });

    it('returns all created queues after initQueues', async () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379/0';

      const { initQueues, getQueues } = await import('../index.js');

      initQueues();

      const queues = getQueues();
      expect(queues).toHaveLength(4);
    });
  });

  describe('connection parsing', () => {
    it('parses host, port, password, and db from REDIS_URL', async () => {
      process.env['REDIS_URL'] = 'redis://:mysecret@redis.example.com:6380/2';

      const { connection } = await import('../index.js');

      expect(connection).toEqual({
        host: 'redis.example.com',
        port: 6380,
        password: 'mysecret',
        db: 2,
      });
    });

    it('defaults port to 6379 and db to 0 when not specified', async () => {
      process.env['REDIS_URL'] = 'redis://localhost';

      const { connection } = await import('../index.js');

      expect(connection).not.toBeNull();
      expect(connection!.host).toBe('localhost');
      expect(connection!.port).toBe(6379);
      expect(connection!.db).toBe(0);
    });

    it('sets connection to null when REDIS_URL is not set', async () => {
      delete process.env['REDIS_URL'];

      const { connection } = await import('../index.js');

      expect(connection).toBeNull();
    });
  });

  describe('DEFAULT_JOB_OPTIONS', () => {
    it('has correct retry and cleanup settings', async () => {
      const { DEFAULT_JOB_OPTIONS } = await import('../index.js');

      expect(DEFAULT_JOB_OPTIONS.attempts).toBe(5);
      expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({
        type: 'exponential',
        delay: 5_000,
      });
      expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({ count: 500 });
      expect(DEFAULT_JOB_OPTIONS.removeOnFail).toEqual({ count: 200 });
    });
  });
});
