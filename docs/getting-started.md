---
title: Getting Started
sort: 2
---

# Getting Started

## Prerequisites

- Node.js >= 20
- Docker and Docker Compose
- Git

## 1. Clone and Install

```bash
git clone <repo-url> contractcanvas
cd contractcanvas
npm install
```

## 2. Environment Setup

```bash
cp infra/.env.example infra/.env
```

Required environment variables:

| Variable            | Description                    | Example                   |
| ------------------- | ------------------------------ | ------------------------- |
| `POSTGRES_USER`     | Database user                  | `cc_user`                 |
| `POSTGRES_PASSWORD` | Database password              | `strongpassword`          |
| `POSTGRES_DB`       | Database name                  | `contractcanvas`          |
| `JWT_SECRET`        | JWT signing key (min 32 chars) | `your-secret-key-here...` |
| `S3_ACCESS_KEY`     | MinIO/S3 access key            | `minioadmin`              |
| `S3_SECRET_KEY`     | MinIO/S3 secret key            | `minioadmin`              |
| `FRONTEND_URL`      | Frontend origin for CORS       | `http://localhost:4200`   |

Optional variables:

| Variable                | Description                              |
| ----------------------- | ---------------------------------------- |
| `REDIS_URL`             | Redis connection (enables BullMQ queues) |
| `STRIPE_SECRET_KEY`     | Stripe API key for billing               |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification    |
| `POSTMARK_API_TOKEN`    | Email delivery via Postmark              |
| `SENTRY_DSN`            | Error tracking                           |
| `DOCUSIGN_ACCESS_TOKEN` | DocuSign API access                      |
| `DOCUSIGN_ACCOUNT_ID`   | DocuSign account                         |
| `HELLOSIGN_API_KEY`     | HelloSign API key                        |

## 3. Start Infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d db minio redis
```

This starts PostgreSQL 16, MinIO (S3-compatible storage), and Redis.

## 4. Generate Prisma Client and Push Schema

```bash
npm run prisma:generate
npm run prisma:push
```

## 5. Seed the Database (optional)

```bash
cd apps/api && npx tsx prisma/seed.ts
```

Creates sample users (alice/bob/carol), organizations, matters, contracts, tasks, and clauses.

**Seed credentials:**

- `alice@example.com` / `Password1234!` (ADMIN, org OWNER)
- `bob@example.com` / `Password1234!` (LAWYER, MEMBER)
- `carol@example.com` / `Password1234!` (PARALEGAL, MEMBER)

## 6. Start Development Servers

```bash
# From the root directory — starts both API and Web concurrently
npm run dev
```

Or start individually:

```bash
npm run dev:api   # Express API on :3333
npm run dev:web   # Angular dev server on :4200
```

## 7. Verify

- API health: [http://localhost:3333/health](http://localhost:3333/health)
- Frontend: [http://localhost:4200](http://localhost:4200)

## Running Tests

```bash
# API unit + integration tests (Vitest)
cd apps/api && npm test

# Frontend tests (Jest)
cd apps/web && npx jest

# E2E tests (Playwright) — requires servers running
npm run test:e2e
```

[Back to Home](.)
