import { TestBed } from '@angular/core/testing';
import { BrowserModule } from '@angular/platform-browser';
import { SafeHtmlPipe } from './safe-html.pipe';
import DOMPurify from 'dompurify';

describe('SafeHtmlPipe', () => {
  let pipe: SafeHtmlPipe;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BrowserModule, SafeHtmlPipe] });
    pipe = TestBed.runInInjectionContext(() => new SafeHtmlPipe());
    (DOMPurify.sanitize as jest.Mock).mockImplementation((v: string) => v);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates successfully', () => expect(pipe).toBeTruthy());

  it('returns empty string for null input', () => {
    expect(pipe.transform(null)).toBe('');
    expect(DOMPurify.sanitize).not.toHaveBeenCalled();
  });

  it('returns empty string for undefined input', () => {
    expect(pipe.transform(undefined)).toBe('');
  });

  it('calls DOMPurify.sanitize with the input value', () => {
    pipe.transform('<b>hello</b>');
    expect(DOMPurify.sanitize).toHaveBeenCalledWith('<b>hello</b>', expect.any(Object));
  });

  it('passes allowed tags config to DOMPurify', () => {
    pipe.transform('<p>text</p>');
    const call = (DOMPurify.sanitize as jest.Mock).mock.calls[0];
    expect(call[1]).toMatchObject({ ALLOWED_TAGS: expect.arrayContaining(['b', 'p', 'code', 'a']) });
  });

  it('disallows data attributes via config', () => {
    pipe.transform('<p>text</p>');
    const call = (DOMPurify.sanitize as jest.Mock).mock.calls[0];
    expect(call[1].ALLOW_DATA_ATTR).toBe(false);
  });

  it('returns a SafeHtml object (truthy) for non-empty input', () => {
    const result = pipe.transform('<b>bold</b>');
    expect(result).toBeTruthy();
  });
});
