import { describe, it, expect, vi, afterEach } from 'vitest';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('postmark', () => ({
  ServerClient: vi.fn().mockImplementation(() => ({
    sendEmail: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: mockLogger,
}));

describe('email.service', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('is a no-op in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const { sendEmail } = await import('../email.service.js');

    await sendEmail({ to: 'a@b.com', subject: 'S', htmlBody: '<p>H</p>', textBody: 'T' });

    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('logs to console in dev when no API key is configured', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.POSTMARK_API_KEY;
    const { sendEmail } = await import('../email.service.js');

    await sendEmail({ to: 'a@b.com', subject: 'Hello', htmlBody: '<p>H</p>', textBody: 'T' });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com' }),
      expect.stringContaining('Email'),
    );
  });

  it('accepts SendEmailOpts with required fields', async () => {
    process.env.NODE_ENV = 'test';
    const { sendEmail } = await import('../email.service.js');
    await expect(
      sendEmail({ to: 'x@y.com', subject: 'sub', htmlBody: '<b>hi</b>', textBody: 'hi' }),
    ).resolves.toBeUndefined();
  });
});
