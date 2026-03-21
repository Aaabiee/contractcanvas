---
title: Privacy Policy
sort: 1
---

# ContractCanvas Privacy Policy

**Last updated: [DATE]**

## 1. Data Controller

ContractCanvas ("we", "us") operates the ContractCanvas platform at [URL]. This policy describes how we collect, use, and protect your personal data in compliance with GDPR, CCPA, and applicable data protection laws.

## 2. Data We Collect

| Category           | Examples                                       | Basis                |
| ------------------ | ---------------------------------------------- | -------------------- |
| Account data       | Name, email, password hash, role               | Contract performance |
| Organization data  | Org name, slug, member list                    | Contract performance |
| Contract data      | Titles, versions, clause content, signatures   | Contract performance |
| Document data      | Uploaded files, metadata, storage keys         | Contract performance |
| Usage data         | IP address, user agent, timestamps, audit logs | Legitimate interest  |
| Payment data       | Stripe customer ID, subscription status        | Contract performance |
| Communication data | Email address for transactional emails         | Contract performance |

We do **not** collect or store credit card numbers — payment processing is handled entirely by Stripe.

## 3. Sub-Processors

| Sub-processor            | Purpose                           | Location            |
| ------------------------ | --------------------------------- | ------------------- |
| Stripe                   | Payment processing, subscriptions | USA                 |
| DocuSign                 | Electronic signatures             | USA                 |
| HelloSign (Dropbox Sign) | Electronic signatures             | USA                 |
| Amazon Web Services (S3) | Document storage                  | Configurable region |
| Postmark                 | Transactional email delivery      | USA                 |
| Sentry                   | Error tracking and monitoring     | USA                 |

## 4. How We Use Your Data

- Providing and maintaining the ContractCanvas platform
- Processing contracts, documents, and e-signatures
- Sending transactional emails (verification, password reset, notifications)
- Processing payments and managing subscriptions
- Monitoring platform health and security
- Generating anonymized analytics for platform improvement

## 5. Data Retention

- Active account data: retained while account is active
- Closed matter documents: retained per organization retention policy (default 7 years)
- Audit logs: retained indefinitely for compliance purposes
- Deleted accounts: personal data anonymized within 30 days, org documents preserved

## 6. Your Rights

Under GDPR and CCPA, you have the right to:

- **Access** — request a copy of your data (`POST /api/users/me/data-export`)
- **Rectification** — update your profile information
- **Erasure** — delete your account (`DELETE /api/users/me`)
- **Portability** — export your data in JSON format
- **Object** — opt out of non-essential data processing
- **Withdraw consent** — revoke consent at any time

To exercise these rights, contact [PRIVACY_EMAIL].

## 7. Security

We implement industry-standard security measures including:

- Encryption in transit (TLS 1.2+)
- Encryption at rest (AES-256 for stored documents)
- Bcrypt password hashing (cost factor 12)
- JWT token rotation with Redis blacklist
- Rate limiting on all endpoints
- Input validation and XSS prevention (DOMPurify)
- OWASP Top 10 mitigations

## 8. Cookies

We use a single httpOnly secure cookie for session management (refresh token). No third-party tracking cookies.

## 9. Changes to This Policy

We will notify users of material changes via email at least 30 days before they take effect.

## 10. Contact

For privacy inquiries: [PRIVACY_EMAIL]
