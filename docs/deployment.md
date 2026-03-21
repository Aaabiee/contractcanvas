---
layout: default
title: Deployment
---

# Deployment

## Docker Services

All services are defined in `infra/docker-compose.yml`:

| Service   | Image              | Port       | Description                                     |
| --------- | ------------------ | ---------- | ----------------------------------------------- |
| db        | postgres:16-alpine | 5433       | PostgreSQL database                             |
| pgbouncer | edoburu/pgbouncer  | 5432       | Connection pooler (transaction mode)            |
| redis     | redis:7-alpine     | 6379       | Cache, sessions, BullMQ                         |
| minio     | minio/minio        | 9000, 9001 | S3-compatible storage                           |
| api       | contractcanvas-api | 3333       | Express API (profile: full/prod/staging/qa)     |
| web       | contractcanvas-web | 80         | Nginx + Angular (profile: full/prod/staging/qa) |

### Local Development

```bash
docker compose -f infra/docker-compose.yml up -d db minio redis
npm run dev
```

### Full Stack (Staging/QA)

```bash
docker compose -f infra/docker-compose.yml --profile staging up -d
```

## Dockerfiles

### API (`apps/api/Dockerfile`)

Multi-stage build:

1. **builder** — Node 20, `npm ci`, `tsc`, Prisma generate
2. **runner** — Alpine, production deps only, non-root `node` user

Includes `HEALTHCHECK` that pings `GET /health` every 15s.

### Web (`apps/web/Dockerfile`)

Multi-stage build:

1. **builder** — Node 20, `npm ci`, `ng build --configuration=production`
2. **runner** — nginx:1.27-alpine with SPA fallback, API proxy, security headers, gzip, asset caching

## CI/CD Pipelines

All workflows are in `.github/workflows/`.

### ci.yml (Main Pipeline)

Triggers: push to `main`, `develop`, `release/**`; PRs to `main`, `develop`.

Jobs:

1. **api-lint-test** — Vitest with coverage
2. **api-build** — TypeScript compilation check
3. **web-lint-test** — Jest with coverage
4. **web-build** — Angular production build
5. **e2e** — Playwright E2E tests (requires PostgreSQL service)
6. **docker-build** — Image build verification

### deploy-dev.yml

Triggers on push to `develop`. Builds Docker images, pushes to GHCR, deploys via SSH.

### deploy-qa.yml

Triggers on push to `release/**`. Includes smoke tests before deployment.

### deploy-prod.yml

Triggers on version tags (`v*`). Requires `DEPLOY` environment confirmation. Includes health checks and creates a GitHub Release.

### backup-verify.yml

Scheduled database backup verification.

## GitHub Actions Secrets

### Dev Environment

```text
DEV_HOST, DEV_USER, DEV_SSH_KEY
DEV_POSTGRES_USER, DEV_POSTGRES_PASSWORD, DEV_POSTGRES_DB
DEV_JWT_SECRET, DEV_S3_ACCESS_KEY, DEV_S3_SECRET_KEY
```

### QA Environment

```text
QA_HOST, QA_USER, QA_SSH_KEY
QA_POSTGRES_*, QA_JWT_SECRET, QA_S3_*
QA_STRIPE_SECRET_KEY, QA_STRIPE_WEBHOOK_SECRET
```

### Production Environment

```text
PROD_HOST, PROD_USER, PROD_SSH_KEY
PROD_POSTGRES_*, PROD_JWT_SECRET, PROD_S3_*
PROD_STRIPE_SECRET_KEY, PROD_STRIPE_WEBHOOK_SECRET
```

### GitHub Environments (vars)

```text
DEV_URL, DEV_API_URL
QA_URL, QA_API_URL
PROD_URL, PROD_API_URL
```

## PgBouncer Configuration

The connection pooler runs in transaction mode:

- Default pool size: 20
- Max client connections: 100
- Pool mode: transaction

Application connects via PgBouncer on port 5432; PgBouncer connects to PostgreSQL on port 5433.

## Nginx Configuration

The web Dockerfile includes `nginx.conf` with:

- SPA fallback (`try_files $uri /index.html`)
- API reverse proxy (`/api/ -> http://api:3333/api/`)
- Security headers (X-Frame-Options, X-Content-Type-Options, CSP)
- Gzip compression for text assets
- 1-year cache for hashed static assets

## Health Checks

- API: `GET /health` returns `{ status: "ok", uptime, db: "connected" }`
- Docker: `HEALTHCHECK` instruction on API container
- CI: deployment pipelines verify health endpoint before marking as successful

[Back to Home](.)
