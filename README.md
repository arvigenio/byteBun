# Byte Bun Tech website

Marketing website for Byte Bun Tech: a React landing page with a lead form that saves enquiries to SQL Server.

| Part | Stack |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, JavaScript, Redux Toolkit (state), React Hook Form + yup (forms and validation), Lenis (smooth scrolling), axios (API calls) |
| Backend | Node.js, NestJS 12 (Express platform), TypeScript, Prisma ORM (SQL Server adapter), yup validation, helmet, pino logs |
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

Editing files under `frontend/src` or `backend/src` reloads the running app automatically; no rebuild needed (the API recompiles its TypeScript and restarts, which takes a few seconds). Rebuild (`docker compose up --build`) only after changing a Dockerfile.

## How it fits together

```
browser ──► web (Vite :5173) ──/api proxy──► api (NestJS :4000) ──Prisma──► db (SQL Server :1433)
```

On startup the API waits for SQL Server (with retries), creates the `bytebun` database if missing, applies Prisma migrations, then starts listening. The web container waits until the API reports healthy.

In production, one container runs the NestJS API, which serves both the built site and `/api`. See [docs/DEPLOY-VPS.md](docs/DEPLOY-VPS.md); after that, every push to `main` deploys automatically ([docs/DEPLOY-CD.md](docs/DEPLOY-CD.md)).

## Folder map

```
docker-compose.yml        local dev: web + api + db
docker-compose.prod.yml   VPS: app + db (database port not published)
Dockerfile                production image (builds React and the API; the API serves the site)
.env.example              every setting, with fake values
docs/
  SETUP.md                Windows + drive D: setup, troubleshooting
  DEPLOY-VPS.md           deploying to a VPS, backups, security checklist
  DEPLOY-CD.md            continuous deployment: GitHub Actions -> VPS on every push to main
.github/workflows/        deploy.yml (build check, then deploy over SSH)
scripts/deploy.sh         runs on the VPS: pull, rebuild, health check, automatic rollback
  reference/              design reference (bytebun-landing-v8.html)
frontend/
  seo-plugin.js           injects meta tags, JSON-LD, robots.txt, sitemap.xml from site.js
  src/content/site.js     all editable copy and placeholders
  src/pages/              HomePage (landing page) and GetStartedPage (lead form + booking calendar)
  src/components/         page sections, booking calendar, confetti
  src/lib/http/           reusable axios library: createHttpClient, ApiError (no app endpoints)
  src/api/                backend endpoints built on it: client.js (base URL), leads.js, booking.js, health.js
  src/lib/leadSchema.js   yup schema for the lead form (mirrors the backend schema)
  src/store/              Redux Toolkit store and slices (leadFormSlice: source, call times, submit state)
  src/hooks/              reusable hooks: scroll reveal, smooth anchors, lead form logic
  src/lib/router.js       tiny History API router (/ and /get-started)
backend/
  prisma/schema.prisma    database schema
  prisma/migrations/      SQL migrations (applied on startup)
  prisma.config.ts        Prisma CLI config (built from DB_* variables)
  src/main.ts             bootstrap: database startup, security middleware, /api prefix, listen
  src/app.module.ts       root NestJS module: wires the modules below, rate-limit guard, error filter
  src/config/             reads and validates environment variables (injectable as APP_CONFIG)
  src/database/           PrismaService, startup sequence (wait for SQL Server, create DB, migrate)
  src/leads/              POST /api/leads: controller, service, yup schema
  src/booking/            GET /api/booking/slots; availability.ts holds the call hours
  src/health/             GET /api/health
  src/common/             error format and filter, yup validation pipe, rate limits
  src/integrations/       optional n8n webhook
  src/web/                serves the built site in production (with the single-page-app fallback)
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | `200 {status:"ok", database:"reachable"}` or `503` if the database is down |
| `GET /api/booking/slots` | Free-call times, one per hour: `{availability, slots: [ISO UTC...], taken: [ISO UTC...]}`. Hours (6:30 PM to 5:00 AM Philippine time), open nights, notice, and how far ahead are set in `backend/src/booking/availability.ts`. `taken` lists booked times (shown disabled). |
| `POST /api/leads` | Body: `businessType` (`Other` needs `businessTypeOther`), `businessName?`, `goals` (at least one key; `other` needs `goalsOther`), `features?` (keys), `message?`, `firstName`, `lastName`, `meetingAt` (an open slot), `timeZone?`, `email`, `phone?`, `source?`. Goal and feature keys are listed in `backend/src/leads/lead-options.ts`. Saves the lead and its booking. Returns `201 {ok:true, id}`; `409` if the time was just booked by someone else. `400` with per-field messages on invalid input, `429` when rate limited (default 5 per 15 minutes per IP). |

When `N8N_WEBHOOK_URL` is set, each saved lead is also POSTed there (`{event:"lead.created", lead}`, with `firstName`, `lastName`, contact details, `goals` and `features` as readable labels, and `booking: {startsAt, timeZone}`). A failing webhook never affects the visitor. This is the hook for n8n and GoHighLevel.
