---
layout: default
title: Home
---

# ContractCanvas Developer Docs

ContractCanvas is a multi-tenant contract lifecycle management (CLM) platform for law firms and legal teams. Built with Express, Angular, PostgreSQL, and Prisma.

## Quick Navigation

| Section | Description |
|---------|-------------|
| [Getting Started](getting-started) | Setup, prerequisites, local dev |
| [Architecture](architecture) | System overview, data model, auth flow |
| [API Reference](api-reference) | All REST endpoints, request/response formats |
| [Frontend Guide](frontend-guide) | Angular app structure, services, routing |
| [Security](security) | Auth, OWASP mitigations, IDOR prevention |
| [Deployment](deployment) | Docker, CI/CD, environment variables |
| [E-Signatures](e-signatures) | DocuSign / HelloSign integration |
| [Testing](testing) | Unit, integration, E2E test strategy |
| [Contributing](contributing) | Code style, PR process, branch strategy |
| [Legal Templates](legal/) | Privacy Policy, Terms of Service, DPA |

## Tech Stack

- **Runtime**: Node.js 20+, TypeScript (strict), ESM modules
- **API**: Express 4, Zod validation, Pino structured logging
- **ORM / DB**: Prisma 5, PostgreSQL 16, PgBouncer connection pooling
- **Frontend**: Angular 20 (standalone components), Angular Material M3
- **Auth**: jose (HS256/RS256 JWT), httpOnly refresh cookies, Redis token blacklist
- **Storage**: AWS S3 / MinIO (pre-signed URLs)
- **Payments**: Stripe (subscriptions, invoices, webhooks)
- **Real-time**: Server-Sent Events (SSE)
- **Background jobs**: BullMQ (email, PDF, webhooks, cleanup)
- **E-signatures**: DocuSign / HelloSign provider abstraction
- **Error tracking**: Sentry (API + Angular)
- **CI/CD**: GitHub Actions, Docker multi-stage builds
- **E2E testing**: Playwright

## Repository Structure

```text
contractcanvas/
├── apps/
│   ├── api/          # Express backend (TypeScript, ESM)
│   └── web/          # Angular frontend (standalone components)
├── e2e/              # Playwright E2E tests
├── infra/            # Docker Compose, PgBouncer, scripts
├── packages/         # Shared TypeScript packages
├── docs/             # This documentation site
└── .github/          # CI/CD workflows
```
