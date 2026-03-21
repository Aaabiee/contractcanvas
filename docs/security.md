---
layout: default
title: Security
---

# Security

ContractCanvas implements defense-in-depth across the full stack. This document covers the security model and OWASP mitigations.

## Authentication

### JWT Access Tokens

- Algorithm: HS256 (symmetric) or RS256 (via JWKS for external IdPs)
- TTL: 15 minutes
- Contains: `sub`, `email`, `role`, `organizations`, `emailVerified`, `jti`
- Stored in memory only (never localStorage)
- Each token has a unique `jti` for revocation

### Refresh Tokens

- 32-byte cryptographically random values
- SHA-256 hashed before storage in the `Session` table
- Delivered via `Set-Cookie: HttpOnly; Secure; SameSite=Strict; Path=/api/auth`
- Rotated on every use (old token invalidated)
- Max age: 30 days

### Token Revocation

- On logout: JWT `jti` is added to Redis blacklist with TTL matching remaining validity
- On password change: all user sessions revoked (`revokeAllUserSessions`)
- On member removal: all sessions for removed user revoked
- `protect` middleware checks Redis blacklist before processing requests

### API Key Authentication

- Alternative to JWT for programmatic access
- Raw key returned only once at creation time
- SHA-256 hashed before storage
- Scoped to a single organization
- `revokedAt` field for key rotation

## OWASP Top 10 Mitigations

### A01: Broken Access Control (IDOR Prevention)

Every database query in route handlers includes `organizationId` from `req.user.organizationId` (derived from the JWT, not from request parameters). This prevents cross-tenant data access even if a resource ID is known.

Share links use org-scoped resource verification: `fetchResource()` validates that the resource still belongs to the organization that created the share link.

### A02: Cryptographic Failures

- Passwords: bcrypt with cost factor 12
- Tokens: `crypto.randomBytes(32)` (256-bit entropy)
- Token storage: SHA-256 hashed before database write
- Webhook signatures: HMAC-SHA256 with timing-safe comparison
- No secrets in JWT claims or client-side storage

### A03: Injection

- SQL injection: Prisma ORM with parameterized queries (no raw SQL)
- NoSQL injection: N/A (PostgreSQL only)
- Command injection: No `child_process.exec()`, `eval()`, or `Function()` calls
- HTML injection: Email templates escape user input with `escapeHtml()`
- XSS: DOMPurify sanitization on all user-generated HTML content

### A04: Insecure Design

- Multi-tenant isolation enforced at the data layer
- Rate limiting on auth endpoints (20 req/15min)
- API-wide rate limiting (300 req/15min per IP)
- File upload restrictions: whitelist of MIME types and extensions
- Anti-enumeration: login, forgot-password, and resend-verification return identical responses regardless of email existence

### A05: Security Misconfiguration

- Helmet.js security headers (X-Content-Type-Options, X-Frame-Options, CSP)
- CORS restricted to configured `FRONTEND_URL` origins
- `trust proxy: 1` for correct IP resolution behind reverse proxy
- Production error handler suppresses internal error details
- Bull Board admin panel requires `X-Admin-Token` header

### A06: Vulnerable Components

- Dependencies managed via npm with `package-lock.json`
- CI runs `npm audit` on every build
- Prisma client auto-generated from schema (no manual SQL)

### A07: Authentication Failures

- Password policy: min 8 chars (12 for changes), uppercase, lowercase, digit, special char
- Bcrypt cost factor 12 (adaptive hashing)
- Rate limiting prevents brute force (20 attempts per 15 minutes)
- Account lockout not implemented (rate limiting is sufficient)
- Email verification required for sensitive operations

### A08: Software and Data Integrity

- Webhook signature verification: HMAC-SHA256 for DocuSign, HelloSign, and Stripe
- Stripe webhooks receive raw body for signature verification
- CI pipeline validates TypeScript compilation and test passage

### A09: Security Logging and Monitoring

- Pino structured logging with request IDs
- Audit log table records all sensitive operations (create, update, delete, export, login)
- Sentry error tracking for production
- Failed auth attempts logged with IP and user-agent

### A10: Server-Side Request Forgery (SSRF)

- Outbound webhook URLs validated against private IP ranges
- Blocked ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`
- Also blocks `localhost`, `.local`, `.internal` hostnames
- Production requires HTTPS for webhook URLs

## Additional Protections

### Path Traversal

- Document storage uses generated keys (`orgs/<orgId>/matters/<matterId>/<timestamp>-<random>.<ext>`)
- User-supplied filenames are sanitized before use in `Content-Disposition` headers
- No file paths derived from user input

### Rate Limiting

| Scope | Limit | Window |
|-------|-------|--------|
| Auth routes | 20 requests | 15 minutes |
| API routes | 300 requests | 15 minutes |
| API key routes | 1000 requests | 15 minutes |

### Content Security

- `express.json({ limit: '1mb' })` prevents request body flooding
- File upload max size: 50MB via multer
- Zod validation on all request bodies with strict schemas

[Back to Home](.)
