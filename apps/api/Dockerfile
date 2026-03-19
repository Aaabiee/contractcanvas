# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=apps/api --ignore-scripts

COPY apps/api/ ./apps/api/
COPY scripts/ ./scripts/

WORKDIR /app/apps/api

RUN npx prisma generate --schema prisma/schema.prisma
RUN npm run build:ci

# ---- Stage 2: Production ----
FROM node:20-alpine AS runner

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=apps/api --omit=dev --ignore-scripts

COPY --from=builder /app/apps/api/dist          ./apps/api/dist
COPY --from=builder /app/apps/api/prisma        ./apps/api/prisma
COPY --from=builder /app/node_modules/.prisma   ./node_modules/.prisma

USER appuser

ENV NODE_ENV=production
ENV PORT=3333

EXPOSE 3333

CMD ["node", "apps/api/dist/server.js"]
