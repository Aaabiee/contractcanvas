import crypto from 'crypto';
import prisma from '../prisma.js';

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const REFRESH_COOKIE = 'cc_rt';

export const REFRESH_COOKIE_OPTS = {
  httpOnly:  true,
  secure:    process.env.NODE_ENV === 'production',
  sameSite:  'strict' as const,
  path:      '/api/auth',
  maxAge:    REFRESH_TTL_MS,
};

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateRawToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new session row and return the raw (unhashed) refresh token.
 * The raw token is set as an httpOnly cookie — never stored in plaintext.
 */
export async function createSession(
  userId:    string,
  ip?:       string | null,
  userAgent?: string | null,
): Promise<string> {
  const raw = generateRawToken();
  await prisma.session.create({
    data: {
      userId,
      refreshToken: hashToken(raw),
      expiresAt:    new Date(Date.now() + REFRESH_TTL_MS),
      ip:           ip ?? null,
      userAgent:    userAgent ?? null,
    },
  });
  return raw;
}

/**
 * Validate a raw refresh token and atomically rotate it:
 * deletes the old session row and creates a new one.
 * Returns the new raw token + userId, or null if the token is
 * invalid, revoked, or expired.
 */
export async function rotateSession(
  rawToken:  string,
  ip?:       string | null,
  userAgent?: string | null,
): Promise<{ newRaw: string; userId: string } | null> {
  const hashed  = hashToken(rawToken);
  const session = await prisma.session.findUnique({ where: { refreshToken: hashed } });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return null;
  }

  const newRaw = generateRawToken();

  await prisma.$transaction([
    prisma.session.delete({ where: { id: session.id } }),
    prisma.session.create({
      data: {
        userId:       session.userId,
        refreshToken: hashToken(newRaw),
        expiresAt:    new Date(Date.now() + REFRESH_TTL_MS),
        ip:           ip ?? null,
        userAgent:    userAgent ?? null,
      },
    }),
  ]);

  return { newRaw, userId: session.userId };
}

/**
 * Delete the session identified by a raw refresh token (user-initiated logout).
 */
export async function deleteSession(rawToken: string): Promise<void> {
  const hashed = hashToken(rawToken);
  await prisma.session.deleteMany({ where: { refreshToken: hashed } });
}

/**
 * Revoke ALL active sessions for a user.
 * Call this on password change, forced logout, or account suspension.
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data:  { revokedAt: new Date() },
  });
}
