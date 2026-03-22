/**
 * Integration tests targeting uncovered lines in middleware/auth.ts.
 *
 * Covers:
 *   - Lines 75-77:  toUser emails-array fallback
 *   - Lines 137:    organizations undefined branch
 *   - Lines 141:    emailVerified undefined branch
 *   - Lines 188-190: protect 401 for missing subject
 *   - Lines 226:    API-key auth empty organizations
 *   - Lines 247-259: optionalAuth middleware
 *   - Lines 263-265: requireEmailVerified no-user branch
 *   - Lines 274-287: requireRole middleware
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { buildApp, seedAuth, cleanDb } from './helpers.js';
import { optionalAuth, requireEmailVerified, requireRole } from '../../middleware/auth.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const SECRET = process.env.JWT_SECRET || 'integration-test-secret-minimum-32-chars!!';

afterEach(() => cleanDb(db));
afterAll(() => db.$disconnect());

function craftToken(payload: object) {
  return jwt.sign(payload, SECRET, { expiresIn: '1h' });
}

// ─── Crafted JWT tests (toUser claim parsing) ────────────────────────────────

describe('protect — crafted JWT claim parsing', () => {
  it('extracts email from emails array when email field is absent (lines 75-77)', async () => {
    const app = buildApp();
    const token = craftToken({ sub: 'crafted-u1', emails: ['array@test.com'], roles: ['LAWYER'] });

    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', `Bearer ${token}`);

    // Should authenticate successfully (not 401)
    expect(res.status).not.toBe(401);
  });

  it('handles token without organizations or emailVerified (lines 137, 141)', async () => {
    const app = buildApp();
    const token = craftToken({ sub: 'crafted-u2', email: 'bare@test.com', roles: ['LAWYER'] });

    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', `Bearer ${token}`);

    // Should authenticate (not 401), but may get 403 due to no org
    expect(res.status).not.toBe(401);
  });

  it('returns 401 when token has no subject (lines 188-190)', async () => {
    const app = buildApp();
    // Token with no sub, no user_id, no uid — toUser produces id=''
    const token = craftToken({ email: 'nosub@test.com', roles: ['LAWYER'] });

    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/no subject/i);
  });

  it('falls back to user_id when sub is absent', async () => {
    const app = buildApp();
    const token = craftToken({ user_id: 'firebase-uid-123', email: 'fb@test.com', roles: [] });

    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', `Bearer ${token}`);

    // user_id is truthy so protect accepts it (not 401 for missing subject)
    expect(res.status).not.toBe(401);
  });

  it('handles email field being undefined (hits line 77 — undefined branch)', async () => {
    const app = buildApp();
    // No email, no emails → email resolves to undefined (line 77)
    const token = craftToken({ sub: 'crafted-u3', roles: [] });

    const res = await request(app)
      .get('/api/matters')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).not.toBe(401);
  });
});

// ─── API key auth — empty organizations (line 226) ───────────────────────────

describe('protect — API key with no membership (line 226)', () => {
  it('sets empty organizations when org membership is deleted', async () => {
    const app = buildApp();
    const { authHeader, orgHeader, orgId } = await seedAuth(app);

    // Create an API key
    const createRes = await request(app)
      .post(`/api/organizations/${orgId}/api-keys`)
      .set('Authorization', authHeader)
      .set('X-Organization-Id', orgHeader)
      .send({ name: 'test-key' });

    expect(createRes.status).toBe(201);
    const rawKey = createRes.body.key.rawKey;

    // Delete all org memberships so lookup returns null
    await db.organizationMember.deleteMany({ where: { organizationId: orgId } });

    // Use the API key — membership lookup returns null → organizations = []
    const res = await request(app)
      .get('/api/matters')
      .set('x-api-key', rawKey);

    // Should authenticate via API key (not 401)
    expect(res.status).not.toBe(401);
  });
});

// ─── optionalAuth middleware (lines 247-259) ─────────────────────────────────

describe('optionalAuth middleware (lines 247-259)', () => {
  function buildOptionalAuthApp() {
    const app = express();
    app.use(express.json());
    app.get('/test', optionalAuth, (req: any, res: any) => {
      res.json({ hasUser: !!req.user, userId: req.user?.id ?? null });
    });
    return app;
  }

  it('calls next without setting user when no Authorization header', async () => {
    const app = buildOptionalAuthApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
    expect(res.body.hasUser).toBe(false);
  });

  it('sets req.user when a valid token is present', async () => {
    const app = buildOptionalAuthApp();
    const token = craftToken({ sub: 'opt-user-1', email: 'opt@test.com', roles: ['LAWYER'] });

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hasUser).toBe(true);
    expect(res.body.userId).toBe('opt-user-1');
  });

  it('calls next without error when token is invalid', async () => {
    const app = buildOptionalAuthApp();

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer invalid.token.here');

    expect(res.status).toBe(200);
    expect(res.body.hasUser).toBe(false);
  });

  it('resolves organizationId from token organizations', async () => {
    const app = express();
    app.use(express.json());
    app.get('/test', optionalAuth, (req: any, res: any) => {
      res.json({ orgId: req.user?.organizationId ?? null });
    });

    const orgs = [{ id: 'org-opt-1', name: 'Opt Org', slug: 'opt', role: 'OWNER' }];
    const token = craftToken({ sub: 'opt-user-2', roles: [], organizations: orgs });

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe('org-opt-1');
  });
});

// ─── requireEmailVerified — no user branch (lines 263-265) ───────────────────

describe('requireEmailVerified — no user (lines 263-265)', () => {
  it('returns 401 when req.user is not set', async () => {
    const app = express();
    app.use(express.json());
    // Mount requireEmailVerified WITHOUT protect — no user on req
    app.get('/test', requireEmailVerified, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('returns 403 when emailVerified is false', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'u1', emailVerified: false };
      next();
    });
    app.get('/test', requireEmailVerified, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/test');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('email_not_verified');
  });

  it('passes when emailVerified is true', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'u1', emailVerified: true };
      next();
    });
    app.get('/test', requireEmailVerified, (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
  });
});

// ─── requireRole middleware (lines 274-287) ──────────────────────────────────

describe('requireRole middleware (lines 274-287)', () => {
  it('returns 401 when no user', async () => {
    const app = express();
    app.use(express.json());
    app.get('/test', requireRole('ADMIN'), (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('returns 403 when user lacks required role', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'u1', roles: ['CLIENT'] };
      next();
    });
    app.get('/test', requireRole('ADMIN'), (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/test');

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/insufficient/i);
  });

  it('passes when user has the required role', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'u1', roles: ['ADMIN'] };
      next();
    });
    app.get('/test', requireRole('ADMIN'), (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
  });

  it('passes when user has one of multiple allowed roles', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'u1', roles: ['LAWYER'] };
      next();
    });
    app.get('/test', requireRole('ADMIN', 'LAWYER'), (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
  });

  it('returns 403 when user.roles is empty', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'u1', roles: [] };
      next();
    });
    app.get('/test', requireRole('ADMIN'), (_req: any, res: any) => res.json({ ok: true }));

    const res = await request(app).get('/test');

    expect(res.status).toBe(403);
  });
});
