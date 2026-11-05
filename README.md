# Byte Bun Tech website

Marketing website for Byte Bun Tech: a React landing page with a lead form that saves enquiries to SQL Server.

| Part | Stack |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, JavaScript, Redux Toolkit (state), React Hook Form + yup (forms and validation), Lenis (smooth scrolling), axios (API calls) |
| Backend | Node.js, Express 5, Prisma ORM (SQL Server adapter), yup validation, helmet |
| Database | SQL Server 2022 (Developer edition locally) |
| Runtime | Docker Compose |

## Run it

Requires Docker Desktop. First-time Windows setup (including keeping Docker data on drive D:) is in [docs/SETUP.md](docs/SETUP.md).

```
docker compose up --build
```

The first start takes a few minutes (images download, SQL Server initializes). When the logs show `API listening on port 4000`, open:

| URL | What |
|---|---|
| http://localhost:5173 | Website (hot reload) |
| http://localhost:5173/api/health | API health, through the dev proxy |
| http://localhost:4000/api/health | API health, direct |
| `127.0.0.1,1433` | SQL Server for SSMS or the VS Code mssql extension (user `sa`, password from `.env`, trust server certificate). Use `127.0.0.1`, not `localhost`: `localhost` can reach a Windows SQL Server install instead, or try IPv6, which Docker does not listen on. |

A `.env` file is optional for local development; every value has a dev-only default. To change values, copy `.env.example` to `.env`.

## Common tasks

| Task | Command |
|---|---|
| Start everything | `npm run up` (same as `docker compose up --build`) |
| Stop | `npm run down` |
| Follow logs | `npm run logs` |
| Delete all local data and start the database fresh | `npm run reset-db` (**deletes every saved lead**) |
| Count saved leads | `docker compose exec db sh -c 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -d bytebun -Q "SELECT COUNT(*) FROM dbo.Leads"'` |
| Change the database schema | Edit `backend/prisma/schema.prisma`, then `docker compose exec api npm run db:migrate:new -- --name what_changed` |
| Edit copy, prices, links, FAQ | `frontend/src/content/site.js` (everything marked `PLACEHOLDER` needs a real value) |

The `npm run` scripts only wrap Docker. You don't need Node installed on your PC to run the app.

Editing files under `frontend/src` or `backend/src` reloads the running app automatically; no rebuild needed. Rebuild (`docker compose up --build`) only after changing a Dockerfile.

## How it fits together

```
browser ──► web (Vite :5173) ──/api proxy──► api (Express :4000) ──Prisma──► db (SQL Server :1433)
```

On startup the API waits for SQL Server (with retries), creates the `bytebun` database if missing, applies Prisma migrations, then starts listening. The web container waits until the API reports healthy.

In production, one container runs Express, which serves both the built site and `/api`. See [docs/DEPLOY-VPS.md](docs/DEPLOY-VPS.md).

## Folder map

```
docker-compose.yml        local dev: web + api + db
docker-compose.prod.yml   VPS: app + db (database port not published)
Dockerfile                production image (builds React, Express serves it)
.env.example              every setting, with fake values
docs/
  SETUP.md                Windows + drive D: setup, troubleshooting
  DEPLOY-VPS.md           deploying to a VPS, backups, security checklist
  reference/              design reference (bytebun-landing-v8.html)
frontend/
  seo-plugin.js           injects meta tags, JSON-LD, robots.txt, sitemap.xml from site.js
  src/content/site.js     all editable copy and placeholders
  src/components/         page sections and the lead form
  src/lib/http/           reusable axios library: createHttpClient, ApiError (no app endpoints)
  src/api/                backend endpoints built on it: client.js (base URL), leads.js, health.js
  src/lib/leadSchema.js   yup schema for the lead form (mirrors the backend schema)
  src/store/              Redux Toolkit store and slices (leadFormSlice: dialog + submit state)
  src/hooks/              reusable hooks: dialog, scroll lock, smooth anchors, lead form logic
backend/
  prisma/schema.prisma    database schema
  prisma/migrations/      SQL migrations (applied on startup)
  prisma.config.js        Prisma CLI config (built from DB_* variables)
  src/server.js           Express app, security middleware, static serving in production
  src/config.js           reads and validates environment variables
  src/db/                 Prisma client, startup sequence
  src/routes/             health, leads
  src/middleware/         validation (yup), rate limits, errors, request log
  src/integrations/       optional n8n webhook
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | `200 {status:"ok", database:"reachable"}` or `503` if the database is down |
| `POST /api/leads` | Body: `name`, `email`, `phone?`, `businessName`, `businessType`, `message?`, `source?`. Returns `201 {ok:true, id}`. `400` with per-field messages on invalid input, `429` when rate limited (default 5 per 15 minutes per IP). |

When `N8N_WEBHOOK_URL` is set, each saved lead is also POSTed there (`{event:"lead.created", lead}`). A failing webhook never affects the visitor. This is the hook for n8n and GoHighLevel.
