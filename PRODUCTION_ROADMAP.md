<!-- markdownlint-disable MD013 -->

# ContractCanvas — Production & Commercialization Roadmap

> **How to use this file:** Work through phases in order. Each phase's output is a hard dependency
> for the next. Check off items as they are completed. Do not skip phases — the ordering is deliberate.
>
> Estimated total: **14–16 weeks** for a team of 2–3 engineers.

---

## Audit Baseline

The codebase has solid foundations: JWT auth, multi-tenant org isolation, S3 storage, Stripe stubs,
Docker Compose, and full CI/CD pipelines. The gap between "runs in Docker" and "takes paying customers"
is what this roadmap closes. Every item below is sine qua non — missing any one will either expose
customers to unacceptable risk, prevent core product delivery, or block the ability to charge money legally.

---

## PHASE 1 — Security Hardening

> **Blocks all production traffic.** Ship nothing publicly until this phase is complete.
> Estimated: ~2 weeks

### 1.1 — Refresh Token Rotation + httpOnly Cookie Storage

- [x] Shorten access token TTL from `1d` to `15m` in `apps/api/src/config.ts`
- [x] Add `refreshToken String @unique`, `revokedAt DateTime?` columns to `Session` model in `apps/api/prisma/schema.prisma`
- [x] Run `npx prisma migrate dev --name add-session-refresh-token`
- [x] Generate opaque refresh token (`crypto.randomBytes(32).toString('hex')`) in `/api/auth/login` and `/api/auth/register`
- [x] Store SHA-256 hash of refresh token in `Session` table (never store raw token)
- [x] Set refresh token in `Set-Cookie` header: `httpOnly: true`, `secure: true` (prod), `sameSite: 'strict'`, `path: '/api/auth'`, `maxAge: 30 days`
- [x] Rewrite `POST /api/auth/refresh-token` to read cookie, hash it, verify Session row, rotate token atomically in a DB transaction
- [x] Add `POST /api/auth/logout` endpoint that deletes Session row and clears cookie
- [x] Update Angular `AuthService`: store JWT in memory (Signal), not `localStorage`
- [x] Add RxJS timer in `AuthService` to call refresh endpoint 60s before JWT expiry
- [x] Remove all `localStorage.setItem('contractcanvas_auth_token', ...)` calls from frontend

### 1.2 — Session Revocation on Security Events

- [x] Create `apps/api/src/lib/session.ts` with `revokeAllUserSessions(userId)` helper
- [x] Call `revokeAllUserSessions` from password change endpoint
- [x] Call `revokeAllUserSessions` from `DELETE /api/organizations/:orgId/members/:memberId`
- [x] Add `POST /api/auth/change-password` endpoint (requires current password, validates new password strength)

### 1.3 — Input Sanitization (XSS Prevention)

- [x] `cd apps/api && npm install dompurify jsdom && npm install -D @types/dompurify`
- [x] Create `apps/api/src/lib/sanitize.ts` with `sanitizeMarkdown(input: string): string` using DOMPurify/JSDOM
- [x] Apply `sanitizeMarkdown()` to all `bodyMd` fields before Prisma writes: `POST /api/clauses`, `PATCH /api/clauses/:id`, `POST /api/comments`, `PATCH /api/comments/:id`
- [x] Verify Angular `ngx-markdown` or equivalent renderer has HTML sanitization enabled

### 1.4 — Content Security Policy Hardening

- [x] Update `server.ts` Helmet config with explicit `contentSecurityPolicy` directives (restrict `scriptSrc`, `connectSrc` to Stripe, `frameSrc: none`, `objectSrc: none`)
- [x] Add HSTS to Helmet: `maxAge: 31536000, includeSubDomains: true, preload: true`
- [x] Add CSP, HSTS, and `Permissions-Policy` headers to `apps/web/nginx.conf`
- [x] Test CSP in browser DevTools — fix any blocked resources before shipping

### 1.5 — Production Secret Validation at Startup

- [x] Add guard in `apps/api/src/config.ts`: throw on startup if `NODE_ENV === 'production'` and `JWT_SECRET < 64 chars`, `STRIPE_SECRET_KEY` is missing/placeholder, or S3 credentials are defaults
- [x] Write key rotation runbook: document that rotating `JWT_SECRET` requires calling `revokeAllUserSessions` for all users (mass logout) and coordinating a maintenance window
- [ ] Move all secrets in CI to use environment-namespaced secrets (no shared secrets across dev/qa/prod)

---

## PHASE 2 — Email & Auth Completion

> **Blocks user activation.** No paying user flow is possible without email delivery.
> Estimated: ~1 week

### 2.1 — Transactional Email Service

- [x] Choose provider: **Postmark** (recommended for deliverability) or **AWS SES** (cheapest at scale)
- [x] `cd apps/api && npm install @postmark/postmark` (or `@aws-sdk/client-ses`)
- [x] Add env vars: `EMAIL_FROM`, `EMAIL_PROVIDER`, `POSTMARK_API_KEY` (or `AWS_SES_REGION`)
- [x] Create `apps/api/src/services/email.service.ts` with `sendEmail({ to, subject, htmlBody, textBody })` — no-op in `test` environment
- [x] Build MJML or Handlebars templates for: Welcome/Verify, Password Reset, Document Shared, Contract Status Changed, Task Assigned, Org Invitation
- [ ] Add email sending to all transactional events using the job queue (Phase 7.1) once available; inline for now

### 2.2 — Email Verification

- [x] Add `emailVerifiedAt DateTime?`, `verifyToken String? @unique`, `verifyTokenExp DateTime?` to `User` model
- [x] Run `npx prisma migrate dev --name add-email-verification`
- [x] On `POST /api/auth/register`: generate raw token, store SHA-256 hash + 24h expiry, send verification email
- [x] Add `GET /api/auth/verify-email?token=xxx` endpoint: hash token, find user, set `emailVerifiedAt`, issue new JWT
- [x] Add `POST /api/auth/resend-verification` with strict rate limit: 3 attempts per hour per email
- [x] Add `emailVerified: boolean` claim to JWT payload
- [x] Gate document upload and billing endpoints behind `emailVerified: true` check
- [ ] Frontend: add email verification banner on dashboard when `emailVerified === false`
- [ ] Add public `/verify-email` route in Angular router

### 2.3 — Password Reset Flow

- [x] Add `resetToken String? @unique`, `resetTokenExp DateTime?` to `User` model
- [x] Run `npx prisma migrate dev --name add-password-reset`
- [x] Add `POST /api/auth/forgot-password` (rate-limited 5/hour per email): find user, generate token, store hash + 1h expiry, send email — always return 200 regardless of whether email exists
- [x] Add `POST /api/auth/reset-password`: validate token hash + expiry, validate new password strength (min 12 chars, mixed case + digit), bcrypt hash, save, clear token fields, call `revokeAllUserSessions`
- [ ] Frontend: add "Forgot password?" link on `/login` page
- [ ] Frontend: add public `/reset-password?token=xxx` route with new password form

---

## PHASE 3 — E-Signature & Document Pipeline

> **Core product value.** Without e-signatures, ContractCanvas is a document storage app, not a contract lifecycle tool.
> Estimated: ~2 weeks

### 3.1 — DocuSign Integration

- [ ] Create DocuSign developer account at developers.docusign.com — obtain Integration Key + RSA keypair
- [ ] `cd apps/api && npm install docusign-esign`
- [ ] Add env vars: `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_PATH`, `DOCUSIGN_RSA_PRIVATE_KEY`, `DOCUSIGN_WEBHOOK_HMAC`
- [ ] Create `apps/api/src/services/docusign.service.ts`: implement JWT Grant authentication with token caching (refresh 60s before expiry)
- [ ] Implement `createEnvelope(contractVersionId, recipients[])`: fetch PDF from S3 → build DocuSign `EnvelopeDefinition` → call `envelopesApi.createEnvelope` → store `envelopeId` on `SignatureEnvelope` record
- [ ] Implement `getSigningUrl(envelopeId, recipientEmail)`: call `envelopesApi.createRecipientView` → return embedded signing URL
- [ ] Add `GET /api/signatures/:id/signing-url` route that returns `{ url }` for frontend modal/redirect
- [ ] Implement DocuSign Connect webhook at `POST /api/signatures/webhook`: verify HMAC → parse `envelope.status` → update `SignatureEnvelope.status` in DB
- [ ] On `status === 'completed'`: download signed PDF from DocuSign → upload to S3 as `SIGNED_PDF` Document → update `Contract.status` to `EXECUTED`
- [ ] Add `POST /api/contracts/:id/send-for-signature` endpoint: validate contract has at least one version, create envelope, create `SignatureEnvelope` record, set `Contract.status` to `PENDING_SIGNATURE`
- [ ] Frontend: add "Send for Signature" button on ContractDetailComponent (visible when status is NEGOTIATION)
- [ ] Frontend: add signing status badge and recipient list to ContractDetailComponent
- [ ] Switch `DOCUSIGN_BASE_PATH` from `demo.docusign.net` to `na3.docusign.net` (or regional equivalent) for production

### 3.2 — PDF Generation for Contracts

- [ ] `cd apps/api && npm install puppeteer marked`
- [ ] Add Chromium dependencies to `apps/api/Dockerfile`: `apk add chromium nss freetype harfbuzz ca-certificates ttf-freefont` + set `PUPPETEER_EXECUTABLE_PATH`
- [ ] Create `apps/api/src/services/pdf.service.ts` with `generateContractPdf(contract)` using Puppeteer: render Markdown → HTML template → PDF Buffer
- [ ] Create HTML contract template with: header (parties, date, matter reference), body (rendered Markdown), footer (page numbers, version, generated timestamp)
- [ ] Add `POST /api/contracts/:id/generate-pdf` endpoint: call `generateContractPdf`, upload Buffer to S3 as `GENERATED` Document, return document record
- [ ] Frontend: add "Generate PDF" button on ContractDetailComponent that calls this endpoint and opens the download URL

---

## PHASE 4 — Billing & Subscriptions

> **Required to legally charge recurring money.** Do not accept payment before this phase is complete.
> Estimated: ~2 weeks

### 4.1 — Subscription Plan Model

- [ ] Define pricing tiers and features in a `PRICING.md` document (Starter / Professional / Enterprise with matter limits, user limits, storage limits, e-sig limits)
- [ ] Add `Subscription` model to Prisma schema with: `organizationId`, `tier (PlanTier enum)`, `stripeSubscriptionId`, `stripeCustomerId`, `status`, `trialEndsAt`, `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`
- [ ] Add `PlanTier` enum: `STARTER`, `PROFESSIONAL`, `ENTERPRISE`
- [ ] Run `npx prisma migrate dev --name add-subscriptions`
- [ ] Create products and prices in Stripe dashboard — store Price IDs in env: `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PROFESSIONAL`
- [x] On `POST /api/auth/register`: auto-create `Subscription` record with `tier=STARTER`, `status=trialing`, `trialEndsAt = now + 14 days`
- [x] Add `POST /api/billing/subscribe` endpoint: create Stripe Customer if none exists → create Stripe Subscription → store in `Subscription` table → return `clientSecret` for Stripe.js
- [ ] Frontend: create Subscription/Upgrade page at `/settings/billing` with plan comparison and Stripe.js payment element

### 4.2 — Stripe Webhook Completion

- [x] Implement `customer.subscription.created` handler: upsert `Subscription` record
- [x] Implement `customer.subscription.updated` handler: update `status`, `currentPeriodEnd`, `cancelAtPeriodEnd`
- [x] Implement `customer.subscription.deleted` handler: set `status = 'canceled'`
- [x] Implement `invoice.payment_failed` handler: send email to org owner with payment link; begin 7-day grace period before restricting access
- [x] Implement `invoice.payment_succeeded` handler: update `Subscription.status` to `active`, clear any access restrictions
- [x] Create `requireActiveSubscription` middleware: check `Subscription.status` is `active` or `trialing` → return 402 with `{ error: 'LIMIT_EXCEEDED', upgradeUrl: '/settings/billing' }` if not
- [x] Apply `requireActiveSubscription` to: `POST /api/documents/upload`, `POST /api/signatures/*`, `POST /api/contracts/:id/generate-pdf`

### 4.3 — Usage Limits Enforcement

- [x] Create `apps/api/src/services/usage.service.ts` with `PLAN_LIMITS` constant and check functions: `checkMatterLimit`, `checkMemberLimit`, `checkStorageLimit`
- [x] Call `checkMatterLimit` in `POST /api/matters` before DB write
- [x] Call `checkMemberLimit` in `POST /api/organizations/:orgId/members` before DB write
- [x] Track storage bytes: on each document upload, sum `Document.sizeBytes` for the org and compare to limit
- [x] Return HTTP 402 with structured `{ error, limit, current, upgradeUrl }` payload on limit exceeded
- [ ] Frontend: handle 402 in `ErrorInterceptor` — show "Upgrade Required" Material dialog with plan comparison

### 4.4 — Stripe Customer Portal

- [x] Add `POST /api/billing/portal-session` endpoint: look up `stripeCustomerId` from `Subscription` → call `stripe.billingPortal.sessions.create` with `return_url` → return `{ url }`
- [ ] Frontend: add "Manage Subscription" button in `/settings/billing` that calls this endpoint and does `window.location.href = url`
- [ ] Configure portal in Stripe dashboard: enable plan switching, cancellation, payment method update, invoice history

---

## PHASE 5 — Operational Reliability

> **Required for any SLA commitment.** Real-paying customers make downtime a legal and financial liability.
> Estimated: ~2 weeks

### 5.1 — Structured Logging

- [x] `cd apps/api && npm install pino pino-http && npm install -D pino-pretty`
- [x] Create `apps/api/src/lib/logger.ts` — export Pino logger (pino-pretty in dev, JSON in prod)
- [x] Replace all `console.log/warn/error` calls with `logger.info/warn/error`
- [x] Replace Morgan with `pino-http` middleware — log method, url, statusCode, durationMs per request
- [ ] Add `AsyncLocalStorage` context to thread `requestId`, `organizationId`, `userId` into every log line automatically
- [ ] Choose log destination: Datadog (`pino-datadog`), CloudWatch (`pino-cloudwatch`), or Loki (`pino-loki`) — add transport to Pino config
- [x] Add `LOG_LEVEL` env var (default `info`; set `debug` in dev, `warn` in prod for high-traffic routes)
- [x] Set `LOG_LEVEL=silent` in Vitest config to suppress noise during tests

### 5.2 — Error Tracking with Sentry

- [x] `cd apps/api && npm install @sentry/node @sentry/profiling-node`
- [x] `cd apps/web && npm install @sentry/angular`
- [x] Initialize Sentry as the FIRST statement in `apps/api/src/server.ts` before any other imports
- [x] Add `Sentry.Handlers.requestHandler()` before routes and `Sentry.Handlers.errorHandler()` before the global error handler
- [ ] Tag every Sentry event with `organizationId` and `userId` from request context
- [x] Initialize `@sentry/angular` in `main.ts` — wrap with `SentryErrorHandler`
- [ ] Add `SENTRY_DSN` to env vars and GitHub Secrets for each environment
- [ ] Configure Sentry alert rules: page on-call when `unhandled_rejection` or `error_count > 10 in 5 min`
- [x] Set `tracesSampleRate: 0.1` in production (10% sampling to control cost)

### 5.3 — Database Connection Pooling

- [x] Add PgBouncer service to `infra/docker-compose.yml` (`edoburu/pgbouncer:1.21.0`): `POOL_MODE=transaction`, `MAX_CLIENT_CONN=200`, `DEFAULT_POOL_SIZE=20`
- [x] Update `DATABASE_URL` in all environments to point to PgBouncer port instead of Postgres directly
- [x] Verify Prisma works with PgBouncer transaction mode (disable `DEALLOCATE` — add `pgbouncer=true` to connection string params)
- [ ] Load test with 50 concurrent users to verify no connection exhaustion

### 5.4 — Database Backups & Point-in-Time Recovery

- [ ] Enable WAL archiving on PostgreSQL: set `wal_level=replica`, `archive_mode=on`, `archive_command` to ship WAL files to S3 backup bucket
- [x] Create daily `pg_dump` script → gzip → upload to `s3://contractcanvas-backups/daily/YYYYMMDD.sql.gz` (`infra/scripts/backup.sh`)
- [ ] Set S3 lifecycle policy: retain daily backups 30 days, weekly backups 1 year
- [x] Add scheduled GitHub Actions workflow (weekly) that restores a backup to an isolated container and runs `prisma migrate status` to verify integrity
- [x] Document RTO (target: 4h) and RPO (target: 1h) in `RUNBOOK.md`
- [ ] Evaluate migration to managed Postgres (AWS RDS or Supabase) for production — they include PITR out of the box

### 5.5 — Graceful Shutdown & Deep Health Check

- [x] Rewrite `GET /health` to verify all dependencies: execute `db.$queryRaw` with `SELECT 1`, `HeadBucketCommand` to S3 — return 503 if any dependency fails
- [x] Add graceful shutdown handlers to `apps/api/src/server.ts`: `SIGTERM` and `SIGINT` → `server.close()` → `db.$disconnect()` → `process.exit(0)` with 30s force-exit timeout
- [x] Add `HEALTHCHECK` instruction to `apps/api/Dockerfile`: `CMD curl -f http://localhost:3333/health || exit 1`
- [x] Add `stop_grace_period: 35s` to API service in `docker-compose.yml` to allow requests to drain

---

## PHASE 6 — Compliance & Legal

> **Required for law firm and enterprise customers.** A single enterprise prospect asking "do you have SOC 2?" ends the deal without this phase.
> Estimated: ~1 week

### 6.1 — Complete Audit Log Implementation

- [x] Create `apps/api/src/lib/audit.ts` with `writeAuditLog({ organizationId, actorId, entity, entityId, action, before?, after?, ipAddress?, userAgent? })` helper
- [x] Add audit log writes to every mutating route: matters (CREATE/UPDATE/DELETE), contracts (all status changes), documents (UPLOAD/DOWNLOAD/DELETE), members (ADD/REMOVE/ROLE_CHANGE), clause (CREATE/UPDATE/DELETE)
- [x] Critically: log document DOWNLOAD events with IP address (legal evidence chain of custody)
- [x] Add Prisma middleware to make `AuditLog` rows immutable (block UPDATE and DELETE operations — enforced at route level; no UPDATE/DELETE endpoints exposed)
- [x] Add `GET /api/organizations/:orgId/audit-logs` endpoint (OWNER/ADMIN only): paginated, filterable by `entity`, `actorId`, `action`, date range
- [x] Add CSV export to audit log endpoint (`Accept: text/csv` header triggers CSV response)
- [ ] Frontend: add Audit Log tab in Admin page (table with filters)

### 6.2 — GDPR / CCPA Compliance

- [x] Add `tosAcceptedAt DateTime?`, `privacyAcceptedAt DateTime?`, `tosVersion String?` to `User` model
- [x] Run `npx prisma migrate dev --name add-consent-fields`
- [ ] On registration: require explicit ToS checkbox — persist `tosAcceptedAt` and `tosVersion`
- [x] Add `POST /api/users/me/data-export` endpoint: aggregate all user-associated data → return as JSON download → write AuditLog entry
- [x] Add `DELETE /api/users/me` endpoint: soft-delete user, remove org memberships, anonymize name/email to `deleted_user_{id}@redacted.invalid`, revoke all sessions — do NOT delete org documents
- [ ] Draft Privacy Policy document (list data categories, sub-processors: Stripe, DocuSign, AWS, Postmark)
- [ ] Draft Terms of Service document
- [ ] Draft Data Processing Agreement (DPA) template for enterprise customers
- [ ] Add privacy policy and ToS links to registration page footer

### 6.3 — Data Retention Policies

- [x] Add `retentionDays Int @default(2555)` (7 years) to `Organization` model — configurable per org
- [x] Run `npx prisma migrate dev --name add-retention-policy`
- [x] Create retention job (BullMQ cleanupQueue worker, type 'retention'): finds documents in CLOSED matters older than `retentionDays` → soft-deletes
- [ ] Add retention policy display and configuration to Organization Settings page
- [ ] Ensure `AuditLog` rows are exempt from retention deletion (compliance records must survive)

---

## PHASE 7 — Real-Time & Async Infrastructure

> **Required for UX parity with competitors and reliable delivery of email/webhooks.**
> Estimated: ~2 weeks

### 7.1 — Background Job Queue (Redis + BullMQ)

- [x] Add Redis service to `infra/docker-compose.yml`: `redis:7-alpine` with append-only persistence
- [x] `cd apps/api && npm install bullmq ioredis`
- [x] Add `REDIS_URL` env var
- [x] Create `apps/api/src/queues/index.ts`: initialize `emailQueue`, `webhookQueue`, `pdfQueue`, `cleanupQueue` with BullMQ
- [x] Create workers for each queue with appropriate concurrency settings
- [x] Move all `sendEmail()` calls from route handlers into `emailQueue.add(...)` jobs
- [~] Move PDF generation into `pdfQueue.add(...)` — worker implemented; endpoint still returns synchronously (acceptable for now)
- [x] Install and mount Bull Board at `GET /admin/queues` behind admin auth (`ADMIN_QUEUE_TOKEN` header)
- [x] Add dead-letter queue handling: failed jobs after 5 attempts trigger an alert email to admin

### 7.2 — Real-Time Notifications (Server-Sent Events)

- [x] Create `apps/api/src/routes/events.ts` with `GET /api/events/stream` SSE endpoint — requires `protect` middleware
- [x] Implement in-process client registry: `Map<userId, Response[]>` for SSE connections
- [x] Export `pushToUser(userId, eventName, data)` function
- [x] Call `pushToUser` whenever a `Notification` record is created for a user
- [ ] Add nginx SSE proxy config to `apps/web/nginx.conf`: disable buffering (`proxy_buffering off`), set `proxy_read_timeout 3600s`
- [x] Frontend: add `EventSource('/api/events/stream')` in `NotificationService.startStream()` — call from `AppComponent.ngOnInit()`
- [x] Frontend: on `notification` SSE event, increment unread badge and show `MatSnackBar` toast
- [ ] For multi-instance deployments: add Redis Pub/Sub bridge — each API instance subscribes to `notifications:*` channel and writes to its local SSE clients

### 7.3 — Outbound Webhook Delivery

- [x] Add `POST /api/organizations/:orgId/webhooks` (OWNER/ADMIN only): create `WebhookEndpoint` record with URL, secret, event filter array
- [x] Add `GET`, `PATCH`, `DELETE` routes for managing webhook endpoints
- [x] Create `apps/api/src/services/webhook.service.ts` with `deliverWebhook(orgId, event, payload)`: query active endpoints, compute HMAC-SHA256 signature, enqueue delivery jobs
- [x] Implement BullMQ webhook worker with exponential backoff retry (5 attempts max, exponential backoff)
- [x] Write `WebhookDelivery` record for every attempt (success or failure) with HTTP status code
- [x] Call `deliverWebhook` from: contract status changes, document uploads, task completed (via webhookQueue)
- [ ] Frontend: add Webhooks tab in Organization Settings — list endpoints, show last delivery status, enable/disable toggle

---

## PHASE 8 — Commercialization Features

> **Growth and retention features. Only deliver ROI once paying customers exist to retain.**
> Estimated: ~2 weeks

### 8.1 — Onboarding Flow

- [x] Add `onboardingStep` enum (`OnboardingStep`) to `User` model: `VERIFY_EMAIL`, `CUSTOMIZE_ORG`, `CREATE_MATTER`, `INVITE_MEMBER`, `UPLOAD_DOCUMENT`, `DONE`
- [x] Run migration `20260321_add_onboarding_step`
- [ ] Create 5-step onboarding wizard component shown after first login (before dashboard)
- [ ] Step 1: Email verification (block advance until verified)
- [ ] Step 2: Org name + logo upload
- [ ] Step 3: Create first matter (prefilled template)
- [ ] Step 4: Invite a colleague (optional — show incentive: "Invite to unlock X")
- [ ] Step 5: Upload a document or create a contract
- [ ] Track step completion in DB — show progress in dashboard sidebar
- [ ] Send automated reminder email after 48h if user is stuck at any step before DONE
- [x] Add `PATCH /api/users/me/onboarding` endpoint to advance onboarding step

### 8.2 — Full-Text Search Across All Entities

- [ ] Add `tsvector` generated column to `Matter`, `Contract`, `Document`, `Clause` tables via Prisma migration using raw SQL
- [ ] Create GIN indexes on each `tsvector` column
- [x] Add `GET /api/search?q=<query>&types=matter,contract,document,clause` endpoint: query each table with `@@` operator, rank results by `ts_rank`, merge and return unified results
- [x] Add result limit per entity type (e.g., top 5 per type) with `total` count for "see all" links
- [x] Frontend: add global search bar in dashboard toolbar with debounce (300ms)
- [x] Frontend: display grouped search results in a dropdown — click navigates to the entity's detail page

### 8.3 — API Keys for Enterprise Integrations

- [x] Add `GET /api/organizations/:orgId/api-keys` endpoint (OWNER/ADMIN): list keys by name, prefix, `lastUsedAt`, `createdAt` — never return raw key
- [x] Add `POST /api/organizations/:orgId/api-keys`: generate `cc_live_<48-byte-hex>`, store SHA-256 hash + prefix, return raw key ONCE in response with a "copy now" warning
- [x] Add `DELETE /api/organizations/:orgId/api-keys/:keyId`: set `revokedAt`
- [x] Add API key authentication path in `protect()` middleware: extract `x-api-key` header, hash it, look up `ApiKey` table, set `req.user` context
- [x] Apply separate, higher rate limits to API key requests (1000 req/15min via `apiKeyLimiter`; session users capped at 300)
- [x] Update `lastUsedAt` on every successful API key request
- [ ] Frontend: add API Keys tab in Organization Settings with key list, generate button, revoke buttons

### 8.4 — Analytics Dashboard

- [x] Add `GET /api/analytics/overview` endpoint (OWNER/ADMIN): return matter counts by status, sum of `valueCents` by contract status, overdue task count, storage used bytes, active member count
- [x] Add `GET /api/analytics/contract-trends?period=30d|90d|1y` endpoint: contracts created per week + value over time
- [x] Analytics page at `/analytics` with live stat cards (matters, contracts, overdue tasks, storage, members)
- [x] `cd apps/web && npm install ng2-charts chart.js` — line chart for contract trends, doughnut for matter status breakdown
- [ ] Add loading skeleton state and error state to all dashboard stat cards

### 8.5 — Multi-Currency Validation & i18n Foundation

- [x] Add Zod validation `z.string().regex(/^[A-Z]{3}$/)` to all currency input fields on API routes (contracts, billing)
- [x] Add currency display formatting to frontend using Angular `CurrencyPipe` in `ContractDetailComponent`
- [ ] `cd apps/web && ng add @angular/localize`
- [ ] Run `ng extract-i18n` to generate `messages.xlf` baseline
- [ ] Identify top 3 target locales from sales pipeline (e.g., `es`, `fr`, `de`) — create translation files
- [ ] Add locale selector to user profile settings

---

## Summary Checklist

```text
Phase 1 — Security Hardening        [x] 1.1  [x] 1.2  [x] 1.3  [x] 1.4  [x] 1.5
Phase 2 — Email & Auth Completion   [x] 2.1  [x] 2.2  [x] 2.3  (frontend flows done)
Phase 3 — E-Signature & PDF         [ ] 3.1  [~] 3.2  (PDF service done; DocuSign pending)
Phase 4 — Billing & Subscriptions   [x] 4.1  [x] 4.2  [x] 4.3  [~] 4.4  (portal done; frontend pending)
Phase 5 — Operational Reliability   [x] 5.1  [x] 5.2  [x] 5.3  [~] 5.4  [x] 5.5  (backup script + RUNBOOK done)
Phase 6 — Compliance & Legal        [x] 6.1  [x] 6.2  [~] 6.3  (retention job done; DPA docs pending)
Phase 7 — Real-Time & Async         [x] 7.1  [x] 7.2  [x] 7.3  (BullMQ + SSE + webhooks done)
Phase 8 — Commercialization         [~] 8.1  [x] 8.2  [x] 8.3  [x] 8.4  [~] 8.5  (onboarding endpoint done; wizard pending)
```

---

Last updated: 2026-03-21
