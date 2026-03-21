/**
 * Unit tests for production secret validation guards (Phase 1.5 — OWASP A02/A05).
 *
 * We test the exported `validateProductionConfig()` function directly so that
 * no module-reload tricks or dotenv/config.json interference are needed.
 *
 * OWASP mapping:
 *   A02 — strong JWT secret prevents token forgery
 *   A05 — absent LocalStack S3 endpoint and live Stripe key prevent
 *         misconfiguration that exposes production data
 */

import { describe, it, expect } from 'vitest';
import {
  validateProductionConfig,
  DEFAULT_JWT_SECRET,
  STRIPE_PLACEHOLDER_PREFIXES,
} from '../config.js';

// Valid production config that passes all checks.
function validProd(overrides: Partial<Parameters<typeof validateProductionConfig>[0]> = {}) {
  return {
    env:             'production',
    jwtSecret:       'a'.repeat(64),
    stripeSecretKey: 'sk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    s3Endpoint:      undefined,
    ...overrides,
  };
}

// ── JWT_SECRET guards ──────────────────────────────────────────────────────

describe('validateProductionConfig — JWT_SECRET', () => {
  it('throws when jwtSecret is the default placeholder', () => {
    expect(() =>
      validateProductionConfig(validProd({ jwtSecret: DEFAULT_JWT_SECRET })),
    ).toThrow(/JWT_SECRET must be set/);
  });

  it('throws when jwtSecret is an empty string', () => {
    expect(() =>
      validateProductionConfig(validProd({ jwtSecret: '' })),
    ).toThrow(/JWT_SECRET must be set/);
  });

  it('throws when jwtSecret is shorter than 64 characters', () => {
    expect(() =>
      validateProductionConfig(validProd({ jwtSecret: 'a'.repeat(63) })),
    ).toThrow(/64 characters/);
  });

  it('accepts jwtSecret of exactly 64 characters', () => {
    expect(() =>
      validateProductionConfig(validProd({ jwtSecret: 'a'.repeat(64) })),
    ).not.toThrow();
  });

  it('accepts jwtSecret longer than 64 characters', () => {
    expect(() =>
      validateProductionConfig(validProd({ jwtSecret: 'b'.repeat(128) })),
    ).not.toThrow();
  });

  it('is a no-op in non-production regardless of secret length', () => {
    expect(() =>
      validateProductionConfig({ env: 'development', jwtSecret: 'short', stripeSecretKey: undefined, s3Endpoint: undefined }),
    ).not.toThrow();
  });
});

// ── Stripe guards ──────────────────────────────────────────────────────────

describe('validateProductionConfig — STRIPE_SECRET_KEY', () => {
  it('throws when stripeSecretKey is undefined', () => {
    expect(() =>
      validateProductionConfig(validProd({ stripeSecretKey: undefined })),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('throws when stripeSecretKey is an empty string', () => {
    expect(() =>
      validateProductionConfig(validProd({ stripeSecretKey: '' })),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  it.each(STRIPE_PLACEHOLDER_PREFIXES)(
    'throws for placeholder prefix "%s"',
    (prefix) => {
      expect(() =>
        validateProductionConfig(validProd({ stripeSecretKey: `${prefix}whatever` })),
      ).toThrow(/STRIPE_SECRET_KEY/);
    },
  );

  it('accepts a live key', () => {
    expect(() =>
      validateProductionConfig(validProd({ stripeSecretKey: 'sk_live_realkey1234567890' })),
    ).not.toThrow();
  });

  it('is a no-op for a test key in development', () => {
    expect(() =>
      validateProductionConfig({
        env:             'development',
        jwtSecret:       'a'.repeat(64),
        stripeSecretKey: 'sk_test_localdev',
        s3Endpoint:      undefined,
      }),
    ).not.toThrow();
  });
});

// ── S3_ENDPOINT guard ──────────────────────────────────────────────────────

describe('validateProductionConfig — S3_ENDPOINT (LocalStack detection)', () => {
  it('throws when s3Endpoint is set to a localhost URL', () => {
    expect(() =>
      validateProductionConfig(validProd({ s3Endpoint: 'http://localhost:9000' })),
    ).toThrow(/S3_ENDPOINT/);
  });

  it('throws when s3Endpoint points to localstack container', () => {
    expect(() =>
      validateProductionConfig(validProd({ s3Endpoint: 'http://localstack:4566' })),
    ).toThrow(/S3_ENDPOINT/);
  });

  it('accepts absent s3Endpoint (uses AWS SDK defaults)', () => {
    expect(() =>
      validateProductionConfig(validProd({ s3Endpoint: undefined })),
    ).not.toThrow();
  });

  it('allows s3Endpoint in non-production (local dev / CI)', () => {
    expect(() =>
      validateProductionConfig({
        env:             'test',
        jwtSecret:       'a'.repeat(64),
        stripeSecretKey: 'sk_test_whatever',
        s3Endpoint:      'http://localhost:9000',
      }),
    ).not.toThrow();
  });
});
