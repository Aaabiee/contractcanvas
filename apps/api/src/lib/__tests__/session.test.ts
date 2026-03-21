import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockPrisma = vi.hoisted(() => ({
  session: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../../prisma.js', () => ({ default: mockPrisma }));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

import {
  createSession,
  rotateSession,
  deleteSession,
  revokeAllUserSessions,
  REFRESH_TTL_MS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_OPTS,
} from '../session.js';

describe('session module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.session.findMany.mockResolvedValue([]);
    mockPrisma.session.create.mockResolvedValue({});
  });

  /* ---- Constants ------------------------------------------------- */

  describe('constants', () => {
    it('exports REFRESH_TTL_MS as 30 days', () => {
      expect(REFRESH_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('exports REFRESH_COOKIE name', () => {
      expect(REFRESH_COOKIE).toBe('cc_rt');
    });

    it('exports REFRESH_COOKIE_OPTS with httpOnly and strict sameSite', () => {
      expect(REFRESH_COOKIE_OPTS.httpOnly).toBe(true);
      expect(REFRESH_COOKIE_OPTS.sameSite).toBe('strict');
      expect(REFRESH_COOKIE_OPTS.path).toBe('/api/auth');
    });
  });

  /* ---- createSession --------------------------------------------- */

  describe('createSession', () => {
    it('returns a raw token string', async () => {
      const raw = await createSession('user-1', '1.2.3.4', 'Mozilla/5.0');

      expect(typeof raw).toBe('string');
      expect(raw.length).toBe(64); // 32 bytes hex-encoded
    });

    it('creates a session record with hashed token', async () => {
      const raw = await createSession('user-1', '1.2.3.4', 'Mozilla/5.0');

      expect(mockPrisma.session.create).toHaveBeenCalledOnce();
      const createCall = mockPrisma.session.create.mock.calls[0][0];
      expect(createCall.data.userId).toBe('user-1');
      expect(createCall.data.ip).toBe('1.2.3.4');
      expect(createCall.data.userAgent).toBe('Mozilla/5.0');
      // The stored token should be a SHA-256 hash of the raw token
      expect(createCall.data.refreshToken).toBe(hashToken(raw));
      expect(createCall.data.expiresAt).toBeInstanceOf(Date);
    });

    it('handles null ip and userAgent gracefully', async () => {
      await createSession('user-1');

      const createCall = mockPrisma.session.create.mock.calls[0][0];
      expect(createCall.data.ip).toBeNull();
      expect(createCall.data.userAgent).toBeNull();
    });

    it('does not revoke sessions when under MAX_SESSIONS limit', async () => {
      mockPrisma.session.findMany.mockResolvedValue([
        { id: 's1' },
        { id: 's2' },
      ]);

      await createSession('user-1');

      expect(mockPrisma.session.updateMany).not.toHaveBeenCalled();
    });

    it('revokes oldest sessions when at MAX_SESSIONS limit (5)', async () => {
      mockPrisma.session.findMany.mockResolvedValue([
        { id: 's1' },
        { id: 's2' },
        { id: 's3' },
        { id: 's4' },
        { id: 's5' },
      ]);

      await createSession('user-1');

      expect(mockPrisma.session.updateMany).toHaveBeenCalledOnce();
      const updateCall = mockPrisma.session.updateMany.mock.calls[0][0];
      // Should revoke the oldest session to make room for the new one
      expect(updateCall.where.id.in).toEqual(['s1']);
      expect(updateCall.data.revokedAt).toBeInstanceOf(Date);
    });

    it('revokes multiple oldest sessions when well over limit', async () => {
      mockPrisma.session.findMany.mockResolvedValue([
        { id: 's1' },
        { id: 's2' },
        { id: 's3' },
        { id: 's4' },
        { id: 's5' },
        { id: 's6' },
        { id: 's7' },
      ]);

      await createSession('user-1');

      const updateCall = mockPrisma.session.updateMany.mock.calls[0][0];
      // 7 sessions - 5 + 1 = 3 sessions to revoke
      expect(updateCall.where.id.in).toEqual(['s1', 's2', 's3']);
    });
  });

  /* ---- rotateSession --------------------------------------------- */

  describe('rotateSession', () => {
    it('returns null when session is not found', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      const result = await rotateSession('some-raw-token');

      expect(result).toBeNull();
    });

    it('returns null when session is already revoked', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
        ip: null,
      });

      const result = await rotateSession('some-raw-token');

      expect(result).toBeNull();
    });

    it('returns null when session is expired', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 100000), // expired
        ip: null,
      });

      const result = await rotateSession('some-raw-token');

      expect(result).toBeNull();
    });

    it('revokes and returns null on IP mismatch', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
        ip: '1.1.1.1',
      });

      const result = await rotateSession('some-raw-token', '2.2.2.2');

      expect(result).toBeNull();
      expect(mockPrisma.session.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('does not check IP when session has no stored IP', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
        ip: null,
      });
      mockPrisma.$transaction.mockResolvedValue([]);

      const result = await rotateSession('some-raw-token', '2.2.2.2');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('u1');
    });

    it('does not check IP when caller provides no IP', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
        ip: '1.1.1.1',
      });
      mockPrisma.$transaction.mockResolvedValue([]);

      const result = await rotateSession('some-raw-token');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('u1');
    });

    it('rotates token successfully on valid session with matching IP', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
        ip: '1.1.1.1',
      });
      mockPrisma.$transaction.mockResolvedValue([]);

      const result = await rotateSession('some-raw-token', '1.1.1.1', 'Chrome');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('u1');
      expect(typeof result!.newRaw).toBe('string');
      expect(result!.newRaw.length).toBe(64);

      // Should delete old and create new in a transaction
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
      const txArgs = mockPrisma.$transaction.mock.calls[0][0];
      expect(txArgs).toHaveLength(2);
    });
  });

  /* ---- deleteSession --------------------------------------------- */

  describe('deleteSession', () => {
    it('deletes session by hashed token', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 1 });

      await deleteSession('raw-token-value');

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { refreshToken: hashToken('raw-token-value') },
      });
    });

    it('is a no-op when token does not match any session', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });

      // Should not throw
      await expect(deleteSession('nonexistent')).resolves.toBeUndefined();
    });
  });

  /* ---- revokeAllUserSessions ------------------------------------- */

  describe('revokeAllUserSessions', () => {
    it('revokes all active sessions for a user', async () => {
      mockPrisma.session.updateMany.mockResolvedValue({ count: 3 });

      await revokeAllUserSessions('user-1');

      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('handles user with no active sessions gracefully', async () => {
      mockPrisma.session.updateMany.mockResolvedValue({ count: 0 });

      await expect(revokeAllUserSessions('user-no-sessions')).resolves.toBeUndefined();
    });
  });
});
