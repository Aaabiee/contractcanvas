import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../redis.js', () => ({ getRedisClient: vi.fn().mockReturnValue(null) }));

const { checkLoginAllowed, recordFailedAttempt, clearFailedAttempts } = await import('../login-guard.js');

describe('login-guard (in-memory mode)', () => {
  beforeEach(async () => {
    await clearFailedAttempts('test@example.com');
  });

  it('allows login when no failed attempts', async () => {
    const result = await checkLoginAllowed('test@example.com');
    expect(result.allowed).toBe(true);
  });

  it('tracks failed attempts and returns remaining count', async () => {
    const r1 = await recordFailedAttempt('test@example.com');
    expect(r1.locked).toBe(false);
    expect(r1.attemptsRemaining).toBe(4);

    const r2 = await recordFailedAttempt('test@example.com');
    expect(r2.attemptsRemaining).toBe(3);
  });

  it('locks account after 5 failed attempts', async () => {
    for (let i = 0; i < 4; i++) {
      await recordFailedAttempt('lockme@example.com');
    }
    const r5 = await recordFailedAttempt('lockme@example.com');
    expect(r5.locked).toBe(true);
    expect(r5.attemptsRemaining).toBe(0);

    const check = await checkLoginAllowed('lockme@example.com');
    expect(check.allowed).toBe(false);
    expect(check.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('clearFailedAttempts resets the counter', async () => {
    await recordFailedAttempt('clear@example.com');
    await recordFailedAttempt('clear@example.com');
    await clearFailedAttempts('clear@example.com');

    const result = await checkLoginAllowed('clear@example.com');
    expect(result.allowed).toBe(true);
  });

  it('is case-insensitive for email', async () => {
    await recordFailedAttempt('Case@Example.COM');
    const r = await recordFailedAttempt('case@example.com');
    expect(r.attemptsRemaining).toBe(3);
  });
});
