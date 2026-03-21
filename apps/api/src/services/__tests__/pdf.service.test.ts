import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../../lib/logger.js', () => ({ logger: mockLogger }));
vi.mock('../../lib/sanitize.js', () => ({
  sanitizeMarkdown: vi.fn((s: string) => s),
}));

const mockPage = {
  setContent: vi.fn().mockResolvedValue(undefined),
  pdf: vi.fn().mockResolvedValue(Buffer.from('fake-pdf')),
  close: vi.fn().mockResolvedValue(undefined),
};

let disconnectCb: (() => void) | null = null;

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
  on: vi.fn((event: string, cb: () => void) => {
    if (event === 'disconnected') disconnectCb = cb;
  }),
};

const mockPuppeteerLaunch = vi.fn().mockResolvedValue(mockBrowser);

vi.mock('puppeteer', () => ({
  default: {
    launch: mockPuppeteerLaunch,
  },
}));

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('pdf.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disconnectCb = null;
  });

  afterEach(() => {
    vi.resetModules();
  });

  const baseData = {
    title: 'Test Contract',
    status: 'ACTIVE',
    orgName: 'Acme Corp',
    generatedAt: new Date('2025-01-01T00:00:00Z'),
  };

  /* ---- escapeHtml / buildHtml (tested via generateContractPdf) ---- */

  describe('generateContractPdf', () => {
    it('generates a PDF buffer on success', async () => {
      const { generateContractPdf } = await import('../pdf.service.js');

      const result = await generateContractPdf(baseData);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(mockPuppeteerLaunch).toHaveBeenCalledOnce();
      expect(mockBrowser.newPage).toHaveBeenCalledOnce();
      expect(mockPage.setContent).toHaveBeenCalledWith(
        expect.stringContaining('Test Contract'),
        expect.objectContaining({ waitUntil: 'networkidle0' }),
      );
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'A4' }),
      );
      expect(mockPage.close).toHaveBeenCalledOnce();
    });

    it('reuses the singleton browser on subsequent calls', async () => {
      const { generateContractPdf } = await import('../pdf.service.js');

      await generateContractPdf(baseData);
      await generateContractPdf(baseData);

      // launch should only be called once
      expect(mockPuppeteerLaunch).toHaveBeenCalledOnce();
      expect(mockBrowser.newPage).toHaveBeenCalledTimes(2);
    });

    it('relaunches after a disconnect event', async () => {
      const { generateContractPdf } = await import('../pdf.service.js');

      await generateContractPdf(baseData);
      expect(mockPuppeteerLaunch).toHaveBeenCalledOnce();

      // Simulate browser disconnect
      disconnectCb!();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('disconnected'),
      );

      await generateContractPdf(baseData);
      expect(mockPuppeteerLaunch).toHaveBeenCalledTimes(2);
    });

    it('throws when puppeteer is not installed', async () => {
      mockPuppeteerLaunch.mockRejectedValueOnce(new Error('Cannot find module'));

      const { generateContractPdf } = await import('../pdf.service.js');

      await expect(generateContractPdf(baseData)).rejects.toThrow(
        'PDF generation unavailable (puppeteer not installed)',
      );
    });

    it('includes all fields in generated HTML', async () => {
      const { generateContractPdf } = await import('../pdf.service.js');

      const fullData = {
        ...baseData,
        valueCents: 150000,
        currency: 'USD',
        bodyMd: '**Important clause**',
        version: 'v2.1',
      };

      await generateContractPdf(fullData);

      const html = mockPage.setContent.mock.calls[0][0] as string;
      expect(html).toContain('Test Contract');
      expect(html).toContain('Acme Corp');
      expect(html).toContain('ACTIVE');
      expect(html).toContain('$1,500.00');
      expect(html).toContain('v2.1');
      expect(html).toContain('**Important clause**'); // sanitizeMarkdown is a passthrough mock
      expect(html).toContain('2025-01-01T00:00:00.000Z');
    });

    it('renders N/A when valueCents is null', async () => {
      const { generateContractPdf } = await import('../pdf.service.js');

      await generateContractPdf({ ...baseData, valueCents: null });

      const html = mockPage.setContent.mock.calls[0][0] as string;
      expect(html).toContain('N/A');
    });

    it('omits version section when version is not provided', async () => {
      const { generateContractPdf } = await import('../pdf.service.js');

      await generateContractPdf(baseData);

      const html = mockPage.setContent.mock.calls[0][0] as string;
      expect(html).not.toContain('Version:');
    });

    it('escapes HTML special characters in fields', async () => {
      const { generateContractPdf } = await import('../pdf.service.js');

      const data = {
        ...baseData,
        title: '<script>alert("xss")</script>',
        orgName: 'Org & "Partners"',
      };

      await generateContractPdf(data);

      const html = mockPage.setContent.mock.calls[0][0] as string;
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&amp;');
      expect(html).toContain('&quot;Partners&quot;');
      expect(html).not.toContain('<script>alert');
    });
  });

  describe('closeBrowser', () => {
    it('closes the running browser and clears the singleton', async () => {
      const { generateContractPdf, closeBrowser } = await import('../pdf.service.js');

      await generateContractPdf(baseData);
      await closeBrowser();

      expect(mockBrowser.close).toHaveBeenCalledOnce();

      // After closing, next generateContractPdf should re-launch
      await generateContractPdf(baseData);
      expect(mockPuppeteerLaunch).toHaveBeenCalledTimes(2);
    });

    it('is a no-op when no browser is running', async () => {
      const { closeBrowser } = await import('../pdf.service.js');

      // Should not throw
      await expect(closeBrowser()).resolves.toBeUndefined();
      expect(mockBrowser.close).not.toHaveBeenCalled();
    });
  });
});
