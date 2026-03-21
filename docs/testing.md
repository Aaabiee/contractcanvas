---
title: Testing
nav_order: 9
---

# Testing Strategy

ContractCanvas uses three layers of testing: unit, integration, and E2E.

## API Tests (Vitest)

**Location:** `apps/api/src/**/__tests__/`

### Unit Tests

Route handlers are tested with mocked Prisma client and supertest:

```bash
cd apps/api && npm test                      # all tests
cd apps/api && npx vitest run src/routes/__tests__/auth.test.ts  # specific file
cd apps/api && npm run test:coverage         # with coverage
```

**Coverage:** 32 test files covering all 23 route modules, middleware, and library utilities.

### Integration Tests

Located in `apps/api/src/__tests__/integration/`. Use TestContainers to spin up a real PostgreSQL instance:

```bash
cd apps/api && npx vitest run src/__tests__/integration/
```

Integration tests cover:

- Auth flows (register, login, refresh, logout, email verification, password reset)
- CRUD operations (matters, contracts, tasks, comments, clauses)
- Billing (invoices, payment intents)
- Search (full-text across matters/contracts/documents)
- SSE streaming
- Token blacklisting
- Security headers
- Share link creation and validation
- Reminder scheduling

**Test setup** (`setup.ts`):

- Spins up PostgreSQL via TestContainers
- Runs Prisma migrations
- Provides `seedAuth()` helper for authenticated test contexts
- Cleans up between test suites

## Frontend Tests (Jest)

**Location:** `apps/web/src/**/*.spec.ts`

```bash
cd apps/web && npx jest                     # all tests
cd apps/web && npx jest --watch             # watch mode
cd apps/web && npx jest --coverage          # with coverage
```

**Coverage:** 44 spec files, 408 tests covering:

- All page components (dashboard, matters, contracts, tasks, billing, etc.)
- All services (auth, contract, matter, task, notification, etc.)
- HTTP interceptors (JWT, error)
- Custom pipes (safeHtml)
- Integration tests (admin, matter-list, tasks)

### Component Testing Pattern

```typescript
describe('TasksComponent', () => {
  let component: TasksComponent;
  let fixture: ComponentFixture<TasksComponent>;
  let taskService: jest.Mocked<TaskService>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TasksComponent],
      providers: [
        { provide: TaskService, useValue: { getTasks: jest.fn().mockReturnValue(of([])) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TasksComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
```

## E2E Tests (Playwright)

**Location:** `e2e/tests/`

```bash
npm run test:e2e          # headless
npm run test:e2e:ui       # interactive UI mode
```

**Configuration:** `e2e/playwright.config.ts`

- Browser: Chromium (headless)
- Auto-starts API and Web servers (skipped if already running)
- Retries: 2 in CI, 0 locally
- Screenshots on failure, trace on first retry

### Test Suites

| File                 | Tests | Description                                                |
| -------------------- | ----- | ---------------------------------------------------------- |
| `auth.spec.ts`       | 6     | Login/register page load, validation, auth redirect        |
| `health.spec.ts`     | 4     | API health, 401 on protected routes, rate limiter          |
| `navigation.spec.ts` | 7     | Authenticated navigation, dark mode, search, logout        |
| `security.spec.ts`   | 5     | Security headers, CORS, anti-enumeration, protected routes |

### Running in CI

The GitHub Actions `ci.yml` workflow includes an `e2e` job that:

1. Starts a PostgreSQL service container
2. Pushes the Prisma schema
3. Installs Playwright Chromium
4. Runs all E2E tests
5. Uploads Playwright report as artifact on failure

## Test Commands Summary

| Command                                | Scope                  | Runner     |
| -------------------------------------- | ---------------------- | ---------- |
| `cd apps/api && npm test`              | API unit + integration | Vitest     |
| `cd apps/api && npm run test:coverage` | API with coverage      | Vitest     |
| `cd apps/web && npx jest`              | Frontend all           | Jest       |
| `npm run test:e2e`                     | E2E all                | Playwright |
| `npm run test:e2e:ui`                  | E2E interactive        | Playwright |

[Back to Home](.)
