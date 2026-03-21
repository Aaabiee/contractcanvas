import { getRedisClient } from './redis.js';

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900;
const ATTEMPT_WINDOW_SECONDS = 3600;

const memoryStore = new Map<string, { count: number; lockedUntil: number }>();

function key(email: string): string {
  return `login_attempts:${email.toLowerCase()}`;
}

export async function checkLoginAllowed(email: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const redis = getRedisClient();
  const k = key(email);

  if (redis) {
    const lockTtl = await redis.ttl(`${k}:lock`);
    if (lockTtl > 0) {
      return { allowed: false, retryAfterSeconds: lockTtl };
    }
    return { allowed: true };
  }

  const entry = memoryStore.get(k);
  if (entry && entry.lockedUntil > Date.now()) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  return { allowed: true };
}

export async function recordFailedAttempt(email: string): Promise<{ locked: boolean; attemptsRemaining: number }> {
  const redis = getRedisClient();
  const k = key(email);

  if (redis) {
    const count = await redis.incr(k);
    if (count === 1) {
      await redis.expire(k, ATTEMPT_WINDOW_SECONDS);
    }
    if (count >= MAX_ATTEMPTS) {
      await redis.set(`${k}:lock`, '1', 'EX', LOCKOUT_SECONDS);
      await redis.del(k);
      return { locked: true, attemptsRemaining: 0 };
    }
    return { locked: false, attemptsRemaining: MAX_ATTEMPTS - count };
  }

  const entry = memoryStore.get(k) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_SECONDS * 1000;
    entry.count = 0;
    memoryStore.set(k, entry);
    return { locked: true, attemptsRemaining: 0 };
  }
  memoryStore.set(k, entry);
  setTimeout(() => memoryStore.delete(k), ATTEMPT_WINDOW_SECONDS * 1000);
  return { locked: false, attemptsRemaining: MAX_ATTEMPTS - entry.count };
}

export async function clearFailedAttempts(email: string): Promise<void> {
  const redis = getRedisClient();
  const k = key(email);
  if (redis) {
    await redis.del(k);
    await redis.del(`${k}:lock`);
  } else {
    memoryStore.delete(k);
  }
}
