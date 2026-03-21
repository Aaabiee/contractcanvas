---
title: Contributing
nav_order: 10
---

# Contributing

## Branch Strategy

| Branch              | Purpose                           |
| ------------------- | --------------------------------- |
| `main`              | Production-ready code             |
| `develop`           | Integration branch for features   |
| `feature/<name>`    | Feature branches (from `develop`) |
| `release/<version>` | Release candidates                |
| `hotfix/<name>`     | Production hotfixes (from `main`) |

## Development Workflow

1. Create a feature branch from `develop`
2. Implement changes with tests
3. Ensure all tests pass: `cd apps/api && npm test` and `cd apps/web && npx jest`
4. Ensure builds pass: `cd apps/api && npx tsc --noEmit` and `cd apps/web && npx ng build`
5. Open a PR to `develop`
6. CI runs automatically (lint, test, build, Docker verification)
7. After review and merge, changes flow to `main` via release branches

## Code Style

### TypeScript

- Strict mode enabled (`strict: true` in both API and Web tsconfigs)
- ESM modules in API (`"type": "module"`)
- Prefer `const` over `let`
- Use Zod for all request validation
- Use Prisma's generated types (no `any` for database entities)

### Angular

- Standalone components (no NgModules)
- Signals for reactive state
- OnPush change detection
- Angular Material M3 components

### API Routes

Every route handler must:

1. Extract `organizationId` from `req.user.organizationId`
2. Return 403 if no org context
3. Validate input with Zod
4. Include `organizationId` in all Prisma queries
5. Use `next(err)` for error propagation

### Testing

- API: Vitest with mocked Prisma for unit tests, TestContainers for integration
- Frontend: Jest with Angular TestBed
- E2E: Playwright with Chromium
- All new features must include tests

## Database Changes

1. Edit `apps/api/prisma/schema.prisma`
2. Run `npm run prisma:push` (development) or create a migration
3. Run `npm run prisma:generate` to update the client
4. Update seed script if needed (`apps/api/prisma/seed.ts`)

## Adding a New API Route

1. Create route file in `apps/api/src/routes/<name>.ts`
2. Export default router
3. Add export to `apps/api/src/routes/index.ts`
4. Mount with `protect` in `apps/api/src/server.ts`
5. Add unit tests in `apps/api/src/routes/__tests__/<name>.test.ts`
6. Add integration tests if needed

## Adding a New Frontend Page

1. Create component in `apps/web/src/app/pages/<name>/`
2. Add route in `apps/web/src/app/app.routes.ts`
3. Add navigation link in dashboard component if needed
4. Create corresponding service in `apps/web/src/app/services/`
5. Add spec files for component and service

## Environment Variables

Never commit `.env` files. Use `infra/.env.example` as a template.
Never hardcode secrets. Use environment variables for all sensitive values.

[Back to Home](.)
