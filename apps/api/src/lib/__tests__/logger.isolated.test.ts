/**
 * Isolated tests for logger.ts that require process.env manipulation
 * and module re-loading to exercise resolveTransport() branches and mixin().
 *
 * Covers:
 *   - Lines 18-61: resolveTransport() for each LOG_TRANSPORT value
 *     (datadog / cloudwatch / loki / pino-pretty / undefined)
 *   - Lines 67-74: mixin() with asyncLocalStorage context
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

/**
 * Helper to import logger with given env and capture the pino() call args.
 * We mock 'pino' so we can inspect what transport config was passed.
 */
async function importLoggerWithEnv(
  env: Record<string, string>,
): Promise<{ pinoCallArgs: any; loggerModule: any }> {
  // Clear all relevant env vars first
  delete process.env.NODE_ENV;
  delete process.env.LOG_TRANSPORT;
  delete process.env.LOG_LEVEL;
  delete process.env.DD_API_KEY;
  delete process.env.CW_LOG_GROUP;
  delete process.env.CW_LOG_STREAM;
  delete process.env.AWS_DEFAULT_REGION;
  delete process.env.HOSTNAME;
  delete process.env.LOKI_URL;

  Object.assign(process.env, env);

  let capturedArgs: any = null;

  vi.doMock('pino', () => {
    const mockPino = (opts: any) => {
      capturedArgs = opts;
      // Return a minimal logger-like object
      return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(),
        level: opts?.level ?? 'info',
      };
    };
    mockPino.default = mockPino;
    return { default: mockPino };
  });

  const loggerModule = await import('../logger.js');

  return { pinoCallArgs: capturedArgs, loggerModule };
}

// ── resolveTransport: test environment => undefined ──────────────────────
describe('logger.ts — resolveTransport() in test environment', () => {
  it('returns undefined transport when NODE_ENV is test', async () => {
    const { pinoCallArgs } = await importLoggerWithEnv({ NODE_ENV: 'test' });

    expect(pinoCallArgs).toBeDefined();
    expect(pinoCallArgs.transport).toBeUndefined();
    expect(pinoCallArgs.level).toBe('silent');
  });
});

// ── resolveTransport: datadog ────────────────────────────────────────────
describe('logger.ts — resolveTransport() datadog (lines 20-28)', () => {
  it('configures pino-datadog-transport when LOG_TRANSPORT=datadog', async () => {
    const { pinoCallArgs } = await importLoggerWithEnv({
      NODE_ENV: 'production',
      LOG_TRANSPORT: 'datadog',
      DD_API_KEY: 'test-dd-key',
    });

    expect(pinoCallArgs.transport).toBeDefined();
    expect(pinoCallArgs.transport.target).toBe('pino-datadog-transport');
    expect(pinoCallArgs.transport.options.ddClientConf.authMethods.apiKeyAuth).toBe('test-dd-key');
    expect(pinoCallArgs.transport.options.ddtags).toContain('env:production');
    expect(pinoCallArgs.transport.options.ddtags).toContain('service:contractcanvas-api');
  });
});

// ── resolveTransport: cloudwatch ─────────────────────────────────────────
describe('logger.ts — resolveTransport() cloudwatch (lines 30-38)', () => {
  it('configures cloudwatch transport with env var overrides', async () => {
    const { pinoCallArgs } = await importLoggerWithEnv({
      NODE_ENV: 'production',
      LOG_TRANSPORT: 'cloudwatch',
      CW_LOG_GROUP: '/my/custom/group',
      CW_LOG_STREAM: 'my-stream',
      AWS_DEFAULT_REGION: 'eu-west-1',
    });

    expect(pinoCallArgs.transport).toBeDefined();
    expect(pinoCallArgs.transport.target).toBe('@serdce/pino-cloudwatch-transport');
    expect(pinoCallArgs.transport.options.logGroupName).toBe('/my/custom/group');
    expect(pinoCallArgs.transport.options.logStreamName).toBe('my-stream');
    expect(pinoCallArgs.transport.options.awsRegion).toBe('eu-west-1');
  });

  it('uses cloudwatch defaults when env vars are absent', async () => {
    const { pinoCallArgs } = await importLoggerWithEnv({
      NODE_ENV: 'production',
      LOG_TRANSPORT: 'cloudwatch',
    });

    expect(pinoCallArgs.transport.options.logGroupName).toBe('/contractcanvas/api');
    expect(pinoCallArgs.transport.options.logStreamName).toBe('default');
    expect(pinoCallArgs.transport.options.awsRegion).toBe('us-east-1');
  });
});

// ── resolveTransport: loki ───────────────────────────────────────────────
describe('logger.ts — resolveTransport() loki (lines 41-51)', () => {
  it('configures pino-loki transport with custom LOKI_URL', async () => {
    const { pinoCallArgs } = await importLoggerWithEnv({
      NODE_ENV: 'production',
      LOG_TRANSPORT: 'loki',
      LOKI_URL: 'http://loki.internal:3100',
    });

    expect(pinoCallArgs.transport).toBeDefined();
    expect(pinoCallArgs.transport.target).toBe('pino-loki');
    expect(pinoCallArgs.transport.options.host).toBe('http://loki.internal:3100');
    expect(pinoCallArgs.transport.options.labels.app).toBe('contractcanvas-api');
    expect(pinoCallArgs.transport.options.labels.env).toBe('production');
    expect(pinoCallArgs.transport.options.batching).toBe(true);
    expect(pinoCallArgs.transport.options.interval).toBe(5);
  });

  it('uses default LOKI_URL when env var is absent', async () => {
    const { pinoCallArgs } = await importLoggerWithEnv({
      NODE_ENV: 'production',
      LOG_TRANSPORT: 'loki',
    });

    expect(pinoCallArgs.transport.options.host).toBe('http://localhost:3100');
  });
});

// ── resolveTransport: pino-pretty in development ─────────────────────────
describe('logger.ts — resolveTransport() pino-pretty in dev (lines 53-58)', () => {
  it('configures pino-pretty when isDev and no LOG_TRANSPORT', async () => {
    const { pinoCallArgs } = await importLoggerWithEnv({
      NODE_ENV: 'development',
    });

    expect(pinoCallArgs.transport).toBeDefined();
    expect(pinoCallArgs.transport.target).toBe('pino-pretty');
    expect(pinoCallArgs.transport.options.colorize).toBe(true);
    expect(pinoCallArgs.level).toBe('debug');
  });
});

// ── resolveTransport: production with no LOG_TRANSPORT ───────────────────
describe('logger.ts — resolveTransport() production no transport (line 60)', () => {
  it('returns undefined transport in production with no LOG_TRANSPORT', async () => {
    const { pinoCallArgs } = await importLoggerWithEnv({
      NODE_ENV: 'production',
    });

    expect(pinoCallArgs.transport).toBeUndefined();
    expect(pinoCallArgs.level).toBe('info');
  });
});

// ── LOG_LEVEL override ───────────────────────────────────────────────────
describe('logger.ts — LOG_LEVEL override', () => {
  it('uses LOG_LEVEL from env when set', async () => {
    const { pinoCallArgs } = await importLoggerWithEnv({
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    });

    expect(pinoCallArgs.level).toBe('warn');
  });
});

// ── mixin() with asyncLocalStorage context (lines 67-74) ────────────────
describe('logger.ts — mixin() with asyncLocalStorage (lines 67-74)', () => {
  it('returns empty object when no async context is set', async () => {
    const { pinoCallArgs, loggerModule } = await importLoggerWithEnv({
      NODE_ENV: 'production',
    });

    // mixin is available on the pino options
    expect(pinoCallArgs.mixin).toBeTypeOf('function');
    const result = pinoCallArgs.mixin();
    expect(result).toEqual({});
  });

  it('includes requestId, userId, organizationId from async context', async () => {
    const { pinoCallArgs, loggerModule } = await importLoggerWithEnv({
      NODE_ENV: 'production',
    });

    const { asyncLocalStorage } = loggerModule;

    const mixinResult = await new Promise<Record<string, string>>((resolve) => {
      asyncLocalStorage.run(
        { requestId: 'req-123', userId: 'user-456', organizationId: 'org-789' },
        () => {
          resolve(pinoCallArgs.mixin());
        },
      );
    });

    expect(mixinResult).toEqual({
      requestId: 'req-123',
      userId: 'user-456',
      organizationId: 'org-789',
    });
  });

  it('omits undefined context fields from mixin output', async () => {
    const { pinoCallArgs, loggerModule } = await importLoggerWithEnv({
      NODE_ENV: 'production',
    });

    const { asyncLocalStorage } = loggerModule;

    const mixinResult = await new Promise<Record<string, string>>((resolve) => {
      asyncLocalStorage.run(
        { requestId: 'req-only' },
        () => {
          resolve(pinoCallArgs.mixin());
        },
      );
    });

    expect(mixinResult).toEqual({ requestId: 'req-only' });
    expect(mixinResult).not.toHaveProperty('userId');
    expect(mixinResult).not.toHaveProperty('organizationId');
  });

  it('returns empty object when context has no fields set', async () => {
    const { pinoCallArgs, loggerModule } = await importLoggerWithEnv({
      NODE_ENV: 'production',
    });

    const { asyncLocalStorage } = loggerModule;

    const mixinResult = await new Promise<Record<string, string>>((resolve) => {
      asyncLocalStorage.run({}, () => {
        resolve(pinoCallArgs.mixin());
      });
    });

    expect(mixinResult).toEqual({});
  });
});
