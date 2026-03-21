# ContractCanvas Operations Runbook

## Recovery Objectives

| Metric | Target  |
| ------ | ------- |
| RTO    | 4 hours |
| RPO    | 1 hour  |

---

## Database Backups

### Schedule

Daily backups run at **02:00 UTC** via `infra/scripts/backup.ts`. Backups are stored at:

```text
s3://<BACKUP_BUCKET>/backups/daily/contractcanvas-YYYYMMDD.sql.gz
```

### S3 Lifecycle Policy (apply manually in AWS console)

- Daily backups: retain **30 days**
- Weekly backups (Mondays): retain **1 year**

Apply via CLI:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket <BACKUP_BUCKET> \
  --lifecycle-configuration file://infra/s3-lifecycle.json
```

### Restore Procedure

1. Download the target backup:

   ```bash
   aws s3 cp s3://<BACKUP_BUCKET>/backups/daily/contractcanvas-YYYYMMDD.sql.gz /tmp/restore.sql.gz
   ```

2. Create a restore target (do **not** restore over production directly):

   ```bash
   createdb contractcanvas_restore
   gunzip -c /tmp/restore.sql.gz | psql -U <PG_USER> -d contractcanvas_restore
   ```

3. Verify integrity:

   ```bash
   DATABASE_URL=postgresql://<PG_USER>:<PG_PASS>@localhost/contractcanvas_restore \
     npx prisma migrate status --schema=apps/api/prisma/schema.prisma
   ```

4. If the restore looks good, promote by renaming:

   ```bash
   psql -c "ALTER DATABASE contractcanvas RENAME TO contractcanvas_old;"
   psql -c "ALTER DATABASE contractcanvas_restore RENAME TO contractcanvas;"
   ```

5. Restart the API service.

---

## Secret Rotation

### JWT_SECRET Rotation

Rotating `JWT_SECRET` **immediately invalidates all active sessions** (mass logout).

Steps:

1. Schedule a **maintenance window** (recommended off-peak, e.g. 02:00–03:00 UTC).
2. Generate a new secret: `openssl rand -base64 64`
3. Update the secret in your secrets manager (AWS Secrets Manager / GitHub Secrets).
4. Redeploy the API with the new secret.
5. Optionally call `revokeAllUserSessions()` for all users via a migration script if you want a clean cut.

### STRIPE_SECRET_KEY Rotation

1. Create new restricted key in Stripe dashboard.
2. Update env var.
3. Redeploy API.
4. Revoke old key in Stripe dashboard.

---

## Incident Response

### Service Degraded (5xx errors spiking)

1. Check Sentry for error details.
2. Check API logs: `docker logs contractcanvas-api --tail=200`
3. Check DB health: `docker exec contractcanvas-postgres pg_isready`
4. Check PgBouncer: `docker logs contractcanvas-pgbouncer --tail=50`
5. Check Redis: `docker exec contractcanvas-redis redis-cli ping`

### Database Connection Exhaustion

Symptom: `too many connections` errors in logs.

1. Check PgBouncer stats:

   ```bash
   docker exec contractcanvas-pgbouncer psql -h localhost -U pgbouncer pgbouncer -c "SHOW POOLS;"
   ```

2. Increase `MAX_CLIENT_CONN` in docker-compose if sustained load.
3. Check for connection leaks (long-running transactions).

### Payment Webhook Failures

1. Check Stripe dashboard → Developers → Webhooks → recent deliveries.
2. Ensure `STRIPE_WEBHOOK_SECRET` matches the current endpoint secret.
3. Check that `/api/billing/webhooks/stripe` returns 200 for test events.
4. Use `stripe listen --forward-to localhost:3333/api/billing/webhooks/stripe` for local debugging.

---

## Scheduled Maintenance

| Task                    | Frequency | Tool                                  |
| ----------------------- | --------- | ------------------------------------- |
| Database backup         | Daily     | `infra/scripts/backup.ts`             |
| Backup verification     | Weekly    | `.github/workflows/backup-verify.yml` |
| Expired session cleanup | Daily     | BullMQ cleanupQueue                   |
| Retention policy sweep  | Weekly    | BullMQ cleanupQueue                   |

---

## Scaling

### Horizontal API Scaling

The API is stateless except for SSE connections (`/api/events/stream`). For multi-instance deployments:

1. Enable Redis Pub/Sub bridge for SSE (see `routes/events.ts` — Redis bridge is gated on `REDIS_URL`).
2. Ensure `DATABASE_URL` points to PgBouncer, not Postgres directly.
3. Use a load balancer with sticky sessions only for SSE endpoints (`/api/events/stream`).

### Managed Postgres (recommended for production)

For production, replace self-hosted Postgres with:

- **AWS RDS PostgreSQL** (includes automated PITR, Multi-AZ)
- **Supabase** (includes PITR, connection pooling via Supavisor)

Simply update `DATABASE_URL` — no code changes required.

---

## CI/CD Environment Secrets

Each environment (dev, qa, prod) should have its own namespaced secrets. Do **not** share secrets across environments.

### GitHub Secrets Setup

1. Go to repo Settings > Environments > create `dev`, `qa`, `prod`
2. Add these secrets per environment:

```text
{ENV}_HOST, {ENV}_USER, {ENV}_SSH_KEY
{ENV}_POSTGRES_USER, {ENV}_POSTGRES_PASSWORD, {ENV}_POSTGRES_DB
{ENV}_JWT_SECRET, {ENV}_S3_ACCESS_KEY, {ENV}_S3_SECRET_KEY
{ENV}_STRIPE_SECRET_KEY, {ENV}_STRIPE_WEBHOOK_SECRET (qa/prod only)
SENTRY_DSN (same across envs, tagged by NODE_ENV)
```

1. Add environment variables (not secrets):

```text
{ENV}_URL, {ENV}_API_URL
```

### Sentry Setup

1. Create a Sentry project at sentry.io
2. Copy the DSN and add as `SENTRY_DSN` in GitHub Secrets
3. Configure alert rules in Sentry dashboard:
   - Alert on `unhandled_rejection` events
   - Alert when error count > 10 in 5 minutes
   - Route alerts to PagerDuty/Slack/email

### Stripe Dashboard Setup

1. Create products and prices at dashboard.stripe.com/products:
   - Starter: $29/mo (`STRIPE_PRICE_STARTER`)
   - Professional: $99/mo (`STRIPE_PRICE_PROFESSIONAL`)
   - Enterprise: custom pricing
2. Configure Customer Portal at dashboard.stripe.com/settings/billing/portal:
   - Enable plan switching
   - Enable cancellation
   - Enable payment method update
   - Enable invoice history
3. Set webhook endpoint to `{API_URL}/api/billing/webhook`
4. Subscribe to events: `customer.subscription.*`, `invoice.*`

### WAL Archiving (PostgreSQL)

For point-in-time recovery, configure WAL archiving:

```text
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://BACKUP_BUCKET/wal/%f'
```

Set in `postgresql.conf` or via environment variables on the container.

### S3 Lifecycle Policy

Apply the lifecycle policy for backup rotation:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket <BACKUP_BUCKET> \
  --lifecycle-configuration file://infra/s3-lifecycle.json
```

### Load Testing

Before production launch, run a load test with 50 concurrent users:

1. Use a tool like k6, Artillery, or Locust
2. Target the health endpoint, auth flow, and CRUD operations
3. Monitor PgBouncer pool stats for connection exhaustion
4. Verify response times under load (p95 < 500ms target)

### Log Transport

Set `LOG_TRANSPORT` env var to route structured logs:

| Value        | Destination    | Required Env Vars                    |
| ------------ | -------------- | ------------------------------------ |
| (unset)      | JSON stdout    | none                                 |
| `datadog`    | Datadog        | `DD_API_KEY`                         |
| `cloudwatch` | AWS CloudWatch | `CW_LOG_GROUP`, `AWS_DEFAULT_REGION` |
| `loki`       | Grafana Loki   | `LOKI_URL`                           |

Install the corresponding npm package before use (e.g., `npm i pino-datadog-transport`).
