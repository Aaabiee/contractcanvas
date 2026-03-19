# ---- Stage 1: Build Angular app ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/ ./packages/

RUN npm ci --workspace=apps/web --ignore-scripts

COPY apps/web/ ./apps/web/

WORKDIR /app/apps/web

ARG API_URL=http://localhost:3333
ENV API_URL=${API_URL}

RUN npm run build -- --configuration=production

# ---- Stage 2: Serve with nginx ----
FROM nginx:1.27-alpine AS runner

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist/web/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
