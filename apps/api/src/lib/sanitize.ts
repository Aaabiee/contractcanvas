import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

const { window } = new JSDOM('');
// JSDOM's Window is compatible at runtime; the double-assertion bridges the
// mismatch between JSDOM's Window type and DOMPurify's WindowLike interface.
const purify = DOMPurify(window as unknown as Parameters<typeof DOMPurify>[0]);

/**
 * Strip any embedded HTML / script tags from a Markdown string before it is
 * persisted to the database.  Markdown text is plain-text by nature, but
 * authors can embed raw HTML inside it, which would be executed when a
 * frontend renderer displays the content.  DOMPurify removes all dangerous
 * constructs while leaving safe inline elements (links, code spans, etc.)
 * intact so that the Markdown round-trips correctly.
 */
export function sanitizeMarkdown(input: string): string {
  return purify.sanitize(input, {
    // Allow only the safe subset of HTML that Markdown renderers emit.
    ALLOWED_TAGS: [
      'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li',
      'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 's',
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
    // Force all links to use safe protocols only.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
    // Return a plain string, not a DOM node.
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });
}
