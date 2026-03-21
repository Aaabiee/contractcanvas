---
layout: default
title: Frontend Guide
---

# Frontend Guide

The frontend is an Angular 20 application using standalone components and Angular Material M3.

## Directory Structure

```text
apps/web/src/app/
├── app.component.ts          # Root component (<router-outlet>)
├── app.config.ts             # Providers (router, HTTP, animations)
├── app.routes.ts             # Route definitions
├── components/
│   └── comments/             # Shared comments component
├── guards/                   # Route guards (auth, org)
├── interceptors/
│   ├── jwt.interceptor.ts    # Attaches Bearer token
│   └── error.interceptor.ts  # Global error handling, auto-logout on 401
├── pipes/
│   └── safe-html.pipe.ts     # DOMPurify sanitization for innerHTML
├── pages/                    # Feature pages (18 modules)
│   ├── dashboard/            # Layout shell + dashboard home (skeleton loading)
│   ├── login/                # Login page
│   ├── register/             # Registration with ToS checkbox
│   ├── onboarding/           # 5-step onboarding wizard
│   ├── matter-list/          # Matter listing
│   ├── matter-detail/        # Tabbed matter view
│   ├── contract-list/        # Contract listing
│   ├── contract-detail/      # Contract viewer
│   ├── tasks/                # Task management
│   ├── documents/            # Document management
│   ├── billing/              # Billing & subscriptions
│   ├── analytics/            # Charts & analytics
│   ├── admin/                # Admin panel with audit log tab
│   ├── organization-settings/# Members, Webhooks, API Keys, Retention tabs
│   ├── search/               # Search results
│   ├── verify-email/         # Email verification
│   ├── forgot-password/      # Password recovery
│   └── reset-password/       # Password reset
└── services/                 # 17 injectable services
    ├── audit-log.service.ts
    ├── webhook.service.ts
    ├── api-key.service.ts
```

## Key Services

### AuthService (`auth.service.ts`)

Manages JWT lifecycle:

- `login(email, password)` — stores JWT in memory (never localStorage), starts refresh timer
- `logout()` — calls API, clears token, navigates to `/login`
- `currentUser()` — signal with decoded user claims
- `isAuthenticated()` — computed signal for auth state
- Auto-refresh fires 60s before JWT expiry via RxJS timer

### NotificationService (`notification.service.ts`)

SSE-based real-time notifications:

- `startStream()` — opens EventSource to `/api/events/stream`
- `onNotification` callback — displays MatSnackBar toast
- `unreadCount` signal — reactive badge counter
- Auto-reconnect with native EventSource behavior

### ContractService, MatterService, TaskService

Standard CRUD services using `HttpClient`. All return `Observable<T>` and use the JWT interceptor for auth headers.

## Routing

Public routes (no auth required):
- `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`

Protected routes (wrapped in `authGuard`):
- `/dashboard` — layout shell with sidenav
  - `/dashboard` — home stats
  - `/matters`, `/matters/:id`
  - `/contracts`, `/contracts/:id`
  - `/tasks`, `/documents`, `/billing`, `/analytics`
  - `/admin`, `/settings/organization`, `/search`

## Dark Mode

Dark mode uses Angular Material M3 theme system:

1. `styles.scss` defines both light and dark themes using `mat.theme()`
2. `DashboardComponent` manages a `themeDark` signal persisted in `localStorage`
3. An `effect()` toggles `theme-dark` class on `<html>` element
4. A toolbar icon button toggles between `light_mode` and `dark_mode` icons

## Onboarding Wizard

New users are directed to `/onboarding` after first login. The 5-step Material Stepper wizard:

1. **Verify Email** — blocks advance until email is confirmed
2. **Organization** — confirms org setup
3. **Create Matter** — optional first matter creation
4. **Invite Team** — optional colleague invite
5. **Upload Document** — skip to dashboard

Progress is persisted to the database via `PATCH /api/users/me/onboarding`. Users can skip directly to the dashboard at any time.

## Organization Settings Tabs

The `/settings/organization` page has four tabs:

- **Members** — list, invite, remove members
- **Webhooks** — create/toggle/delete outbound webhook endpoints with event filtering and secret display
- **API Keys** — generate (raw key shown once), list, revoke API keys
- **Retention** — configure data retention period (days)

## HTTP Interceptors

**JWT Interceptor** — attaches `Authorization: Bearer <token>` to all API requests. Skips auth routes.

**Error Interceptor** — intercepts HTTP errors globally:
- 401: calls `AuthService.logout()`, redirects to `/login`
- 402: lazy-loads `UpgradeDialogComponent` showing usage bar and upgrade link
- 403: redirects to `/dashboard`
- 500: logs to console
- Network errors (status 0): logs to console

## XSS Prevention

User-generated HTML (comment bodies) passes through `DOMPurify` via the `SafeHtmlPipe`:

```html
<div [innerHTML]="comment.bodyMd | safeHtml"></div>
```

The pipe sanitizes all dangerous tags/attributes before Angular's `[innerHTML]` binding.

## Testing

Frontend tests use Jest with `@angular-builders/jest`:

```bash
cd apps/web && npx jest                    # all tests
cd apps/web && npx jest --watch            # watch mode
cd apps/web && npx jest --testPathPattern="dashboard"  # specific
```

39 spec files covering components, services, interceptors, and pipes.

[Back to Home](.)
