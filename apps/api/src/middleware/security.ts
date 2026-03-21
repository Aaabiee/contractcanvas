import helmet from 'helmet';
import type { Application } from 'express';

export function applySecurityHeaders(app: Application): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:     ["'none'"],
          scriptSrc:      ["'none'"],
          styleSrc:       ["'none'"],
          imgSrc:         ["'none'"],
          connectSrc:     ["'none'"],
          fontSrc:        ["'none'"],
          objectSrc:      ["'none'"],
          mediaSrc:       ["'none'"],
          frameSrc:       ["'none'"],
          frameAncestors: ["'none'"],
          formAction:     ["'self'"],
          baseUri:        ["'none'"],
        },
      },
      hsts: {
        maxAge:            31_536_000,
        includeSubDomains: true,
        preload:           true,
      },
      frameguard:                   { action: 'deny' },
      referrerPolicy:               { policy: 'strict-origin-when-cross-origin' },
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      crossOriginEmbedderPolicy:    false,
    }),
  );
}
