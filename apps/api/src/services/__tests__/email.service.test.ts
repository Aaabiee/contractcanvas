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

  it('sends email via Postmark client when API key is configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.POSTMARK_API_KEY = 'pm-test-key';
    delete process.env.EMAIL_FROM;

    const mockSendEmail = vi.fn().mockResolvedValue({});
    const postmarkMod = await import('postmark');
    (postmarkMod.ServerClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      sendEmail: mockSendEmail,
    }));

    const { sendEmail } = await import('../email.service.js');

    await sendEmail({
      to: 'recipient@example.com',
      subject: 'Test Subject',
      htmlBody: '<p>Hello</p>',
      textBody: 'Hello',
    });

    expect(mockSendEmail).toHaveBeenCalledWith({
      From: 'noreply@contractcanvas.app',
      To: 'recipient@example.com',
      Subject: 'Test Subject',
      HtmlBody: '<p>Hello</p>',
      TextBody: 'Hello',
    });

    delete process.env.POSTMARK_API_KEY;
  });

  it('uses custom EMAIL_FROM when set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.POSTMARK_API_KEY = 'pm-test-key-2';
    process.env.EMAIL_FROM = 'custom@example.com';

    const mockSendEmail = vi.fn().mockResolvedValue({});
    const postmarkMod = await import('postmark');
    (postmarkMod.ServerClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      sendEmail: mockSendEmail,
    }));

    const { sendEmail } = await import('../email.service.js');

    await sendEmail({
      to: 'someone@example.com',
      subject: 'Hi',
      htmlBody: '<p>Hi</p>',
      textBody: 'Hi',
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        From: 'custom@example.com',
      }),
    );

    delete process.env.POSTMARK_API_KEY;
    delete process.env.EMAIL_FROM;
  });
});
