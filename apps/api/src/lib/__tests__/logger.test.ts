import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mock pino so we can inspect resolveTransport output without        */
/*  actually requiring missing transport packages.                     */
/* ------------------------------------------------------------------ */

const mockPino = vi.hoisted(() => {
  const pinoFn = vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: 'info',
  });
  return pinoFn;
});

vi.mock('pino', () => ({ default: mockPino }));

describe('logger module', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  /* ---------------------------------------------------------------- */
  /*  resolveTransport                                                 */
  /* ---------------------------------------------------------------- */

  describe('resolveTransport', () => {
    it('returns undefined transport in test environment', async () => {
      process.env['NODE_ENV'] = 'test';
      delete process.env['LOG_TRANSPORT'];

      await import('../logger.js');

      expect(mockPino).toHaveBeenCalledOnce();
      const opts = mockPino.mock.calls[0][0];
      expect(opts.transport).toBeUndefined();
      expect(opts.level).toBe('silent');
    });

    it('configures datadog transport when LOG_TRANSPORT=datadog', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['LOG_TRANSPORT'] = 'datadog';
      process.env['DD_API_KEY'] = 'test-dd-key';

      await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];
      expect(opts.transport).toEqual({
        target: 'pino-datadog-transport',
        options: {
          ddClientConf: { authMethods: { apiKeyAuth: 'test-dd-key' } },
          ddtags: 'env:production,service:contractcanvas-api',
        },
      });
    });

    it('configures cloudwatch transport when LOG_TRANSPORT=cloudwatch', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['LOG_TRANSPORT'] = 'cloudwatch';
      process.env['CW_LOG_GROUP'] = '/test/api';
      process.env['CW_LOG_STREAM'] = 'test-stream';

      await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];
      expect(opts.transport).toEqual({
        target: '@serdce/pino-cloudwatch-transport',
        options: {
          logGroupName: '/test/api',
          logStreamName: 'test-stream',
          awsRegion: 'us-east-1',
        },
      });
    });

    it('uses default cloudwatch values when env vars are missing', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['LOG_TRANSPORT'] = 'cloudwatch';
      delete process.env['CW_LOG_GROUP'];
      delete process.env['CW_LOG_STREAM'];
      delete process.env['HOSTNAME'];
      delete process.env['AWS_DEFAULT_REGION'];

      await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];
      expect(opts.transport.options.logGroupName).toBe('/contractcanvas/api');
      expect(opts.transport.options.logStreamName).toBe('default');
      expect(opts.transport.options.awsRegion).toBe('us-east-1');
    });

    it('configures loki transport when LOG_TRANSPORT=loki', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['LOG_TRANSPORT'] = 'loki';
      process.env['LOKI_URL'] = 'http://loki.internal:3100';

      await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];
      expect(opts.transport).toEqual({
        target: 'pino-loki',
        options: {
          host: 'http://loki.internal:3100',
          labels: { app: 'contractcanvas-api', env: 'production' },
          batching: true,
          interval: 5,
        },
      });
    });

    it('uses default loki URL when LOKI_URL is not set', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['LOG_TRANSPORT'] = 'loki';
      delete process.env['LOKI_URL'];

      await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];
      expect(opts.transport.options.host).toBe('http://localhost:3100');
    });

    it('uses pino-pretty in dev when no LOG_TRANSPORT is set', async () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['LOG_TRANSPORT'];

      await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];
      expect(opts.transport).toEqual({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      });
      expect(opts.level).toBe('debug');
    });

    it('returns undefined transport in production with no LOG_TRANSPORT', async () => {
      process.env['NODE_ENV'] = 'production';
      delete process.env['LOG_TRANSPORT'];

      await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];
      expect(opts.transport).toBeUndefined();
      expect(opts.level).toBe('info');
    });

    it('respects LOG_LEVEL override', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['LOG_LEVEL'] = 'trace';
      delete process.env['LOG_TRANSPORT'];

      await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];
      expect(opts.level).toBe('trace');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  mixin (asyncLocalStorage)                                        */
  /* ---------------------------------------------------------------- */

  describe('mixin with asyncLocalStorage', () => {
    it('returns empty object when no store is active', async () => {
      process.env['NODE_ENV'] = 'test';
      await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];
      const mixinResult = opts.mixin();
      expect(mixinResult).toEqual({});
    });

    it('exposes requestId, userId, organizationId from store', async () => {
      process.env['NODE_ENV'] = 'test';
      const { asyncLocalStorage } = await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];

      const ctx = {
        requestId: 'req-123',
        userId: 'user-456',
        organizationId: 'org-789',
      };

      await asyncLocalStorage.run(ctx, async () => {
        const mixinResult = opts.mixin();
        expect(mixinResult).toEqual({
          requestId: 'req-123',
          userId: 'user-456',
          organizationId: 'org-789',
        });
      });
    });

    it('returns partial context when only some fields are present', async () => {
      process.env['NODE_ENV'] = 'test';
      const { asyncLocalStorage } = await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];

      const ctx = { requestId: 'req-abc' };

      await asyncLocalStorage.run(ctx, async () => {
        const mixinResult = opts.mixin();
        expect(mixinResult).toEqual({ requestId: 'req-abc' });
        expect(mixinResult.userId).toBeUndefined();
        expect(mixinResult.organizationId).toBeUndefined();
      });
    });

    it('isolates context between nested runs', async () => {
      process.env['NODE_ENV'] = 'test';
      const { asyncLocalStorage } = await import('../logger.js');

      const opts = mockPino.mock.calls[0][0];
      const outerCtx = { requestId: 'outer' };
      const innerCtx = { requestId: 'inner', userId: 'u1' };

      await asyncLocalStorage.run(outerCtx, async () => {
        expect(opts.mixin()).toEqual({ requestId: 'outer' });

        await asyncLocalStorage.run(innerCtx, async () => {
          expect(opts.mixin()).toEqual({ requestId: 'inner', userId: 'u1' });
        });

        // Back to outer
        expect(opts.mixin()).toEqual({ requestId: 'outer' });
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Exports                                                          */
  /* ---------------------------------------------------------------- */

  describe('exports', () => {
    it('exports logger as both named and default export', async () => {
      process.env['NODE_ENV'] = 'test';
      const mod = await import('../logger.js');

      expect(mod.logger).toBeDefined();
      expect(mod.default).toBeDefined();
      expect(mod.logger).toBe(mod.default);
    });

    it('exports asyncLocalStorage', async () => {
      process.env['NODE_ENV'] = 'test';
      const { asyncLocalStorage } = await import('../logger.js');

      expect(asyncLocalStorage).toBeDefined();
      expect(typeof asyncLocalStorage.run).toBe('function');
      expect(typeof asyncLocalStorage.getStore).toBe('function');
    });
  });
});
