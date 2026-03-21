import helmet from 'helmet';
import type { Application } from 'express';

/**
 * Apply all security-relevant HTTP response headers to an Express app.
 *
 * The API server serves JSON exclusively, so the CSP is intentionally
 * restrictive (default-src 'none').  The permissive resource directives
 * (script, style, img, connect, frame) belong in the nginx layer that
 * serves the Angular SPA — see apps/web/nginx.conf.
 *
 * OWASP mapping:
 *   A05 Security Misconfiguration — explicit CSP + HSTS close the default
 *   browser-trust gap; frame-ancestors 'none' prevents clickjacking (A01).
 */
export function applySecurityHeaders(app: Application): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:     ["'none'"],   // deny everything not explicitly listed
          scriptSrc:      ["'none'"],
          styleSrc:       ["'none'"],
          imgSrc:         ["'none'"],
          connectSrc:     ["'none'"],
          fontSrc:        ["'none'"],
          objectSrc:      ["'none'"],   // no Flash / plugins
          mediaSrc:       ["'none'"],
          frameSrc:       ["'none'"],
          frameAncestors: ["'none'"],   // clickjacking prevention (A01)
          formAction:     ["'self'"],   // block form hijacking
          baseUri:        ["'none'"],   // block base-tag injection
        },
      },
      hsts: {
        // 1 year — eligible for browser preload lists
        maxAge:            31_536_000,
        includeSubDomains: true,
        preload:           true,
      },
      frameguard:                   { action: 'deny' },
      referrerPolicy:               { policy: 'strict-origin-when-cross-origin' },
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      crossOriginEmbedderPolicy:    false, // keep off — API is not a web document
    }),
  );
}
