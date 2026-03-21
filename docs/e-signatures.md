---
layout: default
title: E-Signatures
---

# E-Signature Integration

ContractCanvas supports electronic signatures via DocuSign and HelloSign through a unified provider abstraction.

## Architecture

```text
apps/api/src/
├── services/signature-provider.ts   # Provider interface + implementations
├── routes/signatures.ts             # REST endpoints + webhook handler
```

### Provider Interface

```typescript
interface SignatureProvider {
  readonly name: string;
  createEnvelope(req: CreateEnvelopeRequest): Promise<CreateEnvelopeResult>;
  voidEnvelope(providerId: string, reason: string): Promise<void>;
  getStatus(providerId: string): Promise<EnvelopeStatus>;
  verifyWebhook(payload: string, signature: string): boolean;
}
```

### Implementations

| Provider | Class | Env Vars | Fallback |
|----------|-------|----------|----------|
| DocuSign | `DocuSignProvider` | `DOCUSIGN_BASE_URL`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_ACCESS_TOKEN` | StubProvider |
| HelloSign | `HelloSignProvider` | `HELLOSIGN_API_KEY` | StubProvider |
| Stub | `StubProvider` | None | N/A (dev/test) |

If the required env vars are missing, the system automatically falls back to `StubProvider` which logs operations but doesn't make real API calls.

## Envelope Lifecycle

```text
CREATED → SENT → VIEWED → SIGNED → COMPLETED
                                  ↘ DECLINED
                       ↘ VOIDED
```

Status transitions are driven by webhook callbacks from the e-signature provider.

## API Endpoints

### Create Envelope

```text
POST /api/signatures
```

```json
{
  "contractId": "<cuid>",
  "provider": "docusign",
  "recipients": [
    { "email": "signer@example.com", "name": "John Doe", "role": "signer" }
  ],
  "message": "Please review and sign this NDA."
}
```

Creates an envelope via the selected provider and stores the tracking record.

### Void Envelope

```text
POST /api/signatures/:id/void
```

```json
{ "reason": "Contract terms changed" }
```

Voids a pending envelope. Cannot void completed, already voided, or declined envelopes.

### Resend Envelope

```text
POST /api/signatures/:id/resend
```

Creates a new envelope with the same recipients through the provider. Updates the provider ID on the existing record.

### Webhook Callback

```text
POST /api/signatures/webhook/:provider
```

Unauthenticated endpoint called by DocuSign/HelloSign when envelope status changes. In production, webhook signature verification is enforced via HMAC-SHA256.

**DocuSign webhook payload:**

```json
{
  "event": "completed",
  "data": { "envelopeId": "..." }
}
```

**HelloSign webhook payload:**

```json
{
  "event": { "event_type": "signature_request_signed" },
  "signature_request": { "signature_request_id": "..." }
}
```

## Webhook Signature Verification

| Provider | Header | Algorithm |
|----------|--------|-----------|
| DocuSign | `X-DocuSign-Signature-1` | HMAC-SHA256 (base64) |
| HelloSign | `X-HelloSign-Signature` | HMAC-SHA256 (hex) |

Set the corresponding env var for verification:
- `DOCUSIGN_WEBHOOK_SECRET`
- `HELLOSIGN_WEBHOOK_SECRET`

## Database Model

```prisma
model SignatureEnvelope {
  id             String          @id @default(cuid())
  organizationId String
  contractId     String
  provider       String          // "docusign" or "hellosign"
  providerId     String @unique  // ID from the e-sign service
  status         SignatureStatus @default(CREATED)
  recipients     Json?           // Array of { email, name, role, status }
  auditTrailUrl  String?
  metadata       Json?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

## Adding a New Provider

1. Create a class implementing `SignatureProvider` in `signature-provider.ts`
2. Add the provider name to the `buildProvider()` switch
3. Add the provider name to the Zod enum in `signatures.ts`
4. Add webhook payload parsing in the webhook handler
5. Document required env vars

[Back to Home](.)
