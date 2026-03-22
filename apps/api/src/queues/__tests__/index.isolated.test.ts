/**
 * Isolated tests for queues/index.ts that require process.env.REDIS_URL
 * manipulation and module re-loading to exercise initQueues() and getQueues().
 *
 * Covers:
 *   - Lines 31-37: initQueues creating 4 BullMQ Queue instances
 *   - Lines 40-41: getQueues returning them
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

/** Mock Queue class that records constructor args. */
function createQueueMock() {
  const instances: Array<{ name: string; opts: any }> = [];

  class MockQueue {
    name: string;
    opts: any;
    constructor(name: string, opts?: any) {
      this.name = name;
      this.opts = opts;
      instances.push({ name, opts });
    }
  }

  return { MockQueue, instances };
}

async function importQueuesWithRedis(redisUrl?: string) {
  if (redisUrl) {
    process.env.REDIS_URL = redisUrl;
  } else {
    delete process.env.REDIS_URL;
  }

  const { MockQueue, instances } = createQueueMock();

  vi.doMock('bullmq', () => ({
    Queue: MockQueue,
    Worker: vi.fn(),
    QueueEvents: vi.fn(),
  }));

  const mod = await import('../../queues/index.js');
  return { mod, instances };
}

// ── initQueues (lines 31-37) ─────────────────────────────────────────────
describe('queues/index.ts — initQueues (lines 31-37)', () => {
  it('does nothing when REDIS_URL is not set (connection is null)', async () => {
    const { mod, instances } = await importQueuesWithRedis(undefined);

    expect(mod.connection).toBeNull();
    mod.initQueues();

    // No Queue instances should be created
    expect(instances).toHaveLength(0);
    expect(mod.emailQueue).toBeNull();
    expect(mod.webhookQueue).toBeNull();
    expect(mod.pdfQueue).toBeNull();
    expect(mod.cleanupQueue).toBeNull();
  });

  it('creates 4 Queue instances when REDIS_URL is set', async () => {
    const { mod, instances } = await importQueuesWithRedis('redis://localhost:6379');

    expect(mod.connection).not.toBeNull();
    expect(mod.connection).toEqual({
      host: 'localhost',
      port: 6379,
      password: undefined,
      db: 0,
    });

    mod.initQueues();

    expect(instances).toHaveLength(4);

    const names = instances.map(i => i.name);
    expect(names).toContain('email');
    expect(names).toContain('webhook');
    expect(names).toContain('pdf');
    expect(names).toContain('cleanup');
  });

  it('passes correct default job options to each queue', async () => {
    const { mod, instances } = await importQueuesWithRedis('redis://localhost:6379');

    mod.initQueues();

    // email, webhook, pdf should all have DEFAULT_JOB_OPTIONS
    const emailInst = instances.find(i => i.name === 'email')!;
    expect(emailInst.opts.defaultJobOptions).toEqual(mod.DEFAULT_JOB_OPTIONS);

    const webhookInst = instances.find(i => i.name === 'webhook')!;
    expect(webhookInst.opts.defaultJobOptions).toEqual(mod.DEFAULT_JOB_OPTIONS);

    const pdfInst = instances.find(i => i.name === 'pdf')!;
    expect(pdfInst.opts.defaultJobOptions).toEqual(mod.DEFAULT_JOB_OPTIONS);

    // cleanup queue has modified attempts: 3
    const cleanupInst = instances.find(i => i.name === 'cleanup')!;
    expect(cleanupInst.opts.defaultJobOptions.attempts).toBe(3);
    expect(cleanupInst.opts.defaultJobOptions.backoff).toEqual(
      mod.DEFAULT_JOB_OPTIONS.backoff,
    );
  });

  it('sets module-level queue variables after initQueues()', async () => {
    const { mod } = await importQueuesWithRedis('redis://localhost:6379');

    mod.initQueues();

    expect(mod.emailQueue).not.toBeNull();
    expect(mod.webhookQueue).not.toBeNull();
    expect(mod.pdfQueue).not.toBeNull();
    expect(mod.cleanupQueue).not.toBeNull();
  });

  it('parses REDIS_URL with password and db number', async () => {
    const { mod } = await importQueuesWithRedis('redis://:secret@redis.host:6380/2');

    expect(mod.connection).toEqual({
      host: 'redis.host',
      port: 6380,
      password: 'secret',
      db: 2,
    });
  });

  it('defaults port to 6379 when not in URL', async () => {
    const { mod } = await importQueuesWithRedis('redis://redis.host');

    expect(mod.connection).not.toBeNull();
    expect(mod.connection!.port).toBe(6379);
  });
});

// ── getQueues (lines 39-41) ──────────────────────────────────────────────
describe('queues/index.ts — getQueues (lines 40-41)', () => {
  it('returns empty array before initQueues is called', async () => {
    const { mod } = await importQueuesWithRedis('redis://localhost:6379');

    const queues = mod.getQueues();
    expect(queues).toEqual([]);
  });

  it('returns all 4 queues after initQueues', async () => {
    const { mod } = await importQueuesWithRedis('redis://localhost:6379');

    mod.initQueues();
    const queues = mod.getQueues();

    expect(queues).toHaveLength(4);
    expect(queues.map((q: any) => q.name)).toEqual([
      'email',
      'webhook',
      'pdf',
      'cleanup',
    ]);
  });

  it('returns empty array when no REDIS_URL and initQueues was called', async () => {
    const { mod } = await importQueuesWithRedis(undefined);

    mod.initQueues();
    const queues = mod.getQueues();
    expect(queues).toEqual([]);
  });
});
