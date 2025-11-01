# ContractCanvas

A modern, multi-tenant contract and matter management platform.
Monorepo with a Node/Express API, an Angular web app, PostgreSQL (via Docker), S3-compatible storage (MinIO), Stripe billing, and Prisma ORM.

> The **API** mounts routes under `/api/*`. The **web** dev server proxies `/api` → `http://localhost:3333`.

---

## ✨ Features

* **Organizations & membership** (owner/admin/member)
* **Users & roles** (Admin, Lawyer, Paralegal, Client)
* **Matters & contracts** with versioning and tags
* **Document storage** (upload, download via presigned URLs)
* **E-sign envelopes** (provider-agnostic model)
* **Reminders, tasks, notifications, audit logs**
* **Billing** scaffolding (Stripe webhooks)
* **JWT auth** with `/register`, `/login`, `/me` endpoints
* **Prisma** schema + migrations, Prisma Studio
* **Local dev infra** via Docker Compose

---

## 🗂️ Repository Layout

```text
contractcanvas/
├─ apps/
│  ├─ api/                # Express + Prisma API (TypeScript)
│  │  ├─ prisma/          # Prisma schema & generated client env
│  │  └─ src/
│  │     ├─ routes/       # auth, documents, matters, contracts, etc.
│  │     ├─ middleware/   # JWT protect middleware
│  │     ├─ prisma.ts     # Prisma client singleton
│  │     └─ server.ts     # Express bootstrap
│  └─ web/                # Angular app (Material UI, Auth, etc.)
│     └─ src/
├─ infra/                 # Docker Compose and .env for local infra
├─ scripts/
│  └─ config-to-env.mjs   # Generates env files from config.json
├─ config.json            # Centralized app/db/s3/stripe/jwt config
├─ package.json           # Root scripts (prisma, up/down, dev)
└─ README.md
```

---

## 🛠️ Tech Stack

* **API:** Node, Express, TypeScript, Prisma, Zod, Multer, JWT
* **Data:** PostgreSQL (Docker), S3/MinIO (Docker)
* **Web:** Angular + Angular Material
* **Billing:** Stripe SDK + webhooks (scaffold)
* **Dev tooling:** Docker Compose, tsx, Prisma Studio

---

## ✅ Prerequisites

* **Node.js** 20+ (LTS recommended)
* **Docker** & **Docker Compose**
* **npm** (root uses npm workspaces)

---

## ⚙️ Configuration

All local configuration derives from `config.json`. Example:

```json
{
  "app": { "env": "development", "port": 3333 },
  "db": {
    "user": "contractcanvas",
    "password": "********",
    "name": "contractcanvas_db",
    "port": 5432,
    "container_name": "contractcanvas-postgres"
  },
  "s3": {
    "endpoint": "http://localhost:9000",
    "region": "us-east-1",
    "bucket": "contractcanvas",
    "accessKey": "********",
    "secretKey": "********",
    "forcePathStyle": true
  },
  "stripe": {
    "secretKey": "sk_test_...",
    "webhookSecret": "whsec_..."
  },
  "jwt": { "secret": "a-strong-secret" }
}
```

Generate env files:

```bash
npm run config:env
```

This writes:

* `apps/api/prisma/.env` with `DATABASE_URL` (for Prisma)
* `infra/.env` (for Docker Compose)

> **Important:** Do **not** define `DATABASE_URL` in the repo root `.env`. Prisma will complain about conflicting env sources. Keep it in `apps/api/prisma/.env` only.

---

## ▶️ Quick Start (Local Development)

1. **Start infra (Postgres, MinIO, etc.)**

   ```bash
   npm run up
   ```

2. **Generate Prisma client & apply schema**

   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   # or for a dev-only sync:
   # npm run prisma:push
   ```

3. **Run both API & Web**

   ```bash
   npm run dev
   ```

   * API: [http://localhost:3333](http://localhost:3333)
   * Web: [http://localhost:4200](http://localhost:4200)

4. **Health checks**

   ```bash
   curl -i http://localhost:3333/health
   # via web proxy:
   curl -i http://localhost:4200/api/health
   ```

---

## 🔐 Auth Flow

### Register

Creates a user and either **creates** an organization or **joins** an existing one.
Body validation via Zod; password hashing via bcrypt.

### Create a new org

```bash
curl -i -X POST http://localhost:4200/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email":"a@b.com",
    "password":"Password1!",
    "confirmPassword":"Password1!",
    "name":{"firstName":"A","lastName":"B"},
    "role":"CLIENT",
    "orgMode":"create",
    "organizationName":"ACME",
    "organizationSlug":"acme",
    "acceptTerms":true
  }'
```

### Join an existing org

```bash
curl -i -X POST http://localhost:4200/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email":"member@acme.com",
    "password":"Password1!",
    "confirmPassword":"Password1!",
    "name":{"firstName":"M","lastName":"E"},
    "role":"CLIENT",
    "orgMode":"join",
    "organizationSlug":"acme"
  }'
```

Response (201): `{ "message": "...", "user": {...}, "organization": {...}, "redirectTo": "/login" }`
If `?autoLogin=1` is used, the response also includes `{ "token": "..." }`.

### Login

```bash
curl -s -X POST http://localhost:4200/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@b.com","password":"Password1!"}'
# => { "token": "..." }
```

### Me (protected)

```bash
curl -s http://localhost:4200/api/auth/me \
  -H "Authorization: Bearer <token>"
```

---

## 📄 Documents API (sample)

### Upload a file

```bash
curl -i -X POST http://localhost:3333/api/documents/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/file.pdf" \
  -F "matterId=<cuid>" \
  -F "organizationId=<cuid>" \
  -F "kind=UPLOADED"
```

### List by matter

```bash
curl -s "http://localhost:3333/api/documents?matterId=<cuid>" \
  -H "Authorization: Bearer <token>"
```

### Download (presigned URL)

```bash
curl -s http://localhost:3333/api/documents/<id>/download \
  -H "Authorization: Bearer <token>"
```

### Soft delete

```bash
curl -i -X DELETE http://localhost:3333/api/documents/<id> \
  -H "Authorization: Bearer <token>"
```

---

## 🧪 Prisma & DB

* Prisma Studio:

  ```bash
  npm run prisma:studio
  ```

* Reset DB volumes (⚠️ deletes data):

  ```bash
  npm run down     # uses `docker compose down -v --remove-orphans`
  npm run up
  npm run prisma:migrate
  ```

---

## 🧭 Angular Web App Notes

* The web dev server proxies `/api` to the API. Ensure `proxy.conf.json` is wired in `angular.json`:

  ```json
  {
    "/api": {
      "target": "http://localhost:3333",
      "secure": false,
      "changeOrigin": true
    }
  }
  ```

* Registration page supports Material controls, password toggle, and time-of-day themed styles.

* `AuthService` stores the token and calls `/me` to hydrate the current user signal.

---

## 🧰 Scripts (root)

```bash
# Generate env files from config.json
npm run config:env

# Prisma
npm run prisma:generate
npm run prisma:migrate
npm run prisma:push
npm run prisma:studio

# Infra
npm run up
npm run down       # remove volumes & orphans (data loss)
npm run down:keep  # keep volumes

# Dev
npm run dev        # api + web
npm run dev:api
npm run dev:web
```

---

## 🐛 Troubleshooting

* **404 on `/api/...` via port 4200:** The web proxy isn’t configured. Hit the API directly on `http://localhost:3333`, or fix `proxy.conf.json` and restart `npm run dev:web`.
* **Prisma error `P2021` (table not found):** Run `npm run prisma:migrate`.
* **Prisma env conflict (DATABASE_URL defined twice):** Ensure the root `.env` does **not** define `DATABASE_URL`. Keep it in `apps/api/prisma/.env` (generated by `npm run config:env`).
* **Type errors around `multer.single('file')`:** We pin compatible `@types/*` versions and cast the middleware once as `RequestHandler`. Reinstall after cleaning:

  ```bash
  rm -rf node_modules apps/api/node_modules apps/web/node_modules package-lock.json
  npm install
  ```

---

## 🔒 Security

* Do not commit real secrets. `config.json` is for local dev; in production set real secrets via environment variables (e.g. `JWT_SECRET`, Stripe, S3).
* JWT signing secret **must** be strong and non-default in production.

---

## 📦 Production (outline)

* Build API: `npm run -w apps/api build` → `apps/api/dist`
* Build Web: `npm run -w apps/web build` → static assets you can serve behind a reverse proxy
* Provide production-grade env (DB, S3, Stripe, JWT) and run API behind HTTPS
* Add CORS restrictions as needed in `apps/api/src/server.ts`

---

## 🤝 Contributing

Issues and PRs are welcome. Please keep commits scoped and include tests or manual steps to verify.

---

## 📝 License

MIT (or your preferred license) 🚀

---
