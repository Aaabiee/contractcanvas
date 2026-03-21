import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.PLATFORM_SUPPORT_SECRET = 'test-support-secret';

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/audit.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const { generateSupportToken, supportAccessGuard, revokeSupportToken, activeTokens } = await import('../support-access.js');

function buildApp() {
  const app = express();
  app.use(supportAccessGuard);
  app.get('/api/matters', (req, res) => res.json({ user: (req as any).user }));
  app.post('/api/matters', (req, res) => res.json({ ok: true }));
  return app;
}

describe('supportAccessGuard', () => {
  it('passes through when no X-Support-Token header', async () => {
    const res = await request(buildApp()).get('/api/matters');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeUndefined();
  });

  it('grants read-only access with valid support token', async () => {
    const token = generateSupportToken('org-1', 'agent-alice');
    const res = await request(buildApp())
      .get('/api/matters')
      .set('X-Support-Token', token);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('support:agent-alice');
    expect(res.body.user.organizationId).toBe('org-1');
  });

  it('blocks write operations with support token', async () => {
    const token = generateSupportToken('org-1', 'agent-bob');
    const res = await request(buildApp())
      .post('/api/matters')
      .set('X-Support-Token', token);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('read-only');
  });

  it('rejects invalid token', async () => {
    const res = await request(buildApp())
      .get('/api/matters')
      .set('X-Support-Token', 'invalid-token-here');
    expect(res.status).toBe(401);
  });

  it('revokeSupportToken invalidates the token', async () => {
    const token = generateSupportToken('org-1', 'agent-carol');
    expect(revokeSupportToken(token)).toBe(true);

    const res = await request(buildApp())
      .get('/api/matters')
      .set('X-Support-Token', token);
    expect(res.status).toBe(401);
  });

  it('rejects expired token', async () => {
    const token = generateSupportToken('org-1', 'agent-dave');
    const entry = activeTokens.get(token);
    if (entry) entry.expiresAt = Date.now() - 1000;

    const res = await request(buildApp())
      .get('/api/matters')
      .set('X-Support-Token', token);
    expect(res.status).toBe(401);
  });
});
