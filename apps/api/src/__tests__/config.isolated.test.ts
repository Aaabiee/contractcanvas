/**
 * Isolated tests for config.ts module-level branches that require
 * process.env manipulation and vi.resetModules() to re-evaluate.
 *
 * Covers:
 *   - Lines 58-63:  config.json missing / parse error fallback
 *   - Lines 83-86:  IS_DOCKER db.host fallback
 *   - Line  92:     s3.forcePathStyle from config.json boolean
 *   - Lines 162-165: short JWT warning in non-prod (default secret)
 *   - Lines 180-188: config summary log when NODE_ENV !== 'test'
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
 * Helper: set up a clean env suitable for non-production config import
 * (avoids validateProductionConfig throwing).
 */
function setNonProdEnv(extra: Record<string, string> = {}): void {
  // Clear keys that config.ts reads so they don't bleed from the host
  delete process.env.NODE_ENV;
  delete process.env.PORT;
  delete process.env.POSTGRES_USER;
  delete process.env.POSTGRES_PASSWORD;
  delete process.env.POSTGRES_DB;
  delete process.env.POSTGRES_PORT;
  delete process.env.POSTGRES_HOST;
  delete process.env.IS_DOCKER;
  delete process.env.DB_SCHEMA;
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_REGION;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY;
  delete process.env.S3_SECRET_KEY;
  delete process.env.S3_FORCE_PATH_STYLE;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.JWT_SECRET;

  process.env.NODE_ENV = 'development';
  Object.assign(process.env, extra);
}

/**
 * Create a mock for 'node:fs' that serves a specific JSON for config.json
 * and returns false for the .env file (so dotenv doesn't interfere).
 */
function mockFsWithConfig(configJson: object | null, configExists = true) {
  vi.doMock('node:fs', () => ({
    default: {
      existsSync: (p: string) => {
        // Never let it find the .env file — prevents dotenv from loading
        if (p.endsWith('.env')) return false;
        // config.json
        return configExists;
      },
      readFileSync: () => {
        if (!configExists) throw new Error('ENOENT');
        return JSON.stringify(configJson ?? {});
      },
    },
  }));
}

/**
 * Create a mock for 'node:fs' that makes config.json not exist.
 */
function mockFsNoConfig() {
  vi.doMock('node:fs', () => ({
    default: {
      existsSync: (p: string) => {
        if (p.endsWith('.env')) return false;
        return false; // config.json does not exist
      },
      readFileSync: () => { throw new Error('should not be called'); },
    },
  }));
}

/**
 * Create a mock for 'node:fs' that makes config.json exist but be unparseable.
 */
function mockFsBadJson() {
  vi.doMock('node:fs', () => ({
    default: {
      existsSync: (p: string) => {
        if (p.endsWith('.env')) return false;
        return true;
      },
      readFileSync: () => '{{INVALID JSON',
    },
  }));
}

/**
 * Also mock dotenv to no-op so it never loads real files.
 */
function mockDotenv() {
  vi.doMock('dotenv', () => ({
    default: { config: vi.fn() },
  }));
}

// ── Lines 58-59: config.json does not exist ──────────────────────────────
describe('config.ts — config.json not found (lines 58-59)', () => {
  it('logs a warning and uses defaults when config.json is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    setNonProdEnv();
    mockDotenv();
    mockFsNoConfig();

    const cfg = await import('../config.js');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not found. Using defaults'),
    );
    // Should still export valid defaults
    expect(cfg.app.env).toBe('development');
    expect(cfg.db.user).toBe('postgres');
  });
});

// ── Lines 60-63: config.json parse error ─────────────────────────────────
describe('config.ts — config.json parse error (lines 60-63)', () => {
  it('logs an error and falls back to defaults on invalid JSON', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    setNonProdEnv();
    mockDotenv();
    mockFsBadJson();

    const cfg = await import('../config.js');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load or parse'),
    );
    expect(cfg.db.user).toBe('postgres');
  });
});

// ── Lines 83-86: IS_DOCKER db.host fallback ──────────────────────────────
describe('config.ts — IS_DOCKER db.host fallback (lines 83-86)', () => {
  it('uses container_name from config when IS_DOCKER is true and no POSTGRES_HOST', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    setNonProdEnv({ IS_DOCKER: 'true' });
    mockDotenv();
    mockFsWithConfig({ db: { container_name: 'my-pg-container' } });

    const cfg = await import('../config.js');
    expect(cfg.db.host).toBe('my-pg-container');
  });

  it('falls back to "db" when IS_DOCKER is true and no container_name', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    setNonProdEnv({ IS_DOCKER: 'true' });
    mockDotenv();
    mockFsWithConfig({});

    const cfg = await import('../config.js');
    expect(cfg.db.host).toBe('db');
  });

  it('uses dbCfgFromFile.host when provided and IS_DOCKER is irrelevant', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    setNonProdEnv();
    mockDotenv();
    mockFsWithConfig({ db: { host: 'custom-db-host' } });

    const cfg = await import('../config.js');
    expect(cfg.db.host).toBe('custom-db-host');
  });
});

// ── Line 92: s3.forcePathStyle from config.json boolean ──────────────────
describe('config.ts — s3.forcePathStyle from config boolean (line 92)', () => {
  it('reads forcePathStyle=false from config.json when env var is absent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    setNonProdEnv();
    mockDotenv();
    mockFsWithConfig({ s3: { forcePathStyle: false } });

    const cfg = await import('../config.js');
    expect(cfg.s3.forcePathStyle).toBe(false);
  });

  it('reads forcePathStyle=true from config.json when env var is absent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    setNonProdEnv();
    mockDotenv();
    mockFsWithConfig({ s3: { forcePathStyle: true } });

    const cfg = await import('../config.js');
    expect(cfg.s3.forcePathStyle).toBe(true);
  });
});

// ── Lines 162-165: default JWT_SECRET warning in non-prod ────────────────
describe('config.ts — default JWT_SECRET warning (lines 162-165)', () => {
  it('warns about insecure default JWT_SECRET in development', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    setNonProdEnv();
    // Do NOT set JWT_SECRET so effectiveJwtSecret === DEFAULT_JWT_SECRET
    mockDotenv();
    mockFsWithConfig({});

    await import('../config.js');

    const warningCalls = warnSpy.mock.calls.map(c => String(c[0]));
    const hasInsecureWarning = warningCalls.some(msg =>
      msg.includes('Using insecure default JWT_SECRET'),
    );
    expect(hasInsecureWarning).toBe(true);
  });
});

// ── Lines 180-188: config summary log when NODE_ENV !== 'test' ───────────
describe('config.ts — config summary log (lines 180-188)', () => {
  it('prints config summary when NODE_ENV is not test', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    setNonProdEnv();
    mockDotenv();
    mockFsWithConfig({});

    await import('../config.js');

    const logCalls = logSpy.mock.calls.map(c => String(c[0]));
    expect(logCalls.some(m => m.includes('[Config] Loaded for env:'))).toBe(true);
    expect(logCalls.some(m => m.includes('[Config] API Port:'))).toBe(true);
    expect(logCalls.some(m => m.includes('[Config] DB Host:'))).toBe(true);
    expect(logCalls.some(m => m.includes('[Config] Stripe:'))).toBe(true);
  });

  it('prints S3 endpoint line when S3_ENDPOINT is set', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    setNonProdEnv({ S3_ENDPOINT: 'http://localhost:9000' });
    mockDotenv();
    mockFsWithConfig({});

    await import('../config.js');

    const logCalls = logSpy.mock.calls.map(c => String(c[0]));
    expect(logCalls.some(m => m.includes('[Config] S3 Endpoint:'))).toBe(true);
  });

  it('does NOT print config summary when NODE_ENV is test', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    setNonProdEnv();
    process.env.NODE_ENV = 'test';
    mockDotenv();
    mockFsWithConfig({});

    await import('../config.js');

    const logCalls = logSpy.mock.calls.map(c => String(c[0]));
    expect(logCalls.some(m => m.includes('[Config] Loaded for env:'))).toBe(false);
  });
});
