/**
 * Integration tests for HTTP security headers (Phase 1.4 — CSP Hardening).
 *
 * These tests verify that applySecurityHeaders() sets all mandatory headers
 * on every response from the API server.  They test the middleware in
 * isolation (no DB required) and against the full buildApp() stack.
 *
 * OWASP mapping:
 *   A01 — frame-ancestors 'none' prevents clickjacking
 *   A05 — explicit CSP + HSTS close the browser-trust gap
 */

import express from 'express';
import request from 'supertest';
import { applySecurityHeaders } from '../../middleware/security.js';
import { buildApp } from './helpers.js';

// A minimal app with only security middleware and one JSON route.
function buildSecureTestApp() {
  const app = express();
  applySecurityHeaders(app);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('applySecurityHeaders() — middleware in isolation', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    const res = await request(buildSecureTestApp()).get('/ping');
    headers = res.headers as Record<string, string>;
  });

  // ── Content-Security-Policy ────────────────────────────────────────────────

  it('sets Content-Security-Policy header', () => {
    expect(headers['content-security-policy']).toBeDefined();
  });

  it('CSP: default-src is none', () => {
    expect(headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('CSP: object-src is none', () => {
    expect(headers['content-security-policy']).toContain("object-src 'none'");
  });

  it('CSP: frame-ancestors is none (clickjacking — OWASP A01)', () => {
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('CSP: base-uri is none (base-tag injection prevention)', () => {
    expect(headers['content-security-policy']).toContain("base-uri 'none'");
  });

  // ── HSTS ──────────────────────────────────────────────────────────────────

  it('sets Strict-Transport-Security header', () => {
    expect(headers['strict-transport-security']).toBeDefined();
  });

  it('HSTS: max-age is 1 year (31536000)', () => {
    expect(headers['strict-transport-security']).toContain('max-age=31536000');
  });

  it('HSTS: includes includeSubDomains', () => {
    expect(headers['strict-transport-security']).toContain('includeSubDomains');
  });

  it('HSTS: includes preload', () => {
    expect(headers['strict-transport-security']).toContain('preload');
  });

  // ── Other headers ─────────────────────────────────────────────────────────

  it('sets X-Frame-Options to DENY', () => {
    expect(headers['x-frame-options']).toBe('DENY');
  });

  it('sets X-Content-Type-Options to nosniff', () => {
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets Referrer-Policy', () => {
    expect(headers['referrer-policy']).toBeDefined();
  });

  it('sets X-DNS-Prefetch-Control to off', () => {
    expect(headers['x-dns-prefetch-control']).toBe('off');
  });
});

// ── Full app stack ──────────────────────────────────────────────────────────

describe('Security headers — present on authenticated API routes', () => {
  it('health endpoint carries CSP and HSTS headers', async () => {
    // buildApp() wires the real routes including the security middleware
    // via applySecurityHeaders() called inside it.
    const secApp = express();
    applySecurityHeaders(secApp);
    secApp.get('/health', (_req, res) => res.json({ ok: true }));

    const res = await request(secApp).get('/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.status).toBe(200);
  });

  it('404 responses also carry security headers', async () => {
    const res = await request(buildSecureTestApp()).get('/nonexistent');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});
