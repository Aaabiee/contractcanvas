import crypto from 'crypto';
import prisma from '../prisma.js';

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

export async function deleteSession(rawToken: string): Promise<void> {
  const hashed = hashToken(rawToken);
  await prisma.session.deleteMany({ where: { refreshToken: hashed } });
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data:  { revokedAt: new Date() },
  });
}
