import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.NODE_ENV = 'test';

vi.mock('../../config.js', () => ({
  app: { env: 'test', port: 3333 },
  db: { host: 'localhost', name: 'test', password: 'test', user: 'test', port: 5432, schema: 'public', container_name: 'test' },
  s3: { region: 'us-east-1', bucket: 'test', forcePathStyle: true },
  stripe: {},
  jwt: { secret: 'test-secret-key-for-testing' },
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
}));

const { protect, optionalAuth, requireRole } = await import('../auth.js');

function makeReq(overrides: Record<string, unknown> = {}): any {
  return {
    header: vi.fn(),
    headers: {},
    ...overrides,
  };
}

function makeRes(): { res: any; statusFn: ReturnType<typeof vi.fn>; jsonFn: ReturnType<typeof vi.fn> } {
  const jsonFn = vi.fn().mockReturnThis();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { status: statusFn, json: jsonFn };
  return { res, statusFn, jsonFn };
}

function makeNext(): any {
  return vi.fn();
}

function signToken(payload: object, secret = 'test-secret-key-for-testing') {
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

describe('protect middleware', () => {
  it('returns 401 when no Authorization header', async () => {
    const req = makeReq({ header: vi.fn().mockReturnValue(undefined) });
    const { res, statusFn, jsonFn } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'unauthorized' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for malformed Authorization header (no Bearer prefix)', async () => {
    const req = makeReq({ header: vi.fn().mockReturnValue('NotBearer token') });
    const { res, statusFn } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid/tampered token string', async () => {
    const req = makeReq({ header: vi.fn().mockReturnValue('Bearer invalid.token.here') });
    const { res, statusFn } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for token signed with wrong secret', async () => {
    const token = signToken({ sub: 'user-1', email: 'a@b.com' }, 'wrong-secret');
    const req = makeReq({ header: vi.fn().mockReturnValue(`Bearer ${token}`) });
    const { res, statusFn } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next for a valid HS256 token', async () => {
    const orgs = [{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'OWNER' }];
    const token = signToken({ sub: 'user-1', email: 'a@b.com', role: 'LAWYER', organizations: orgs });
    const req = makeReq({ header: vi.fn().mockReturnValue(`Bearer ${token}`) });
    const { res } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('user-1');
    expect(req.user.email).toBe('a@b.com');
  });

  it('sets organizationId to first org when no X-Organization-Id header', async () => {
    const orgs = [
      { id: 'org-1', name: 'Acme', slug: 'acme', role: 'OWNER' },
      { id: 'org-2', name: 'Beta', slug: 'beta', role: 'MEMBER' },
    ];
    const token = signToken({ sub: 'user-1', email: 'a@b.com', organizations: orgs });
    const headerFn = vi.fn((name: string) => name === 'Authorization' ? `Bearer ${token}` : undefined);
    const req = makeReq({ header: headerFn });
    const { res } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(req.user.organizationId).toBe('org-1');
  });

  it('resolves organizationId from X-Organization-Id header when valid', async () => {
    const orgs = [
      { id: 'org-1', name: 'Acme', slug: 'acme', role: 'OWNER' },
      { id: 'org-2', name: 'Beta', slug: 'beta', role: 'MEMBER' },
    ];
    const token = signToken({ sub: 'user-1', email: 'a@b.com', organizations: orgs });
    const headerFn = vi.fn((name: string) => {
      if (name === 'Authorization') return `Bearer ${token}`;
      if (name === 'X-Organization-Id') return 'org-2';
      return undefined;
    });
    const req = makeReq({ header: headerFn });
    const { res } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(req.user.organizationId).toBe('org-2');
  });

  it('sets organizationId to undefined when X-Organization-Id is not in user orgs', async () => {
    const orgs = [{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'OWNER' }];
    const token = signToken({ sub: 'user-1', email: 'a@b.com', organizations: orgs });
    const headerFn = vi.fn((name: string) => {
      if (name === 'Authorization') return `Bearer ${token}`;
      if (name === 'X-Organization-Id') return 'org-999';
      return undefined;
    });
    const req = makeReq({ header: headerFn });
    const { res } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user.organizationId).toBeUndefined();
  });

  it('sets organizationId to undefined when user has no orgs', async () => {
    const token = signToken({ sub: 'user-1', email: 'a@b.com', organizations: [] });
    const req = makeReq({ header: vi.fn().mockReturnValue(`Bearer ${token}`) });
    const { res } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user.organizationId).toBeUndefined();
  });
});

describe('optionalAuth middleware', () => {
  it('calls next without setting req.user when no Authorization header', async () => {
    const req = makeReq({ header: vi.fn().mockReturnValue(undefined) });
    const { res } = makeRes();
    const next = makeNext();

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeUndefined();
  });

  it('sets req.user when a valid token is present', async () => {
    const orgs = [{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'OWNER' }];
    const token = signToken({ sub: 'user-1', email: 'a@b.com', organizations: orgs });
    const req = makeReq({ header: vi.fn().mockReturnValue(`Bearer ${token}`) });
    const { res } = makeRes();
    const next = makeNext();

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('user-1');
  });

  it('calls next without error when token is invalid', async () => {
    const req = makeReq({ header: vi.fn().mockReturnValue('Bearer bad-token') });
    const { res } = makeRes();
    const next = makeNext();

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeUndefined();
  });
});

describe('protect middleware — token payload edge cases', () => {
  it('returns 401 when token has no sub and no user_id/uid', async () => {
    // Token without sub — toUser will produce id='' → protect rejects
    const token = signToken({ email: 'a@b.com', role: 'LAWYER' });
    const req = makeReq({ header: vi.fn().mockReturnValue(`Bearer ${token}`) });
    const { res, statusFn } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts token where emails is an array (Azure AD style)', async () => {
    const orgs = [{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'OWNER' }];
    const token = signToken({ sub: 'user-1', emails: ['a@b.com'], organizations: orgs });
    const req = makeReq({ header: vi.fn().mockReturnValue(`Bearer ${token}`) });
    const { res } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user.email).toBe('a@b.com');
  });

  it('extracts role from singular "role" claim via fallback loop', async () => {
    const orgs = [{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'OWNER' }];
    const token = signToken({ sub: 'user-1', role: 'lawyer', organizations: orgs });
    const req = makeReq({ header: vi.fn().mockReturnValue(`Bearer ${token}`) });
    const { res } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user.role).toBe('LAWYER');
  });

  it('extracts org roles from org_roles claim', async () => {
    const orgs = [{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'OWNER' }];
    const token = signToken({ sub: 'user-1', roles: ['lawyer'], org_roles: ['owner'], organizations: orgs });
    const req = makeReq({ header: vi.fn().mockReturnValue(`Bearer ${token}`) });
    const { res } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user.orgRole).toBe('OWNER');
    expect(req.user.orgRoles).toContain('OWNER');
  });

  it('resolves user_id as id fallback when no sub', async () => {
    // This hits the id=sub || user_id || uid branch in toUser, but since sub is missing → empty string → 401
    // Instead verify the user_id path by providing it without sub
    // The protect() returns 401 for missing id, so we just confirm user_id is not enough without sub
    const token = signToken({ user_id: 'uid-from-firebase', email: 'a@b.com' });
    const req = makeReq({ header: vi.fn().mockReturnValue(`Bearer ${token}`) });
    const { res, statusFn } = makeRes();
    const next = makeNext();

    await protect(req, res, next);

    // user_id becomes id, but sub is undefined, so id = 'uid-from-firebase' (truthy)
    // However protect checks !user.id → only 401 if empty
    // user.id = 'uid-from-firebase' which is truthy → next() gets called
    expect(next).toHaveBeenCalledWith();
    expect(req.user.id).toBe('uid-from-firebase');
  });
});

describe('requireRole middleware factory', () => {
  it('returns 401 when req.user is not set', () => {
    const guard = requireRole('ADMIN');
    const req = makeReq();
    const { res, statusFn } = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user does not have required role', () => {
    const guard = requireRole('ADMIN');
    const req = makeReq();
    req.user = { id: 'u1', roles: ['CLIENT'] };
    const { res, statusFn } = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when user has the required role', () => {
    const guard = requireRole('LAWYER');
    const req = makeReq();
    req.user = { id: 'u1', roles: ['LAWYER'] };
    const { res } = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next when user has one of multiple allowed roles', () => {
    const guard = requireRole('ADMIN', 'LAWYER');
    const req = makeReq();
    req.user = { id: 'u1', roles: ['ADMIN'] };
    const { res } = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('returns 403 when user roles are empty', () => {
    const guard = requireRole('ADMIN');
    const req = makeReq();
    req.user = { id: 'u1', roles: [] };
    const { res, statusFn } = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(403);
  });
});

// ── requireEmailVerified middleware ──────────────────────────────────────────

describe('requireEmailVerified middleware', () => {
  let requireEmailVerified: typeof import('../auth.js')['requireEmailVerified'];

  beforeEach(async () => {
    const mod = await import('../auth.js');
    requireEmailVerified = mod.requireEmailVerified;
  });

  it('returns 401 when req.user is not set', () => {
    const req = makeReq();
    const { res, statusFn, jsonFn } = makeRes();
    const next = makeNext();

    requireEmailVerified(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'unauthorized' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when emailVerified is false', () => {
    const req = makeReq();
    req.user = { id: 'u1', emailVerified: false };
    const { res, statusFn, jsonFn } = makeRes();
    const next = makeNext();

    requireEmailVerified(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'email_not_verified' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when emailVerified is true', () => {
    const req = makeReq();
    req.user = { id: 'u1', emailVerified: true };
    const { res } = makeRes();
    const next = makeNext();

    requireEmailVerified(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next when emailVerified is undefined (not set)', () => {
    const req = makeReq();
    req.user = { id: 'u1' };
    const { res } = makeRes();
    const next = makeNext();

    requireEmailVerified(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});
