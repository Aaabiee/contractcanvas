---
title: API Reference
nav_order: 4
---

# API Reference

Base URL: `http://localhost:3333` (development)

All protected routes require `Authorization: Bearer <jwt>` or `x-api-key: <key>`.
Multi-org users send `X-Organization-Id: <orgId>` to select context.

## Authentication

| Method | Endpoint                        | Auth   | Description                             |
| ------ | ------------------------------- | ------ | --------------------------------------- |
| POST   | `/api/auth/register`            | None   | Create user + org                       |
| POST   | `/api/auth/login`               | None   | Get JWT + refresh cookie                |
| POST   | `/api/auth/refresh-token`       | Cookie | Rotate refresh token, get new JWT       |
| POST   | `/api/auth/logout`              | Bearer | Blacklist JWT, delete session           |
| GET    | `/api/auth/me`                  | Bearer | Current user from JWT claims            |
| POST   | `/api/auth/change-password`     | Bearer | Change password, revoke all sessions    |
| GET    | `/api/auth/verify-email?token=` | None   | Verify email address                    |
| POST   | `/api/auth/resend-verification` | None   | Resend verification email (8h cooldown) |
| POST   | `/api/auth/forgot-password`     | None   | Send password reset email               |
| POST   | `/api/auth/reset-password`      | None   | Reset password with token               |

### POST /api/auth/register

```json
{
  "email": "user@example.com",
  "password": "SecureP@ss1",
  "confirmPassword": "SecureP@ss1",
  "name": { "firstName": "Jane", "lastName": "Doe" },
  "role": "CLIENT",
  "orgMode": "create",
  "organizationName": "Acme Legal",
  "organizationSlug": "acme-legal",
  "acceptTerms": true
}
```

**Response (201):**

```json
{
  "message": "Registered successfully. Please verify your email.",
  "user": { "id": "...", "email": "...", "role": "CLIENT" },
  "organization": { "id": "...", "name": "Acme Legal", "slug": "acme-legal" }
}
```

### POST /api/auth/login

```json
{ "email": "user@example.com", "password": "SecureP@ss1" }
```

**Response (200):**

```json
{
  "token": "<jwt>",
  "user": { "id": "...", "email": "...", "firstName": "Jane", "role": "CLIENT", "emailVerified": true },
  "organizations": [{ "id": "...", "name": "Acme Legal", "slug": "acme-legal", "role": "OWNER" }]
}
```

## Matters

| Method | Endpoint           | Description               |
| ------ | ------------------ | ------------------------- |
| GET    | `/api/matters`     | List matters (paginated)  |
| GET    | `/api/matters/:id` | Matter detail with counts |
| POST   | `/api/matters`     | Create matter             |
| PATCH  | `/api/matters/:id` | Update matter             |
| DELETE | `/api/matters/:id` | Soft-delete matter        |

Query params: `status`, `limit` (default 50, max 100), `offset`.

## Contracts

| Method | Endpoint                          | Description                |
| ------ | --------------------------------- | -------------------------- |
| GET    | `/api/contracts`                  | List contracts (paginated) |
| GET    | `/api/contracts/:id`              | Contract detail            |
| POST   | `/api/contracts`                  | Create contract            |
| PATCH  | `/api/contracts/:id`              | Update contract            |
| DELETE | `/api/contracts/:id`              | Soft-delete contract       |
| GET    | `/api/contracts/:id/versions`     | List versions              |
| POST   | `/api/contracts/:id/versions`     | Create version             |
| POST   | `/api/contracts/:id/generate-pdf` | Generate PDF download      |

## Documents

| Method | Endpoint                      | Description               |
| ------ | ----------------------------- | ------------------------- |
| GET    | `/api/documents?matterId=`    | List documents for matter |
| GET    | `/api/documents/:id`          | Document metadata         |
| POST   | `/api/documents/upload`       | Upload file (multipart)   |
| GET    | `/api/documents/:id/download` | Get pre-signed S3 URL     |
| DELETE | `/api/documents/:id`          | Soft-delete document      |

Upload requires `emailVerified` and active subscription. Max file size: 50MB.
Allowed types: PDF, DOC/DOCX, XLS/XLSX, TXT, JPEG, PNG, GIF, WebP.

## Tasks

| Method | Endpoint         | Description                        |
| ------ | ---------------- | ---------------------------------- |
| GET    | `/api/tasks`     | List tasks (paginated, filterable) |
| POST   | `/api/tasks`     | Create task                        |
| PATCH  | `/api/tasks/:id` | Update task                        |
| DELETE | `/api/tasks/:id` | Delete task                        |

Query params: `status` (pending/completed/overdue), `matterId`, `assigneeId`, `limit`, `offset`.

## Comments

| Method | Endpoint                                  | Description    |
| ------ | ----------------------------------------- | -------------- |
| GET    | `/api/comments?resourceType=&resourceId=` | List comments  |
| POST   | `/api/comments`                           | Create comment |
| PATCH  | `/api/comments/:id`                       | Edit comment   |
| DELETE | `/api/comments/:id`                       | Delete comment |

Resource types: `contract`, `matter`.

## Notifications

| Method | Endpoint                      | Description                    |
| ------ | ----------------------------- | ------------------------------ |
| GET    | `/api/notifications`          | List notifications (paginated) |
| PATCH  | `/api/notifications/:id/read` | Mark as read                   |
| PATCH  | `/api/notifications/read-all` | Mark all as read               |

## E-Signatures

| Method | Endpoint                            | Description                        |
| ------ | ----------------------------------- | ---------------------------------- |
| GET    | `/api/signatures?contractId=`       | List envelopes                     |
| GET    | `/api/signatures/:id`               | Envelope detail                    |
| POST   | `/api/signatures`                   | Create envelope (send for signing) |
| POST   | `/api/signatures/:id/void`          | Void envelope                      |
| POST   | `/api/signatures/:id/resend`        | Resend envelope                    |
| POST   | `/api/signatures/webhook/:provider` | Provider callback (no auth)        |

### POST /api/signatures

```json
{
  "contractId": "<cuid>",
  "provider": "docusign",
  "recipients": [
    { "email": "signer@example.com", "name": "John Doe", "role": "signer" }
  ],
  "message": "Please review and sign this contract."
}
```

## Billing

| Method | Endpoint                | Description                           |
| ------ | ----------------------- | ------------------------------------- |
| POST   | `/api/billing/invoice`  | Create invoice (Stripe PaymentIntent) |
| GET    | `/api/billing/invoices` | List invoices                         |
| POST   | `/api/billing/webhook`  | Stripe webhook (raw body)             |

## Organizations

| Method | Endpoint                                | Description               |
| ------ | --------------------------------------- | ------------------------- |
| POST   | `/api/organizations`                    | Create organization       |
| GET    | `/api/organizations/me`                 | List user's organizations |
| GET    | `/api/organizations/:orgId/members`     | List members              |
| POST   | `/api/organizations/:orgId/members`     | Add member                |
| PATCH  | `/api/organizations/:orgId/members/:id` | Update member role        |
| DELETE | `/api/organizations/:orgId/members/:id` | Remove member             |

## Other Endpoints

| Method | Endpoint                         | Description                   |
| ------ | -------------------------------- | ----------------------------- |
| GET    | `/api/clauses`                   | Clause library (public + org) |
| GET    | `/api/search?q=`                 | Full-text search              |
| GET    | `/api/reminders`                 | List reminders                |
| GET    | `/api/share-links`               | List share links              |
| GET    | `/api/share/:token`              | Access shared resource        |
| GET    | `/api/analytics/overview`        | Org analytics                 |
| GET    | `/api/analytics/contract-trends` | Contract trend data           |
| GET    | `/api/events/stream`             | SSE notification stream       |
| GET    | `/health`                        | Health check                  |
| GET    | `/api/users/me`                  | User profile                  |
| PATCH  | `/api/users/me`                  | Update profile                |
| POST   | `/api/users/me/data-export`      | GDPR data export              |
| DELETE | `/api/users/me`                  | Account deletion              |

## Pagination

All list endpoints support `limit` (max 100) and `offset` query parameters. Response format:

```json
{
  "data": [...],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

## Error Format

```json
{
  "error": "error_code",
  "message": "Human-readable message",
  "details": {}
}
```

Common status codes: 400 (validation), 401 (unauthorized), 403 (forbidden/no org), 404 (not found), 409 (conflict), 429 (rate limited).

[Back to Home](.)
