import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('postmark', () => ({
  ServerClient: vi.fn().mockImplementation(() => ({
    sendEmail: vi.fn().mockResolvedValue({}),
  })),
}));

describe('email.service', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });

  it('is a no-op in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const { sendEmail } = await import('../email.service.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail({ to: 'a@b.com', subject: 'S', htmlBody: '<p>H</p>', textBody: 'T' });

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('logs to console in dev when no API key is configured', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.POSTMARK_API_KEY;
    const { sendEmail } = await import('../email.service.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail({ to: 'a@b.com', subject: 'Hello', htmlBody: '<p>H</p>', textBody: 'T' });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('a@b.com'));
    consoleSpy.mockRestore();
  });

  it('accepts SendEmailOpts with required fields', async () => {
    process.env.NODE_ENV = 'test';
    const { sendEmail } = await import('../email.service.js');
    await expect(
      sendEmail({ to: 'x@y.com', subject: 'sub', htmlBody: '<b>hi</b>', textBody: 'hi' }),
    ).resolves.toBeUndefined();
  });
});
