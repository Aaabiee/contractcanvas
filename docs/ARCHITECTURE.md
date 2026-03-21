# ContractCanvas — Architecture

## System Overview

```text
                          ┌─────────────┐
  Browser / Mobile        │  Angular 19  │
  (Angular 19)            │  :4200 (dev) │
                          │  :80  (prod) │
                          └──────┬───────┘
                                 │ HTTPS / REST + SSE
                                 │ Authorization: Bearer <JWT> | x-api-key
                                 ▼
                          ┌─────────────────┐
                          │   PgBouncer     │  (transaction pool, port 5432)
                          └──────┬──────────┘
                                 │
                          ┌──────▼──────────┐      ┌──────────────────┐
                          │   Express API    │─────▶│   PostgreSQL 16  │
                          │   :3333          │      │   (Prisma 5)     │
                          └──────┬──────────┘      └──────────────────┘
                                 │
               ┌─────────────────┼──────────────────┐
               │                 │                  │
               ▼                 ▼                  ▼
        ┌────────────┐   ┌───────────────┐   ┌───────────────┐
        │   Redis    │   │  MinIO / S3   │   │    Stripe     │
        │  :6379     │   │  :9000        │   │  (webhooks    │
        │ (blacklist │   │  (documents,  │   │   inbound at  │
        │  + BullMQ  │   │   signed PDFs)│   │ /api/billing) │
        │  queues)   │   └───────────────┘   └───────────────┘
        └────────────┘

  BullMQ queues: emailQueue · webhookQueue · pdfQueue · cleanupQueue
  Bull Board:    GET /admin/queues  (requires X-Admin-Token header)
  Outbound webhooks: API ──HMAC-SHA256──▶ customer HTTPS endpoints (via webhookQueue)
  Reminder scheduler: node-cron (in-process, fires inside the API)
  Error tracking: Sentry (initialized before any middleware in server.ts)
  Analytics:     GET /api/analytics/overview + /contract-trends
  Onboarding:    PATCH /api/users/me/onboarding (OnboardingStep enum)
```

---

## Authentication Flow

### Session-based (browser clients)

1. **Register** — `POST /api/auth/register`: password is bcrypt-hashed, a `User` and `Organization` are created in a transaction. For new orgs (`orgMode=create`), a `Subscription` record is auto-created (`tier=STARTER`, `status=trialing`, `trialEndsAt=+14 days`). An opaque 32-byte refresh token is generated; its SHA-256 hash is stored on the `Session` row. The raw token is set in a `Set-Cookie` header: `HttpOnly`, `Secure` (production), `SameSite=Strict`, `Path=/api/auth`, `Max-Age=30 days`. A verification email is enqueued via BullMQ `emailQueue`.

2. **Email verification** — `GET /api/auth/verify-email?token=<raw>`: the token is hashed, matched against `User.verifyToken`, and the `emailVerifiedAt` timestamp is set. A new JWT is issued with `emailVerified: true`.

3. **Login** — `POST /api/auth/login`: credentials validated, new `Session` row created, access token (JWT, 15-minute TTL) returned in the response body, new refresh token set in the cookie.

4. **JWT contents** — the access token carries: `sub` (userId), `email`, `name`, `roles`, `organizations` (array of `{ id, name, slug, role }`), `emailVerified`, `jti`, `iat`, `exp`.

5. **Automatic refresh** — the Angular `AuthService` stores the JWT in memory (never `localStorage`). An RxJS timer fires 60 seconds before the JWT expires and calls `POST /api/auth/refresh-token`, which reads the cookie, hashes the token, looks up and rotates the `Session` row in a single transaction, and returns a new access token and a new cookie.

6. **Logout** — `POST /api/auth/logout`: the `Session` row is deleted, the cookie is cleared, and the JWT's `jti` is written to the Redis blacklist with a TTL matching the token's remaining validity. Subsequent requests bearing the revoked token are rejected in the `protect` middleware before the JWT signature is even checked against org context.

7. **Security events** — password change and member removal both call `revokeAllUserSessions(userId)`, which deletes all `Session` rows for that user.

### API key authentication (enterprise / programmatic)

Clients may send `x-api-key: cc_live_<hex>` instead of a `Bearer` token. The `protect` middleware hashes the raw key with SHA-256, looks it up in the `ApiKey` table (filtering `revokedAt IS NULL`), derives org context from the key's `organizationId`, and sets `req.user` accordingly. The raw key is returned only once at creation time; subsequent reads return only the prefix and metadata.

---

## Multi-Tenancy Model

Every resource table in the schema (`Matter`, `Contract`, `Document`, `Clause`, `Task`, `Comment`, `Reminder`, `Notification`, `AuditLog`, `ApiKey`, `WebhookEndpoint`, `OutboundWebhook`, `Subscription`, etc.) carries an `organizationId` column with a foreign key to `Organization`. Every Prisma query in a route handler must include `where: { organizationId: req.user.organizationId, ... }`.

The `protect` middleware resolves `req.user.organizationId` as follows:

1. The JWT `organizations` claim is an array of `{ id, name, slug, role }` objects representing all orgs the user belongs to.
2. If the request includes an `X-Organization-Id` header, the middleware finds the matching entry in the array and sets `organizationId` to that value. If the header value does not match any org in the claim, the request is rejected with 401.
3. If no header is present, the first entry in the array is used (single-org users are unaffected).

This design means a user who is a member of multiple organizations can switch context by changing the `X-Organization-Id` header, without needing a separate token or re-login.

The `Organization` model has a `deletedAt` soft-delete column. Queries that must not return deleted organizations add `deletedAt: null` to the filter.

---

## Data Model

The schema is defined in `apps/api/prisma/schema.prisma`. The key relationships are:

```text
Organization
├── OrganizationMember (join table → User)
├── Matter
│   ├── MatterParticipant (join table → User)
│   ├── Contract
│   │   ├── ContractVersion (versioned content; one marked as currentVersion)
│   │   │   └── ContractVersionTag (join table → Tag)
│   │   ├── SignatureEnvelope (e-sign provider envelope state)
│   │   ├── Reminder
│   │   └── Invoice
│   ├── Document (uploaded/generated/signed PDFs; stored in S3)
│   ├── Task
│   └── Comment
├── Clause (reusable clause library entries; bodyMd is XSS-sanitized on write)
├── Tag
├── ApiKey
├── OutboundWebhook / OutboundWebhookDelivery
├── WebhookEndpoint / WebhookDelivery  (inbound Stripe/DocuSign webhooks)
├── Subscription (Stripe subscription state; plan tier enforcement)
├── BillingProfile (Stripe customer ID)
├── ShareLink (tokenized public access to specific resources)
├── Notification
└── AuditLog

User
├── Session (refresh token store; one row per active session)
├── Notification
├── Comment
├── Mention
└── Task (as assignee)
```

All IDs are CUIDs. Soft deletes use `deletedAt DateTime?`; hard deletes cascade via Prisma `onDelete: Cascade` for child records of the deleted parent. `authorId` and similar user-FK columns use `onDelete: SetNull` to preserve the record when the referenced user is deleted (GDPR account deletion path).

---

## Real-Time Notifications

ContractCanvas uses Server-Sent Events (SSE) for push notifications to browser clients.

**Server side (`apps/api/src/lib/sse-registry.ts`):**

An in-process `Map<userId, Set<Response>>` holds all active SSE connections. When a client opens `GET /api/events/stream` (protected by `protect` middleware), the response is kept open with `Content-Type: text/event-stream` and a reference is stored in the registry. The exported `pushToUser(userId, event, data)` function iterates the set, serializes the payload, and writes to each response. Stale connections are removed on write error.

**`createNotification()` (`apps/api/src/lib/notify.ts`):**

Every notification write first creates a `Notification` row in the database for persistence and unread-count queries, then immediately calls `pushToUser` to deliver a live `notification` event to any open SSE connections for the recipient. There is no polling loop.

**Client side (Angular `NotificationService`):**

On `AppComponent.ngOnInit()`, `NotificationService.startStream()` opens an `EventSource` to `/api/events/stream`. On a `notification` event, the service increments the unread badge and displays a `MatSnackBar` toast. The `EventSource` API handles reconnection natively; the service adds exponential backoff via the `reconnect` configuration.

**Multi-instance limitation:** the current implementation is in-process only. In a horizontally scaled deployment, a user's SSE connection may land on a different API instance than the one writing the notification. The PRODUCTION_ROADMAP (Phase 7.2) specifies a Redis Pub/Sub bridge to fan out events across all instances.

---

## Background Processing

**Reminder scheduler (`apps/api/src/lib/reminder-scheduler.ts`):**

A `node-cron` job runs inside the API process on a configurable schedule. It queries `Reminder` rows whose `dueAt` is within the next window and `sentAt IS NULL`, sends notifications to the relevant users, and sets `sentAt` to prevent duplicate delivery. The scheduler is skipped when `NODE_ENV === 'test'`.

**Planned: BullMQ job queues (Phase 7.1 of PRODUCTION_ROADMAP.md):**

Transactional email, PDF generation, outbound webhook delivery, and cleanup jobs will move to BullMQ queues backed by Redis. Route handlers will enqueue jobs and return `202 Accepted` with a job ID; workers handle delivery with exponential backoff retry and dead-letter handling after five failed attempts. Bull Board will be mounted at `/admin/queues` behind admin authentication.

---

## File Storage

Documents are stored in AWS S3 (production) or MinIO (local/staging). The `Document` model records:

- `storageKey` — the S3 object key (never exposed directly to clients)
- `sizeBytes` — tracked at upload time for per-org storage limit enforcement
- `sha256` — optional checksum for integrity verification
- `kind` — `UPLOADED`, `GENERATED` (Puppeteer PDF), `SIGNED_PDF` (returned from DocuSign), or `ATTACHMENT`

Clients never receive direct S3 URLs from the database. Download routes generate pre-signed S3 URLs with a short expiry (typically 60 seconds) and return those to the client. This prevents unauthorized access even if an object key leaks.

Upload routes gate on `emailVerified: true` and, once the billing phase is complete, on `requireActiveSubscription`. Storage usage is checked against the organization's plan limit before each upload; the API returns HTTP 402 with a structured `{ error, limit, current, upgradeUrl }` payload if the limit is exceeded.

---

## Outbound Webhooks

When a significant event occurs (contract status change, document upload, signature completed, task completed), the API calls `deliverWebhook(orgId, event, payload)` from `apps/api/src/services/webhook.service.ts`.

The service:

1. Queries active `OutboundWebhook` rows for the organization filtered by the event type.
2. For each endpoint, computes an HMAC-SHA256 signature of the serialized payload using the endpoint's secret. The signature is sent in the `X-Signature-256` header so the customer can verify authenticity.
3. Validates the target URL: private IP ranges and loopback addresses are blocked (SSRF protection); in production, only HTTPS URLs are accepted.
4. Dispatches the HTTP POST and writes an `OutboundWebhookDelivery` record with the HTTP status code, success flag, and attempt count regardless of outcome.

Retry logic with exponential backoff (planned via BullMQ in Phase 7.3) will handle transient failures. Until BullMQ is wired up, delivery is best-effort within the request lifecycle.

---

## Deployment

### Local and staging

All services are defined in `infra/docker-compose.yml`. The `db`, `minio`, `minio-init`, and `redis` services start by default. The `api` and `web` services are gated behind Docker Compose profiles (`full`, `prod`, `staging`, `qa`) to avoid starting them unintentionally during local development.

```bash
# Local development (infra only)
docker compose -f infra/docker-compose.yml up -d db minio redis

# Full stack (staging / QA)
docker compose -f infra/docker-compose.yml --profile staging up -d
```

All services declare `healthcheck` instructions so dependent services (e.g., `api` depends on `db`) only start after their dependencies pass health checks.

### API Dockerfile (`apps/api/Dockerfile`)

The build uses two stages:

- **`builder`** — installs all dependencies (including `devDependencies`), runs `tsc` to emit `dist/`.
- **`runner`** — copies only `dist/`, `node_modules` (production deps), and the Prisma client; runs as a non-root user (`node`). The image is minimal and contains no build toolchain.

A `HEALTHCHECK` instruction pings `GET /health` every 15 seconds. The compose service sets `stop_grace_period: 35s`, which gives the API process time to stop accepting new connections, finish in-flight requests, and disconnect from Prisma cleanly before the container is forcibly terminated.

### Production requirements

See [PRODUCTION_ROADMAP.md](../PRODUCTION_ROADMAP.md) for the full checklist. Key items not yet complete include PgBouncer connection pooling (Phase 5.3), PostgreSQL WAL-based backups with point-in-time recovery (Phase 5.4), DocuSign e-signature integration (Phase 3.1), BullMQ job queues (Phase 7.1), and the onboarding flow (Phase 8.1).
