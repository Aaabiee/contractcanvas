# ContractCanvas

A modern, multi-tenant **contract and matter management platform** built for law firms and their clients. Manages the full lifecycle of legal work: matters, contract drafting and versioning, document storage, tasks, team collaboration, notifications, clause library, billing, and e-signatures — all scoped to isolated organizations.

Monorepo with a Node/Express API, Angular 20 web app, PostgreSQL 16 (via Docker), S3-compatible storage (MinIO), Stripe billing, and Prisma 5 ORM.

> All API routes are mounted under `/api/*`. The Angular dev server proxies `/api` → `http://localhost:3333`.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                          GitHub Actions                             │
│  ci.yml (lint+test+build) ──► deploy-dev/qa/prod.yml               │
│                                    │ build+push to GHCR             │
│                                    ▼ SSH deploy                     │
│                            Docker host (dev/qa/prod)                │
└─────────────────────────────────────┬───────────────────────────────┘
                                      │
              ┌───────────────────────▼───────────────────────┐
              │               nginx:1.27-alpine               │
              │  - Serves Angular SPA (static assets)         │
              │  - Proxies /api/* → api:3333                  │
              │  - gzip, security headers, 1-yr asset cache   │
              └───────────────────────┬───────────────────────┘
                         ┌────────────┴──────────┐
                         │                       │
              ┌──────────▼──────────┐  ┌─────────▼──────────┐
              │   Angular 20 SPA    │  │  Express API (3333) │
              │  Standalone comps   │  │  TypeScript, Prisma │
              │  Signals, RxJS      │  │  JWT + Helmet       │
              │  Material Design    │  │  Rate limiting      │
              └─────────────────────┘  └──────┬──────┬───────┘
                                              │      │
                          ┌───────────────────┘      └──────────┐
                          │                                      │
               ┌──────────▼──────────┐              ┌───────────▼──────────┐
               │   PostgreSQL 16     │              │   MinIO (S3-compat.)  │
               │   Prisma 5 ORM      │              │   Document storage    │
               │   26-model schema   │              │   Presigned URLs      │
               └─────────────────────┘              └──────────────────────┘
                                                              │
                                                   ┌──────────▼──────────┐
                                                   │   Stripe API        │
                                                   │   PaymentIntents    │
                                                   └─────────────────────┘
```

---

## Features

- **JWT Authentication** — Register (create/join org), login, refresh-token, `/me`. Passwords hashed with bcrypt. HS256 with RS256/JWKS fallback.
- **Organizations & Multi-tenancy** — Every resource scoped to an organization. Users belong to multiple orgs with distinct roles per org.
- **Role-Based Access Control** — System roles (`ADMIN`, `LAWYER`, `PARALEGAL`, `CLIENT`) and org roles (`OWNER`, `ADMIN`, `MEMBER`).
- **Matters** — Full CRUD with states: `OPEN`, `ON_HOLD`, `CLOSED`. Paginated list with contract/task count badges.
- **Contracts** — Status workflow: `DRAFT → NEGOTIATION → PENDING_SIGNATURE → EXECUTED → ARCHIVED`. Tracks value in cents + currency.
- **Contract Versioning** — Immutable version history with S3 key, MIME type, size, author, diff JSON, and AI context.
- **Document Management** — Upload up to 50 MB to S3/MinIO. Presigned download URLs (5-min expiry). Soft-delete.
- **Tasks** — Paginated work items linked to matters. Assignee, due date, completion toggle. Overdue detection in UI.
- **Comments** — Multi-resource comments (matter/contract/version/document). Author-only edit/delete. `editedAt` tracking.
- **Notifications** — User-scoped notifications with `readAt`, batch mark-all-read, unread count signal in UI.
- **Clause Library** — Reusable contract clauses (Markdown body, tags). Public or org-scoped visibility. Full-text search.
- **Org Membership Management** — Owners/admins add, update, and remove members.
- **Billing** — Stripe `PaymentIntent` creation. Invoice and Payment models exist.
- **E-Signatures** — Provider-agnostic envelope model (DocuSign/HelloSign). SDK integration pending.
- **Soft Deletes** — Matters, contracts, documents use `deletedAt` for audit-safe removal.
- **Compound DB Indexes** — Production-grade indexes on `[organizationId, status]`, `[organizationId, matterId]`, `[organizationId, assigneeId]`, etc.

---

## Repository Layout

```text
contractcanvas/
├─ apps/
│  ├─ api/                          # Express + Prisma API
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma           # 26-model schema
│  │  │  ├─ seed.ts                 # Dev seed (alice/bob/carol + sample data)
│  │  │  └─ migrations/
│  │  ├─ src/
│  │  │  ├─ config.ts               # Env vars (JWT, DB, S3, Stripe)
│  │  │  ├─ server.ts               # Express app bootstrap
│  │  │  ├─ prisma.ts               # Prisma client singleton
│  │  │  ├─ middleware/
│  │  │  │  └─ auth.ts              # protect() + JWT decode
│  │  │  └─ routes/
│  │  │     ├─ auth.ts              # /api/auth
│  │  │     ├─ matters.ts           # /api/matters
│  │  │     ├─ contracts.ts         # /api/contracts
│  │  │     ├─ documents.ts         # /api/documents
│  │  │     ├─ tasks.ts             # /api/tasks
│  │  │     ├─ comments.ts          # /api/comments
│  │  │     ├─ notifications.ts     # /api/notifications
│  │  │     ├─ clauses.ts           # /api/clauses
│  │  │     ├─ organizations.ts     # /api/organizations
│  │  │     ├─ signatures.ts        # /api/signatures
│  │  │     └─ billing.ts           # /api/billing
│  │  ├─ Dockerfile                 # Multi-stage Node 20 → Alpine runner
│  │  └─ vitest.config.ts
│  │
│  └─ web/                          # Angular 20 SPA
│     └─ src/app/
│        ├─ guards/
│        │  └─ auth-guard.ts
│        ├─ interceptors/
│        │  ├─ jwt.interceptor.ts   # Attaches Bearer token + X-Organization-Id
│        │  └─ error.interceptor.ts # Global 401/403/500 handler; auto-logout
│        ├─ services/
│        │  ├─ auth.service.ts
│        │  ├─ matter.service.ts
│        │  ├─ contract.service.ts
│        │  ├─ document.service.ts
│        │  ├─ task.service.ts
│        │  ├─ notification.service.ts
│        │  ├─ organization.service.ts
│        │  └─ billing.service.ts
│        └─ pages/
│           ├─ login/
│           ├─ register/
│           ├─ dashboard/
│           ├─ matter-list/
│           ├─ matter-detail/       # Tabbed: Contracts | Documents | Tasks
│           ├─ contract-list/
│           ├─ contract-detail/
│           ├─ tasks/
│           ├─ billing/
│           └─ organization-settings/
│
├─ infra/
│  └─ docker-compose.yml            # postgres, minio, api (profile), web (profile)
│
├─ .github/workflows/
│  ├─ ci.yml                        # Lint + test + build + Docker verify
│  ├─ deploy-dev.yml                # Push to develop → deploy to dev
│  ├─ deploy-qa.yml                 # Push to release/** → deploy to QA
│  └─ deploy-prod.yml               # Version tag → prod (requires DEPLOY confirmation)
│
└─ package.json                     # npm workspaces root
```

---

## API Reference

All protected routes require:

- `Authorization: Bearer <token>`
- `X-Organization-Id: <orgId>`

### Auth — `/api/auth`

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| POST | `/register` | — | Create account and org |
| POST | `/login` | — | Get JWT |
| POST | `/refresh-token` | Bearer | Re-issue JWT with current memberships |
| GET | `/me` | Bearer | Current user profile |

### Matters — `/api/matters`

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/` | List matters (paginated, `?status=&limit=&offset=`) |
| POST | `/` | Create matter |
| GET | `/:id` | Get matter (includes contracts, documents, tasks) |
| PATCH | `/:id` | Update matter |
| DELETE | `/:id` | Soft-delete matter |

### Contracts — `/api/contracts`

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/` | List contracts (`?matterId=&status=&limit=&offset=`) |
| POST | `/` | Create contract |
| GET | `/:id` | Get contract with versions |
| PATCH | `/:id` | Update status / fields |
| DELETE | `/:id` | Soft-delete contract |
| GET | `/:id/versions` | List versions |
| POST | `/:id/versions` | Add version |

### Documents — `/api/documents`

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/upload` | Upload file (multipart, `?matterId=`) |
| GET | `/` | List documents (`?matterId=`) |
| GET | `/:id` | Get document metadata |
| GET | `/:id/download` | Get presigned download URL |
| DELETE | `/:id` | Soft-delete document |

### Tasks — `/api/tasks`

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/` | List tasks (`?matterId=&assigneeId=&completed=&limit=&offset=`) |
| POST | `/` | Create task |
| GET | `/:id` | Get task |
| PATCH | `/:id` | Update task (set `completedAt` to mark done) |
| DELETE | `/:id` | Delete task |

### Comments — `/api/comments`

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/` | List comments (`?matterId=&contractId=&documentId=&limit=&offset=`) |
| POST | `/` | Create comment (requires one resource id) |
| PATCH | `/:id` | Edit comment (author only) |
| DELETE | `/:id` | Delete comment (author only) |

### Notifications — `/api/notifications`

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/` | List notifications (`?unread=true&limit=&offset=`) + `unreadCount` in response |
| PATCH | `/read-all` | Mark all unread as read |
| PATCH | `/:id/read` | Mark one notification as read |

### Clause Library — `/api/clauses`

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/` | List clauses (`?q=&limit=&offset=`) — org + public |
| POST | `/` | Create clause |
| GET | `/:id` | Get clause |
| PATCH | `/:id` | Update clause (org-owned only) |
| DELETE | `/:id` | Delete clause (org-owned only) |

### Organizations — `/api/organizations`

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/` | List orgs for current user |
| GET | `/:id/members` | List org members |
| POST | `/:id/members` | Add member by email |
| PATCH | `/:id/members/:userId` | Update member role |
| DELETE | `/:id/members/:userId` | Remove member |

### Billing — `/api/billing`

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/invoice` | Create Stripe PaymentIntent, returns `clientSecret` |

---

## Angular Pages & Services

### Pages

| Route | Component | Description |
| ----- | --------- | ----------- |
| `/login` | LoginComponent | Email + password form |
| `/register` | RegisterComponent | Account creation |
| `/dashboard` | DashboardComponent | Live stats, pending tasks, quick actions |
| `/matters` | MatterListComponent | Paginated matter list with count badges |
| `/matters/:id` | MatterDetailComponent | Tabbed: Contracts, Documents, Tasks |
| `/contracts` | ContractListComponent | Paginated contract list with status filter |
| `/contracts/:id` | ContractDetailComponent | Contract detail with version history |
| `/tasks` | TasksComponent | Filterable task list with completion toggle |
| `/billing` | BillingComponent | Invoice creation via Stripe |
| `/settings/organization` | OrganizationSettingsComponent | Member table + invite |

### Services

| Service | Key Methods |
| ------- | ----------- |
| `AuthService` | `login`, `register`, `logout`, `refreshToken`, `currentUser` signal |
| `MatterService` | `getMatters`, `getMatter`, `createMatter`, `updateMatter`, `deleteMatter` |
| `ContractService` | `getContracts`, `getContract`, `createContract`, `updateContract`, `deleteContract`, `getVersions`, `addVersion` |
| `DocumentService` | `uploadDocument`, `getDocuments`, `getDocument`, `getDownloadUrl`, `deleteDocument` |
| `TaskService` | `getTasks`, `createTask`, `updateTask`, `completeTask`, `reopenTask`, `deleteTask` |
| `NotificationService` | `getNotifications`, `markRead`, `markAllRead`, `unreadCount` signal |
| `OrganizationService` | `getMyOrganizations`, `getMembers`, `addMember`, `updateMember`, `removeMember` |
| `BillingService` | `createInvoice` |

### Interceptors

| Interceptor | Behavior |
| ----------- | -------- |
| `JwtInterceptor` | Attaches `Authorization: Bearer <token>` and `X-Organization-Id` to every outbound request |
| `ErrorInterceptor` | 401 → auto-logout + redirect to `/login`; 403/500 → surface error message |

---

## Getting Started

### Prerequisites

- Node 20+
- Docker + Docker Compose

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start infrastructure (Postgres + MinIO)
docker compose -f infra/docker-compose.yml up -d

# 3. Run migrations + seed
cd apps/api
npx prisma migrate dev
npx prisma db seed

# 4. Start API (port 3333)
npm run dev -w apps/api

# 5. Start Angular dev server (port 4200)
npm run start -w apps/web
```

Open [http://localhost:4200](http://localhost:4200). Log in with any seed account (see below).

### Seed Accounts

| Email | Password | Role |
| ----- | -------- | ---- |
| `alice@acme.law` | `Password123!` | OWNER (Acme Law Firm) |
| `bob@acme.law` | `Password123!` | MEMBER (LAWYER) |
| `carol@acme.law` | `Password123!` | MEMBER (PARALEGAL) |

Seed also creates 2 matters, 2 contracts, 3 tasks, 3 clauses (1 public), and 2 notifications.

---

## Running Tests

```bash
# API tests (Vitest)
npm test -w apps/api

# Web tests (Jest via @angular-builders/jest)
npm test -w apps/web

# All tests from root
npm test
```

---

## Production Build

### Docker Compose (full stack)

```bash
docker compose -f infra/docker-compose.yml --profile full up -d
```

Profiles: `full` (all services), `prod`, `qa`, `staging` (infrastructure only by default).

### Individual Images

```bash
# API
docker build -t contractcanvas-api apps/api

# Web
docker build -t contractcanvas-web apps/web
```

---

## CI/CD Pipeline

### Workflows

| File | Trigger | What it does |
| ---- | ------- | ------------ |
| `ci.yml` | Every push / PR | API lint + test + build; Web lint + test + build; Docker image verification |
| `deploy-dev.yml` | Push to `develop` | Build + push to GHCR with `:dev` tag; SSH deploy with `--profile full` |
| `deploy-qa.yml` | Push to `release/**` | Build + push with `:qa` tag; smoke-test loop (5 retries); SSH deploy |
| `deploy-prod.yml` | Version tag `v*.*.*` | Guard job requires `confirm == 'DEPLOY'`; build + push `:latest`; health check; GitHub Release |

### Required Secrets

**Dev:** `DEV_HOST`, `DEV_USER`, `DEV_SSH_KEY`, `DEV_POSTGRES_USER`, `DEV_POSTGRES_PASSWORD`, `DEV_POSTGRES_DB`, `DEV_JWT_SECRET`, `DEV_S3_ACCESS_KEY`, `DEV_S3_SECRET_KEY`

**QA:** `QA_HOST`, `QA_USER`, `QA_SSH_KEY`, `QA_POSTGRES_*`, `QA_JWT_SECRET`, `QA_S3_*`, `QA_STRIPE_SECRET_KEY`, `QA_STRIPE_WEBHOOK_SECRET`

**Prod:** `PROD_HOST`, `PROD_USER`, `PROD_SSH_KEY`, `PROD_POSTGRES_*`, `PROD_JWT_SECRET`, `PROD_S3_*`, `PROD_STRIPE_SECRET_KEY`, `PROD_STRIPE_WEBHOOK_SECRET`

**GitHub Environment Variables:** `DEV_URL`, `DEV_API_URL`, `QA_URL`, `QA_API_URL`, `PROD_URL`, `PROD_API_URL`

---

## Environment Variables

### API (`apps/api/.env`)

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/contractcanvas
JWT_SECRET=your-secret-here
FRONTEND_URL=http://localhost:4200
PORT=3333
NODE_ENV=development

# S3 / MinIO
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=contractcanvas
S3_REGION=us-east-1

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Web (`apps/web/src/environments/`)

The Angular app reads the API base URL from the environment file. In development, the proxy config in `angular.json` handles `/api` → `localhost:3333`.

---

## Pending / Future Work

- E-signature provider SDK integration (DocuSign / HelloSign)
- Billing webhook: update Invoice/Payment in DB on `payment_intent.succeeded`
- Comments UI embedded in matter-detail and contract-detail
- WebSocket or SSE for real-time notifications
- E2E tests (Playwright or Cypress)
- Token blacklist (Redis) for logout invalidation
- Input sanitization on all Markdown fields
- File type validation allowlist on document upload
- Global search across matters/contracts/documents
- Dark mode Material theme toggle
- Reminder scheduling (node-cron or Bull)
- Share link creation and validation
