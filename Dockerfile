# syntax=docker/dockerfile:1
# Production image: builds the React site, then runs Express, which serves both the site and /api.
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
RUN npm run build

# ---- Stage 2: backend production dependencies only ----
FROM node:22-alpine AS api-deps
RUN apk add --no-cache openssl
WORKDIR /app/backend
# Prisma CLI is a runtime dependency here: the app runs `prisma migrate deploy` on startup.
# The schema must be present because `npm ci` runs `prisma generate` (postinstall).
COPY backend/package.json backend/package-lock.json backend/prisma.config.js ./
COPY backend/prisma ./prisma
COPY backend/src/db/url.js ./src/db/url.js
RUN npm ci --omit=dev --no-audit --no-fund

# ---- Stage 3: runtime ----
FROM node:22-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production \
    API_PORT=4000 \
    CHECKPOINT_DISABLE=1
WORKDIR /app/backend
# Files stay owned by root (read-only for the app); the process runs as the unprivileged "node" user.
COPY --from=api-deps /app/backend/node_modules ./node_modules
COPY backend/package.json backend/prisma.config.js ./
COPY backend/prisma ./prisma
COPY backend/src ./src
COPY --from=web-build /build/frontend/dist /app/frontend/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${API_PORT}/api/health" || exit 1
CMD ["node", "src/server.js"]
