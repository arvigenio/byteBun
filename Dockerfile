# syntax=docker/dockerfile:1
# Production image: builds the React site and the NestJS API, then runs the API, which serves
# both the site and /api.
# Build:  docker compose -f docker-compose.prod.yml build

# ---- Stage 1: build the frontend ----
FROM node:22-alpine AS web-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Public site URL, used for canonical links, Open Graph tags, and the sitemap.
ARG SITE_URL=https://bytebuntech.com
ENV SITE_URL=${SITE_URL}
# Google Tag Manager container (GTM-XXXXXXX) for the public site; empty = no GTM. Baked into
# the bundle at build time, so changing it needs a rebuild (docker compose ... up -d --build).
ARG VITE_GTM_ID=
ENV VITE_GTM_ID=${VITE_GTM_ID}
RUN npm run build

# ---- Stage 2: build the API (TypeScript -> dist/), then keep production dependencies only ----
FROM node:22-alpine AS api-build
RUN apk add --no-cache openssl
WORKDIR /app/backend
# The schema and Prisma config must be present because `npm ci` runs `prisma generate` (postinstall).
COPY backend/package.json backend/package-lock.json backend/prisma.config.ts ./
COPY backend/prisma ./prisma
COPY backend/src/database/database-url.ts ./src/database/database-url.ts
RUN npm ci --no-audit --no-fund
COPY backend/tsconfig.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npm run build  && npm prune --omit=dev --no-audit --no-fund  && npx prisma generate

# ---- Stage 3: runtime ----
FROM node:22-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production     API_PORT=4000     CHECKPOINT_DISABLE=1
WORKDIR /app/backend
# Files stay owned by root (read-only for the app); the process runs as the unprivileged "node" user.
COPY --from=api-build /app/backend/node_modules ./node_modules
COPY --from=api-build /app/backend/dist ./dist
# Prisma CLI is a runtime dependency here: the app runs `prisma migrate deploy` on startup,
# which reads prisma.config.ts (and the connection-string helper it imports).
COPY backend/package.json backend/prisma.config.ts ./
COPY backend/prisma ./prisma
COPY backend/src/database/database-url.ts ./src/database/database-url.ts
COPY --from=web-build /build/frontend/dist /app/frontend/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5   CMD wget -q -O /dev/null "http://127.0.0.1:${API_PORT}/api/health" || exit 1
CMD ["node", "dist/main.js"]
