# Contributing to ContractCanvas

## Development Setup

### 1. Clone the repository and install dependencies

```bash
git clone <repo-url> contractcanvas
cd contractcanvas
npm install
```

This installs dependencies for all workspaces (`apps/api`, `apps/web`, `packages/shared-ts`) via npm workspaces.

### 2. Create your environment file

```bash
cp infra/.env.example infra/.env
```

At minimum you must set `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `JWT_SECRET`, and the S3 / MinIO credentials. Leave `S3_ENDPOINT=http://localhost:9000` for local development.

### 3. Start the backing services

```bash
docker compose -f infra/docker-compose.yml up -d db minio redis
```

PostgreSQL is exposed on port 5433, MinIO S3 API on 9000, MinIO console on 9001, Redis on 6379.

### 4. Apply migrations and generate the Prisma client

```bash
cd apps/api
npm run prisma:migrate   # runs `prisma migrate dev`
npm run prisma:generate  # generates the Prisma client
cd ../..
```

### 5. Start the development servers

```bash
npm run dev   # starts API on :3333 and Angular on :4200 concurrently
```

The API auto-reloads via `tsx watch`; Angular uses the built-in `ng serve` live reload.

---

## Branch Naming

| Prefix   | When to use                                |
| -------- | ------------------------------------------ |
| `feat/`  | New feature or capability                  |
| `fix/`   | Bug fix                                    |
| `chore/` | Tooling, dependency updates, build changes |
| `docs/`  | Documentation only                         |

Examples: `feat/docusign-integration`, `fix/refresh-token-rotation`, `chore/bump-prisma-5`.

---

## Commit Messages

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional scope>): <short description>

[optional body]
```

Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`.

Examples:

```text
feat(auth): add POST /api/auth/change-password endpoint
fix(billing): handle invoice.payment_failed webhook event
chore: upgrade Prisma to 5.22
```

---

## Testing Requirements

### API unit and route tests

- Every new route must have tests in `apps/api/src/routes/__tests__/` or an integration test covering the same path.
- Run before every push:

```bash
cd apps/api && npm test
```

### API integration tests

- All new API routes must have integration tests in `apps/api/src/__tests__/integration/`.
- Integration tests use real PostgreSQL via `@testcontainers/postgresql` and a real Redis connection. Do not mock the database layer or Redis in integration tests.
- Run with:

```bash
cd apps/api && npm run test:integration
```

Docker must be running. Each test suite provisions its own isolated container — tests are safe to run in parallel across suites.

### Frontend unit tests

- New Angular components must have unit tests using Jest and Angular `TestBed`.
- Run with:

```bash
cd apps/web && npm test
```

---

## Code Style

- **TypeScript strict mode** is enabled for both `apps/api` and `apps/web`. Do not use `any` casts. If one is genuinely unavoidable, add a `// reason: <explanation>` comment on the same line.
- **No comments that narrate the code.** Code should be self-documenting. Comments are for non-obvious decisions, external constraints, or TODO items tracked in GitHub Issues.
- **No `console.log`** anywhere in `apps/api`. Use `logger` from `src/lib/logger.ts` (`logger.info`, `logger.warn`, `logger.error`). The logger emits structured JSON in production and pretty-prints in development.
- **Zod validation on all route inputs.** Parse `req.body`, `req.params`, and `req.query` through a Zod schema at the top of every handler. Never pass a raw `req.body` object directly to a Prisma write.
- **Explicit Prisma `select` on every query.** Never return a Prisma model's full row from an API response. Always use `select: { ... }` to enumerate the fields the client receives. In particular, `passwordHash`, `refreshToken` (hashed), `verifyToken`, `resetToken`, and any column named `*Secret` or `*Key` must never appear in a response payload.

---

## Security Checklist for New Routes

Apply this checklist to every new or modified route before opening a PR:

- [ ] **IDOR**: any resource fetched by ID is also verified against `req.user.organizationId` — a user from org A must not be able to read or mutate a resource belonging to org B
- [ ] **Auth**: route is protected by the `protect` middleware (or `optionalAuth` where intentionally public)
- [ ] **Validation**: all inputs (`body`, `params`, `query`) are validated with Zod before any database write
- [ ] **No shell injection**: user-controlled input is never passed to `child_process.exec`, `spawn`, or `eval`
- [ ] **No sensitive fields**: the Prisma `select` explicitly excludes `passwordHash`, token columns, and any secret or key fields
- [ ] **Audit log**: every mutating operation (CREATE, UPDATE, DELETE, status change) writes an `AuditLog` entry via `writeAuditLog()` from `src/lib/audit.ts`

---

## Adding a New API Route

1. **Create the route file** at `apps/api/src/routes/<resource>.ts`. Export a default Express `Router`.

2. **Define a Zod schema** for each request shape (`body`, `params`, `query`) at the top of the file.

3. **Write the handler** — parse inputs, check org ownership, call Prisma with an explicit `select`, write an audit log entry for mutating operations, return a typed response.

4. **Register the router** in `apps/api/src/server.ts`:

   ```typescript
   app.use('/api/<resource>', protect, resourceRouter);
   ```

5. **Export from the route index** in `apps/api/src/routes/index.ts`:

   ```typescript
   export { default as myResource } from './my-resource.js';
   ```

6. **Write tests** — a route-level unit test in `src/routes/__tests__/` mocking Prisma, and an integration test in `src/__tests__/integration/` against a real database.

---

## Database Migrations

**Creating a migration:**

```bash
cd apps/api
npm run prisma:migrate -- --name <descriptive-name>
```

This generates a SQL migration file in `prisma/migrations/` and applies it to the local database.

**Rules:**

- Migration names must be descriptive: `add-subscription-model`, `add-email-verification`, not `migration1`.
- Never edit a migration file after it has been committed. Create a new migration to fix it.
- Destructive migrations (column drops, type changes) must include a data migration step and be explicitly called out in the PR description.
- After adding or modifying models, run `npm run prisma:generate` to regenerate the Prisma client before running tests.

**Applying migrations in CI / staging:**

```bash
npx prisma migrate deploy   # applies all pending migrations non-interactively
```

---

## Pull Request Process

1. **Open a PR against `main`** using the PR template in `.github/pull_request_template.md`.
2. **Require at least one review** from a team member before merging.
3. **All CI checks must pass**: TypeScript build, unit tests, integration tests, and lint. Do not merge a PR with a failing pipeline.
4. **Keep PRs focused.** One logical change per PR. If a refactor is needed to land a feature, split it into a separate PR first.
5. Reference the relevant GitHub Issue in the PR description (e.g., `Closes #42`).
