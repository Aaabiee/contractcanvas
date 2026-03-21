import { describe, it, expect } from 'vitest';
import { sanitizeMarkdown } from '../sanitize.js';

describe('sanitizeMarkdown()', () => {
  it('passes plain Markdown text through unchanged', () => {
    const input = '## Heading\n\nSome **bold** and _italic_ text.';
    expect(sanitizeMarkdown(input)).toBe(input);
  });

  it('strips <script> tags', () => {
    const result = sanitizeMarkdown('<script>alert("xss")</script>Hello');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert');
    expect(result).toContain('Hello');
  });

  it('strips onerror and other event handlers from img tags', () => {
    const result = sanitizeMarkdown('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain('onerror');
    // img is not in ALLOWED_TAGS so the tag itself should be stripped
    expect(result).not.toContain('<img');
  });

  it('strips javascript: hrefs', () => {
    const result = sanitizeMarkdown('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });

  it('preserves safe anchor tags', () => {
    const result = sanitizeMarkdown('<a href="https://example.com">link</a>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('link');
  });

  it('preserves code blocks', () => {
    const result = sanitizeMarkdown('<pre><code>const x = 1;</code></pre>');
    expect(result).toContain('<pre>');
    expect(result).toContain('<code>');
  });

  it('strips iframe tags', () => {
    const result = sanitizeMarkdown('<iframe src="https://evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
  });

  it('strips style attributes', () => {
    const result = sanitizeMarkdown('<p style="background:url(javascript:alert(1))">text</p>');
    expect(result).not.toContain('style=');
  });

  it('strips data: URIs in hrefs', () => {
    const result = sanitizeMarkdown('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(result).not.toContain('data:');
  });

  it('preserves mailto: links', () => {
    const result = sanitizeMarkdown('<a href="mailto:user@example.com">email</a>');
    expect(result).toContain('mailto:user@example.com');
  });
});
