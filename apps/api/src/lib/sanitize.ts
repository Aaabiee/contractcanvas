import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

const { window } = new JSDOM('');
const purify = DOMPurify(window as unknown as Parameters<typeof DOMPurify>[0]);

export function sanitizeMarkdown(input: string): string {
  return purify.sanitize(input, {
    ALLOWED_TAGS: [
      'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li',
      'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 's',
    ],
    ALLOWED_ATTR:       ['href', 'title', 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
    RETURN_DOM:         false,
    RETURN_DOM_FRAGMENT: false,
  });
}
