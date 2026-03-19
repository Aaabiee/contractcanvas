# ContractCanvas

A modern, multi-tenant **contract and matter management platform** built for law firms and their clients. Manages the full lifecycle of legal work: matters, contract drafting and versioning, document storage, e-signatures, billing, and team collaboration — all scoped to isolated organizations.

Monorepo with a Node/Express API, Angular 20 web app, PostgreSQL (via Docker), S3-compatible storage (MinIO), Stripe billing, and Prisma ORM.

> The **API** mounts all routes under `/api/*`. The **web** dev server proxies `/api` → `http://localhost:3333`, so the frontend never needs to know the API port.

---

## Features

### Implemented & Working

- **JWT Authentication** — Register (create or join an org), login, and `/me` endpoint. Passwords hashed with bcrypt. Tokens signed HS256 (shared secret) with RS256/JWKS fallback for OpenID providers.
- **Organizations & Multi-tenancy** — Every resource is scoped to an organization. Users can belong to multiple orgs with distinct roles per org.
- **Role-Based Access Control** — Two independent role dimensions: system roles (`ADMIN`, `LAWYER`, `PARALEGAL`, `CLIENT`) and org roles (`OWNER`, `ADMIN`, `MEMBER`). Middleware enforces both.
- **Matters** — Create and manage legal matters/cases with `OPEN`, `ON_HOLD`, and `CLOSED` states. Supports many participants per matter.
- **Contracts** — Full CRUD with status workflow: `DRAFT → NEGOTIATION → PENDING_SIGNATURE → EXECUTED → ARCHIVED`. Tracks value in cents + currency.
- **Contract Versioning** — Immutable version history: each version stores an S3 key, MIME type, size, author, optional diff JSON, and AI context. Version numbers auto-increment atomically.
- **Document Management** — Upload files (up to 50 MB) to S3/MinIO. Metadata persisted in PostgreSQL. Presigned download URLs (5-minute expiry) generated on demand. Soft-delete supported.
- **Org Membership Management** — Owners and admins can add, update, and remove members. Users can remove themselves.
- **Soft Deletes** — Matters, contracts, documents, and other records use `deletedAt` timestamps rather than hard deletes, preserving audit history.

### Scaffolded (Models + Route Shells Exist, Integration Pending)

- **E-Signature Envelopes** — Provider-agnostic envelope model supports DocuSign and HelloSign. Status tracking from `CREATED` through `COMPLETED`/`DECLINED`/`VOIDED`. Real provider SDK calls are TODO.
- **Billing & Invoicing** — Stripe `PaymentIntent` creation works. Invoice, Payment, and BillingProfile models exist. Stripe webhook handler parses `payment_intent.succeeded` but doesn't yet write back to the DB.
- **Comments & Mentions** — Comment model links to matters, contracts, contract versions, or documents. Mention model exists for @-tagging users.
- **Reminders** — `DEADLINE`, `RENEWAL`, `PAYMENT` reminder types linked to contracts. Scheduling/sending is TODO.
- **Tasks** — Work items linked to matters with assignees and due dates.
- **Notifications** — `SYSTEM`, `MENTION`, `REMINDER`, `BILLING` types. Models and enums defined; trigger system is TODO.
- **Audit Logging** — `AuditLog` captures actor, entity type, action (`CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `SIGN`, etc.), before/after JSON snapshots, IP, and User-Agent. Capture calls are TODO.
- **Clause Library** — Reusable contract clauses with Markdown body, tags, and optional public/org-scoped visibility.
- **Share Links** — Expiring tokens for sharing contracts or documents with external parties at a specified role level (`viewer`, `commenter`, `editor`).
- **API Keys** — Per-org API key management with hashed key storage and last-used tracking.
- **Webhooks** — `WebhookEndpoint` and `WebhookDelivery` models for outbound webhook subscriptions and delivery audit logging.

---

## Repository Layout

```text
contractcanvas/
├─ apps/
│  ├─ api/                        # Express + Prisma API (TypeScript)
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma         # 26-model Prisma schema
│  │  │  └─ migrations/           # Migration history
│  │  └─ src/
│  │     ├─ routes/
│  │     │  ├─ auth.ts            # /api/auth/*
│  │     │  ├─ organizations.ts   # /api/organizations/*
│  │     │  ├─ matters.ts         # /api/matters/*
│  │     │  ├─ contracts.ts       # /api/contracts/* + versions
│  │     │  ├─ documents.ts       # /api/documents/*
│  │     │  ├─ signatures.ts      # /api/signatures/*
│  │     │  └─ billing.ts         # /api/billing/*
│  │     ├─ middleware/
│  │     │  └─ auth.ts            # protect, optionalAuth, requireRole
│  │     ├─ prisma.ts             # Prisma client singleton
│  │     └─ server.ts             # Express bootstrap, error handler
│  └─ web/                        # Angular 20 SPA
│     └─ src/app/
│        ├─ pages/
│        │  ├─ login/             # Login page (Material)
│        │  ├─ register/          # Register page (create or join org)
│        │  ├─ dashboard/         # Protected home page
│        │  ├─ matter-list/       # List all matters
│        │  └─ matter-detail/     # Single matter view
│        ├─ services/
│        │  ├─ auth.service.ts    # JWT storage, login/register/me, user signal
│        │  └─ matter.service.ts  # getMatters, getMatter
│        ├─ guards/
│        │  └─ auth-guard.ts      # CanActivateFn redirecting to /login
│        ├─ interceptors/
│        │  └─ jwt.interceptor.ts # Injects Bearer token on /api/* requests
│        ├─ app.routes.ts         # Route definitions
│        └─ app.config.ts         # Angular bootstrap config
├─ packages/
│  └─ shared-ts/                  # Shared TypeScript utilities (minimal)
├─ infra/
│  └─ docker-compose.yml          # PostgreSQL 16 + MinIO containers
├─ scripts/
│  └─ config-to-env.mjs           # Generates env files from config.json
├─ config.json                    # Centralized app/db/s3/stripe/jwt config
└─ package.json                   # Root workspace scripts
```

---

## Tech Stack

| Layer          | Technology                                            |
| -------------- | ----------------------------------------------------- |
| API runtime    | Node.js 20+, TypeScript, Express 4                    |
| ORM            | Prisma 5 (PostgreSQL 16)                              |
| Validation     | Zod                                                   |
| Auth           | jsonwebtoken + jose (RS256/HS256), bcrypt             |
| File uploads   | Multer (memory storage)                               |
| Object storage | AWS S3 SDK v3 / MinIO                                 |
| Payments       | Stripe SDK v19                                        |
| Frontend       | Angular 20, Angular Material 20                       |
| HTTP client    | Angular HttpClient with functional interceptors       |
| Forms          | Angular ReactiveFormsModule                           |
| Reactive state | Angular signals (`currentUser` signal in AuthService) |
| Dev infra      | Docker Compose, tsx, concurrently                     |
| Build          | Angular CLI + Vite (web), tsc (API)                   |
| Testing        | Jest via `@angular-builders/jest` (web)               |

---

## Database Models (26)

| Model                | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `User`               | User accounts — email, bcrypt password hash, name, system role  |
| `Organization`       | Tenant orgs — name, slug (unique)                               |
| `OrganizationMember` | Many-to-many: user ↔ org with org-level role                    |
| `Session`            | Login session tracking — IP, User-Agent, expiry                 |
| `Matter`             | Legal matters/cases — title, status, owner, org                 |
| `MatterParticipant`  | Many-to-many: user ↔ matter collaborators                       |
| `Contract`           | Contracts — title, status, value in cents, matter link          |
| `ContractVersion`    | Immutable version history — S3 key, diff JSON, AI context       |
| `Tag`                | Org-scoped categorization labels                                |
| `ContractVersionTag` | Many-to-many: version ↔ tag                                     |
| `Clause`             | Reusable Markdown clause library                                |
| `Document`           | File metadata — S3 key, MIME type, size, kind, status           |
| `Comment`            | Threaded comments on matters/contracts/versions/documents       |
| `Mention`            | User @-mentions inside comments                                 |
| `SignatureEnvelope`  | E-signature workflow — provider, recipients, status             |
| `Reminder`           | Due-date reminders (DEADLINE, RENEWAL, PAYMENT)                 |
| `Task`               | Work items linked to matters with assignees                     |
| `BillingProfile`     | Stripe customer ID per org/user, tax ID, address                |
| `Invoice`            | Billing records — Stripe ID, status, amounts, due date          |
| `Payment`            | Individual payment transactions — Stripe PaymentIntent ID       |
| `ShareLink`          | Expiring/one-time share tokens with role-level access           |
| `ApiKey`             | Per-org hashed API keys with last-used tracking                 |
| `WebhookEndpoint`    | Outbound webhook subscriptions per org                          |
| `WebhookDelivery`    | Webhook delivery audit log — request/response bodies, retries   |
| `Notification`       | User notifications (SYSTEM, MENTION, REMINDER, BILLING)         |
| `AuditLog`           | Full audit trail — actor, entity, action, before/after JSON, IP |

---

## API Reference

All protected routes require `Authorization: Bearer <token>`.

### Auth

| Method | Path                 | Auth | Description                                 |
| ------ | -------------------- | ---- | ------------------------------------------- |
| POST   | `/api/auth/register` | No   | Create account + org (or join existing org) |
| POST   | `/api/auth/login`    | No   | Login; returns JWT (1-day expiry)           |
| GET    | `/api/auth/me`       | Yes  | Fetch authenticated user details            |

### Organizations

| Method | Path                                          | Auth                      | Description                            |
| ------ | --------------------------------------------- | ------------------------- | -------------------------------------- |
| POST   | `/api/organizations`                          | Yes                       | Create a new organization              |
| GET    | `/api/organizations/me`                       | Yes                       | List organizations the user belongs to |
| GET    | `/api/organizations/:orgId/members`           | Yes                       | List members of an org                 |
| POST   | `/api/organizations/:orgId/members`           | Yes (OWNER/ADMIN)         | Add a member                           |
| PATCH  | `/api/organizations/:orgId/members/:memberId` | Yes (OWNER/ADMIN)         | Update a member's role                 |
| DELETE | `/api/organizations/:orgId/members/:memberId` | Yes (OWNER/ADMIN or self) | Remove a member                        |

### Matters

| Method | Path               | Auth | Description                            |
| ------ | ------------------ | ---- | -------------------------------------- |
| GET    | `/api/matters`     | Yes  | List matters                           |
| POST   | `/api/matters`     | Yes  | Create a matter                        |
| GET    | `/api/matters/:id` | Yes  | Get a single matter                    |
| PATCH  | `/api/matters/:id` | Yes  | Update matter title/description/status |
| DELETE | `/api/matters/:id` | Yes  | Soft-delete a matter                   |

### Contracts

| Method | Path                                  | Auth | Description                                              |
| ------ | ------------------------------------- | ---- | -------------------------------------------------------- |
| GET    | `/api/contracts`                      | Yes  | List contracts (includes matter info)                    |
| POST   | `/api/contracts`                      | Yes  | Create a contract                                        |
| GET    | `/api/contracts/:id`                  | Yes  | Get contract with versions + current version             |
| PATCH  | `/api/contracts/:id`                  | Yes  | Update contract status/value/title                       |
| DELETE | `/api/contracts/:id`                  | Yes  | Soft-delete a contract                                   |
| POST   | `/api/contracts/:contractId/versions` | Yes  | Add a new version (atomically increments version number) |
| GET    | `/api/contracts/:contractId/versions` | Yes  | List all versions (newest first)                         |

### Documents

| Method | Path                          | Auth | Description                                        |
| ------ | ----------------------------- | ---- | -------------------------------------------------- |
| POST   | `/api/documents/upload`       | Yes  | Upload file (multipart/form-data, 50 MB max) to S3 |
| GET    | `/api/documents`              | Yes  | List documents for a matter (`?matterId=<id>`)     |
| GET    | `/api/documents/:id`          | Yes  | Get document metadata                              |
| GET    | `/api/documents/:id/download` | Yes  | Get presigned S3 URL (5-minute expiry)             |
| DELETE | `/api/documents/:id`          | Yes  | Soft-delete a document                             |

**S3 key format:** `orgs/{orgId}/matters/{matterId}/{timestamp}-{random}.{ext}`

### Signatures

| Method | Path                  | Auth | Description                         |
| ------ | --------------------- | ---- | ----------------------------------- |
| POST   | `/api/signatures`     | Yes  | Create a signature envelope         |
| GET    | `/api/signatures`     | Yes  | List envelopes (`?contractId=<id>`) |
| GET    | `/api/signatures/:id` | Yes  | Get envelope status and details     |

### Billing

| Method | Path                           | Auth | Description                                            |
| ------ | ------------------------------ | ---- | ------------------------------------------------------ |
| POST   | `/api/billing/invoice`         | Yes  | Create a Stripe PaymentIntent; returns `client_secret` |
| POST   | `/api/billing/webhooks/stripe` | No   | Stripe webhook receiver (raw body)                     |

---

## Prerequisites

- **Node.js** 20+ (LTS recommended)
- **Docker** and **Docker Compose**
- **npm** (root uses npm workspaces)

---

## Configuration

All local configuration lives in `config.json` at the repo root. Copy and fill in your values:

```json
{
  "app": { "env": "development", "port": 3333 },
  "db": {
    "user": "contractcanvas",
    "password": "your-db-password",
    "name": "contractcanvas_db",
    "port": 5432,
    "container_name": "contractcanvas-postgres"
  },
  "s3": {
    "endpoint": "http://localhost:9000",
    "region": "us-east-1",
    "bucket": "contractcanvas",
    "accessKey": "your-minio-access-key",
    "secretKey": "your-minio-secret-key",
    "forcePathStyle": true
  },
  "stripe": {
    "secretKey": "sk_test_...",
    "webhookSecret": "whsec_..."
  },
  "jwt": { "secret": "a-strong-secret-at-least-32-chars" }
}
```

Then generate the env files that Prisma and Docker Compose need:

```bash
npm run config:env
```

This writes:

- `apps/api/prisma/.env` — `DATABASE_URL` for Prisma
- `infra/.env` — variables for Docker Compose

> **Important:** Do **not** define `DATABASE_URL` in the repo root `.env`. Prisma will complain about conflicting env sources. Keep it in `apps/api/prisma/.env` only (generated by `config:env`).

---

## Quick Start (Local Development)

1. **Generate env files from config.json**

   ```bash
   npm run config:env
   ```

2. **Start infrastructure (PostgreSQL + MinIO)**

   ```bash
   npm run up
   ```

3. **Install dependencies**

   ```bash
   npm install
   cd apps/api && npm install
   cd ../web && npm install
   cd ../..
   ```

4. **Generate the Prisma client and apply migrations**

   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

5. **Run both API and web in parallel**

   ```bash
   npm run dev
   ```

   - API: `http://localhost:3333`
   - Web: `http://localhost:4200`

6. **Verify**

   ```bash
   curl -i http://localhost:3333/health
   # or via the Angular proxy:
   curl -i http://localhost:4200/api/health
   ```

---

## Auth Flow

### Roles

**System roles** (assigned at registration, stored on the `User` model):

| Role        | Description                                               |
| ----------- | --------------------------------------------------------- |
| `ADMIN`     | Full system access                                        |
| `LAWYER`    | Legal professional — full contract and matter access      |
| `PARALEGAL` | Support role — similar to Lawyer with reduced permissions |
| `CLIENT`    | Client-side user — limited, read-oriented access          |

**Org roles** (assigned per membership, stored on `OrganizationMember`):

| Role     | Description                                               |
| -------- | --------------------------------------------------------- |
| `OWNER`  | Created the org; full control including member management |
| `ADMIN`  | Can manage members and all org resources                  |
| `MEMBER` | Standard membership; cannot manage other members          |

### Register — create a new org

```bash
curl -i -X POST http://localhost:4200/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "alice@acme.com",
    "password": "Password1!",
    "confirmPassword": "Password1!",
    "name": { "firstName": "Alice", "lastName": "Smith" },
    "role": "LAWYER",
    "orgMode": "create",
    "organizationName": "ACME Legal",
    "organizationSlug": "acme-legal",
    "acceptTerms": true
  }'
```

Response `201`:

```json
{
  "message": "Registration successful",
  "user": { "id": "...", "email": "alice@acme.com", ... },
  "organization": { "id": "...", "slug": "acme-legal", ... },
  "redirectTo": "/login"
}
```

Append `?autoLogin=1` to also receive a `"token"` in the response.

### Register — join an existing org

```bash
curl -i -X POST http://localhost:4200/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "bob@acme.com",
    "password": "Password1!",
    "confirmPassword": "Password1!",
    "name": { "firstName": "Bob", "lastName": "Jones" },
    "role": "CLIENT",
    "orgMode": "join",
    "organizationSlug": "acme-legal",
    "acceptTerms": true
  }'
```

### Login

```bash
curl -s -X POST http://localhost:4200/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email": "alice@acme.com", "password": "Password1!"}'
# => { "token": "eyJ..." }
```

### Fetch current user

```bash
curl -s http://localhost:4200/api/auth/me \
  -H "Authorization: Bearer <token>"
```

### JWT verification

The middleware tries RS256 with a remote JWKS first (configured via `JWT_JWKS_URI` env var), then falls back to HS256 using `jwt.secret` from `config.json`. This allows drop-in compatibility with OpenID Connect providers (Auth0, Cognito, etc.) without code changes.

---

## Sample API Calls

### Create a matter

```bash
curl -s -X POST http://localhost:3333/api/matters \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Smith v. Jones",
    "description": "Contract dispute",
    "status": "OPEN",
    "organizationId": "<org-cuid>"
  }'
```

### Create a contract under a matter

```bash
curl -s -X POST http://localhost:3333/api/contracts \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Settlement Agreement",
    "matterId": "<matter-cuid>",
    "valueCents": 500000,
    "currency": "USD"
  }'
```

### Add a contract version (after uploading the file as a document)

```bash
curl -s -X POST http://localhost:3333/api/contracts/<contract-id>/versions \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{
    "storageKey": "orgs/<org-id>/matters/<matter-id>/1710000000-abc123.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 204800,
    "title": "Version 1 — initial draft"
  }'
```

### Upload a document

```bash
curl -i -X POST http://localhost:3333/api/documents/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/contract.pdf" \
  -F "matterId=<matter-cuid>" \
  -F "organizationId=<org-cuid>" \
  -F "kind=UPLOADED"
```

### Get a presigned download URL

```bash
curl -s http://localhost:3333/api/documents/<doc-id>/download \
  -H "Authorization: Bearer <token>"
# => { "url": "http://localhost:9000/contractcanvas/...?X-Amz-Signature=..." }
```

### Create a Stripe PaymentIntent

```bash
curl -s -X POST http://localhost:3333/api/billing/invoice \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{ "amount_cents": 150000, "currency": "usd" }'
# => { "client_secret": "pi_...secret_..." }
```

---

## Angular Web App

### Pages

| Route          | Component               | Guard       | Description                                         |
| -------------- | ----------------------- | ----------- | --------------------------------------------------- |
| `/login`       | `LoginComponent`        | —           | Email/password login with Material UI               |
| `/register`    | `RegisterComponent`     | —           | Registration with create-or-join org flow           |
| `/dashboard`   | `DashboardComponent`    | `authGuard` | Home after login; shows current user                |
| `/matters`     | `MatterListComponent`   | `authGuard` | Paginated/sortable matter table                     |
| `/matters/:id` | `MatterDetailComponent` | `authGuard` | Matter detail with contracts, docs, tasks, comments |

### Key services

**`AuthService`** (`services/auth.service.ts`)

- Token stored in `localStorage` under key `contractcanvas_auth_token`
- Exposes `currentUser` as an Angular signal for reactive templates
- Methods: `register`, `login`, `getMe`, `logout`, `getToken`, `isLoggedIn`

**`MatterService`** (`services/matter.service.ts`)

- Methods: `getMatters()`, `getMatter(id)`

### HTTP interceptor

`jwtInterceptor` is a functional `HttpInterceptorFn` that injects `Authorization: Bearer <token>` on every request to `/api/*`.

### Dev proxy

`proxy.conf.json` forwards `/api` from port 4200 to port 3333:

```json
{
  "/api": {
    "target": "http://localhost:3333",
    "secure": false,
    "changeOrigin": true
  }
}
```

This is wired in `angular.json` under `serve > options > proxyConfig`.

---

## Scripts Reference

```bash
# Config
npm run config:env           # Generate prisma/.env and infra/.env from config.json

# Prisma
npm run prisma:generate      # Generate Prisma client from schema
npm run prisma:migrate       # Apply pending migrations
npm run prisma:push          # Sync schema without migration (dev only, no history)
npm run prisma:studio        # Open Prisma Studio at http://localhost:5555

# Infrastructure (Docker)
npm run up                   # Start PostgreSQL + MinIO containers
npm run down                 # Stop and remove containers + volumes (data loss)
npm run down:keep            # Stop containers but keep volumes

# Development
npm run dev                  # Start API + web concurrently
npm run dev:api              # API only (tsx watch on apps/api/src/server.ts)
npm run dev:web              # Web only (ng serve on port 4200 with proxy)

# Build (production)
npm run -w apps/api build    # Compile API TypeScript → apps/api/dist/
npm run -w apps/web build    # Build Angular SPA → apps/web/dist/
```

---

## Prisma & Database

**Reset and start fresh** (destroys all data):

```bash
npm run down
npm run up
npm run prisma:migrate
```

**Open Prisma Studio** (visual DB browser):

```bash
npm run prisma:studio
# → http://localhost:5555
```

**Migration workflow:**

```bash
# After editing apps/api/prisma/schema.prisma:
npm run -w apps/api exec -- npx prisma migrate dev --name describe_your_change
npm run prisma:generate
```

---

## Troubleshooting

| Symptom                          | Fix                                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `404` on `/api/*` via port 4200  | Angular proxy not running or misconfigured. Check `proxy.conf.json` and restart `npm run dev:web`.                                                                      |
| Prisma `P2021` (table not found) | Run `npm run prisma:migrate`.                                                                                                                                           |
| Prisma `DATABASE_URL` conflict   | Remove `DATABASE_URL` from the repo root `.env`; it belongs only in `apps/api/prisma/.env` (generated by `config:env`).                                                 |
| Multer/TypeScript type errors    | Run `rm -rf node_modules apps/api/node_modules apps/web/node_modules package-lock.json && npm install`.                                                                 |
| MinIO bucket not found           | Create the bucket via the MinIO console at `http://localhost:9001` or with the `mc` CLI. The bucket name must match `s3.bucket` in `config.json`.                       |
| Stripe webhook signature invalid | Ensure `express.raw()` body parser is used on `/api/billing/webhooks/stripe` (already configured). Confirm `stripe.webhookSecret` matches your Stripe dashboard secret. |
| JWT verification fails           | Check that `jwt.secret` in `config.json` matches the secret used to sign tokens. For RS256/JWKS, set `JWT_JWKS_URI` env var to your provider's JWKS endpoint.           |

---

## Security Notes

- Never commit `config.json` with real secrets. Use it only for local development.
- In production, provide secrets via environment variables (`JWT_SECRET`, `DATABASE_URL`, `STRIPE_SECRET_KEY`, `S3_ACCESS_KEY`, etc.).
- `JWT_SECRET` must be a strong, random string (32+ characters) in production.
- Tighten CORS origins in `apps/api/src/server.ts` before deploying publicly.
- S3 bucket policies should restrict public access; use presigned URLs for all downloads.

---

## Production Deployment (Outline)

1. Fill in production values and run `npm run config:env`, or supply env vars directly.
2. Build the API: `npm run -w apps/api build` → serves from `apps/api/dist/server.js`
3. Build the web: `npm run -w apps/web build` → static assets in `apps/web/dist/`
4. Serve the API behind a reverse proxy (nginx, Caddy) with HTTPS termination.
5. Serve the web static assets from the same reverse proxy or a CDN, with `/api/*` proxied to the API.
6. Use a managed PostgreSQL instance and AWS S3 (set `s3.forcePathStyle: false`, remove `s3.endpoint`).
7. Configure Stripe webhook endpoint to point to `https://yourdomain.com/api/billing/webhooks/stripe`.

---

## Contributing

Issues and PRs are welcome. Please keep commits scoped to a single concern and include manual testing steps or automated tests where applicable.

---

## License

MIT
