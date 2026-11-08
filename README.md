# Byte Bun Tech website

Marketing website for Byte Bun Tech: a React landing page with a lead form that saves enquiries to PostgreSQL.

| Part | Stack |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, JavaScript, Redux Toolkit (state), React Hook Form + yup (forms and validation), Lenis (smooth scrolling), axios (API calls) |
| Backend | Node.js, NestJS 12 (Express platform), TypeScript, Prisma ORM (PostgreSQL adapter), yup validation, helmet, pino logs |
| Database | PostgreSQL 17 |
| Runtime | Docker Compose |

## Run it

Requires Docker Desktop. First-time Windows setup (including keeping Docker data on drive D:) is in [docs/SETUP.md](docs/SETUP.md).

```
docker compose up --build
```

The first start takes a few minutes (images download, PostgreSQL initializes). When the logs show `API listening on port 4000`, open:

| URL | What |
|---|---|
| http://localhost:5173 | Website (hot reload) |
| http://localhost:5173/api/health | API health, through the dev proxy |
| http://localhost:4000/api/health | API health, direct |
| `127.0.0.1:5432` | PostgreSQL for psql, pgAdmin, DBeaver, or a VS Code PostgreSQL extension (database `bytebun`, user `bytebun`, password `ByteBun_Dev_Pass1` or `DB_PASSWORD` from `.env`, SSL off). Use `127.0.0.1`, not `localhost`: `localhost` can reach a Windows PostgreSQL install instead, or try IPv6, which Docker does not listen on. |

A `.env` file is optional for local development; every value has a dev-only default. To change values, copy `.env.example` to `.env`.

## Common tasks

| Task | Command |
|---|---|
| Start everything | `npm run up` (same as `docker compose up --build`) |
| Stop | `npm run down` |
| Follow logs | `npm run logs` |
| Delete all local data and start the database fresh | `npm run reset-db` (**deletes every saved lead**) |
| Count saved leads | `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT COUNT(*) FROM leads"'` |
| Open a SQL prompt | `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` |
| Change the database schema | Edit `backend/prisma/schema.prisma`, then `docker compose exec api npm run db:migrate:new -- --name what_changed` |
| Edit copy, prices, links, FAQ | `frontend/src/content/site.js` (everything marked `PLACEHOLDER` needs a real value) |

| Create or repair the two admin accounts | `docker compose exec api npm run seed:admins` |
| Reset a lost authenticator | `docker compose exec api npm run admin:reset-2fa -- name@bytebuntech.com` |
| Run the backend tests | `docker compose exec api npm test` |

The `npm run` scripts only wrap Docker. You don't need Node installed on your PC to run the app.

Editing files under `frontend/src` or `backend/src` reloads the running app automatically; no rebuild needed (the API recompiles its TypeScript and restarts, which takes a few seconds). Rebuild (`docker compose up --build`) only after changing a Dockerfile.

## Admin site

A private admin area for the two Byte Bun admins:

- **Leads:** search, filter by status, a details drawer, edit any detail, CSV export.
- **Bookings:** a month calendar or a list, with reschedule or cancel for any call.
- **Security:** active sessions, sign out devices, backup codes.

Everything updates **live** for every admin who has it open, with closable notifications for new leads and booking changes (see "Leads, bookings and live updates" below).

Sign-in is **passwordless and two-step**, with [Better Auth](https://www.better-auth.com) 1.7: an emailed code, then a code from an authenticator app. There is no sign-up and no password anywhere.

### Setup

1. Set the admin variables in `.env` (see `.env.example`, section "Admin sign-in"). Development works without any of them: the sign-in page is at http://localhost:5173/bb-admin-portal and emails, including the sign-in code, are printed in the API log (`docker compose logs -f api`) instead of sent.
2. Migrations, including the admin tables (`backend/prisma/migrations/0002_admin_auth`), are applied automatically when the API starts. To apply them by hand: `docker compose exec api npm run db:migrate:deploy`.
3. Create the admins (safe to run again at any time):

   ```
   docker compose exec api npm run seed:admins
   ```

   The script creates Josue Mapagdalita and Arvi Genio (listed in `backend/src/auth/admins.ts`) with `role = admin`, a verified email and no password. Production: `docker compose -f docker-compose.prod.yml exec app npm run seed:admins`.

### Signing in

1. Open the secret sign-in page (`LOGIN_PATH`, e.g. `https://bytebuntech.com/bb-portal-7k2q9x`). Bookmark it: nothing links to it, and `/login`, `/signin`, `/admin/login` and similar paths are a plain 404.
2. Enter your email. Admins get a 6-digit code from **Byte Bun Admin &lt;admin@bytebuntech.com&gt;**. It expires in 5 minutes and allows 3 wrong tries. "Resend code" unlocks after 60 seconds. Any other email gets exactly the same screen ("If that email is registered, we've sent a code") and nothing is sent.
3. Enter the email code. **This does not sign you in yet.**
4. Enter the 6-digit code from your authenticator app. Lost your phone? Choose "Use a backup code" (each works once).
5. **First sign-in:** instead of step 4, scan the QR code (or type the key), enter the first code, then save the 10 backup codes (copy or download). They are shown only once.

Sessions last 12 hours (refreshed hourly while in use). "Sign out" is in the top bar; the Security page signs out other devices.

**Every step is emailed to both admins** (`ALERT_EMAILS`), subject `[Byte Bun Security] ...`:

- codes requested
- unknown emails tried
- wrong or too many email codes
- email code correct, waiting for the authenticator
- wrong authenticator or backup codes
- successful sign-ins
- backup code used
- new authenticator set up
- authenticator reset
- backup codes regenerated

Alerts are limited to one per event type per account per 10 minutes. The next alert says how many were suppressed. They are also POSTed as JSON to `SECURITY_ALERT_WEBHOOK_URL` when it is set.

### Lost phone and no backup codes left

On the server:

```
docker compose -f docker-compose.prod.yml exec app npm run admin:reset-2fa -- arvi.genio@bytebuntech.com
```

This removes that admin's authenticator and backup codes, signs them out everywhere, and emails both admins. On their next sign-in they scan a new QR code after the email code.

### How the second step is enforced

Better Auth's two-factor plugin only challenges password sign-ins, not Email OTP; this was checked in the 1.7.18 source. So `backend/src/auth/auth.ts` enforces it:

- **An enrolled admin gets no session after the email code.** The session the code would create is deleted and replaced by the plugin's own short-lived, signed second-step cookie, which only `verify-totp` and `verify-backup-code` accept.
- **A session counts as signed in only if a correct authenticator or backup code created it.** `session.secondFactorVerified` is set when the session row is created, and it is `true` only when the creating request was one of those two endpoints. Browsers can't set it, and nothing changes it later.
- **The first sign-in gets a setup-only session.** It can do nothing but QR setup. Finishing setup replaces it with a new session.
- **Every `/api/admin/*` route and `/admin/*` page checks four things:** role `admin`, an authenticator set up, `secondFactorVerified`, and not banned. Signed-out requests get 401 (API) or a plain 404 (pages), never a redirect.
- **Browsers can reach only the endpoints the sign-in flow needs.** Every other Better Auth endpoint answers 404: the admin plugin API, password endpoints, impersonation, user updates.
- **Rate limits are stored in the database:**
  - email codes: 3 per 10 minutes per IP, and 3 per email
  - email code checks: 5 per 5 minutes
  - authenticator codes: 5 per 5 minutes
  - backup codes: 5 per 5 minutes
  - an account lock after 10 wrong second-step codes
- **The client IP is the verified one** from `backend/src/common/client-ip.ts`: `CF-Connecting-IP` is trusted only when the request really came through Cloudflare.

### Emails

All emails share one template (`backend/src/auth/email-template.ts`). Each one is sent as designed HTML plus a plain-text copy.

- **No images, links or web fonts**, so it reads the same with images off and looks nothing like phishing.
- **The sign-in code is in the subject**, so it shows in phone notifications.

Brand colours used:

| Color | Hex | Used for |
|---|---|---|
| Byte Purple | `#331165` | header bar, code digits |
| Bun Orange | `#FFA612` | accent stripe under the header |
| Midnight Plum | `#1A0A33` | headings |
| Muted | `#4A3B63` | body text |
| Soft Violet | `#6B4FBF` | labels, code panel border, info callouts |
| Lavender Mist | `#EDE7F8` | code panel background |
| Cream Dough | `#FFF8EC` | page background around the card |
| Line | `#D9CFEE` | borders and dividers |
| Honey Gold / Gold Tint | `#EDB330` / `#FBEFC8` | warning callouts ("Didn't request this?") |
| Danger | `#B42318` | urgent alerts (someone got past the email step) |
| Circuit Teal | `#14B8A6` | routine notices (successful sign-in) |

### Go-live checklist

- [ ] HTTPS is on (`BETTER_AUTH_URL` is `https://...`; cookies are `Secure`, `HttpOnly`, `SameSite=Strict` in production).
- [ ] `BETTER_AUTH_SECRET` is a fresh random value (`openssl rand -base64 32`), and it is stored only in the server's `.env`.
- [ ] `LOGIN_PATH` is set to something unguessable, and you have bookmarked it. Nobody posts it in chats or documents.
- [ ] SPF, DKIM and DMARC are set up for bytebuntech.com, and SMTP sends as admin@bytebuntech.com.
- [ ] A test code sent from admin@bytebuntech.com arrives in the **inbox** (not spam) for both admins.
- [ ] `npm run seed:admins` has run in production.
- [ ] Both admins have signed in once, set up the authenticator, and saved their backup codes.
- [ ] Security alerts arrive for both admins. Add a mail filter on `[Byte Bun Security]` if you like.
- [ ] `SITE_URL` is the public address (the reschedule/cancel links in lead emails point there).
- [ ] `TESTING_EMAIL_ADDRESS` is **not** in the server's `.env`. Production ignores it anyway, but keep it local.
- [ ] Book a test call on the live site with your own email: the confirmation, the "Add to calendar" buttons and the reschedule/cancel link all work, and both admins get the new-lead email.
- [ ] Behind Nginx, WebSockets are forwarded for `/api/realtime` (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`). Caddy does this on its own.

### Leads, bookings and live updates

**When someone books a call** on the lead form:

- **The lead gets a confirmation email:** "You're booked", a calendar-page graphic with the date, and the time in *their* time zone.
  - **Add to calendar:** Google Calendar, Outlook.com, Office 365 and Yahoo buttons, plus an attached `invite.ics` for Apple Calendar and other apps.
  - **Reschedule / Cancel:** both buttons open their private page (`/manage-booking#t=…`).
- **Both admins get a "[Byte Bun Leads] New lead" email** with all the details.
- **The admin site** shows a toast and updates the Leads list and the calendar.

**Reminder:** 24 hours before the call, or 2 hours before when it was booked less than 30 hours ahead. It has the same buttons. The API checks every minute and claims each reminder in the database, so it is never sent twice, even with two API instances. Cancelled calls get no reminder.

**The lead's private link** (`backend/src/booking/manage-link.ts`):

- On that page the lead can pick a new open time, cancel, or (after cancelling) book again.
- **Only our server can create a link.** The link is signed with a key derived from `BETTER_AUTH_SECRET`, so a database leak alone can't produce one.
- **The link stays out of logs.** The token is in the `#` part of the address, which browsers never send to servers, so it never appears in server logs.
- **Every change emails the lead** (with an `.ics` that updates or removes the event in their calendar) **and both admins** (`[Byte Bun Leads] Call rescheduled / cancelled`).

**Admins** reschedule or cancel from the lead drawer (the Bookings calendar or list, or Leads):

- **Reschedule** offers only the open times. Cancel asks for confirmation.
- **An optional note to the lead** is shown in their email.
- **The lead gets a professional email in our voice** ("We had to move/cancel your call…", with an apology and a button to pick a new time).
- **The other admins are emailed** with who made the change. The admin who made it is not emailed.
- **Every admin's calendar and lists update live**, and the others see a toast.

**Live updates** use Socket.IO at `/api/realtime`, the Node.js counterpart of SignalR (`backend/src/realtime/`). Only a fully signed-in admin can connect: the session cookie is checked like any `/api/admin` request, and checked again every few minutes. The sidebar shows "Live updates on" while connected.

**Caching** (`backend/src/realtime/memory-cache.ts`): admin lead and booking lists and the public booking slots are kept in memory for a few seconds. Every change clears exactly what it affects, so nobody sees stale data. The cache lives in the API process. If you ever run more than one API container, move it, and the Socket.IO connections, to Redis.

**Testing emails locally:** set `TESTING_EMAIL_ADDRESS` in your local `.env`.

- **Every email goes to that inbox instead:** lead confirmations, reminders, admin notifications, even sign-in codes.
- **The real recipients are shown** in the subject (`[TEST → lead@example.com] ...`) and in a banner.
- **Production ignores the setting**, so real customers are always emailed there.

## How it fits together

```
browser ──► web (Vite :5173) ──/api proxy──► api (NestJS :4000) ──Prisma──► db (PostgreSQL :5432)
```

On startup the API waits for PostgreSQL (with retries), creates the `bytebun` database if missing, applies Prisma migrations, then starts listening. The web container waits until the API reports healthy.

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
  src/pages/ManageBookingPage.jsx  the lead's private reschedule/cancel page (/manage-booking)
  admin.html, src/admin/  the admin app (separate bundle): sign-in steps, Leads, Bookings, Security, live toasts
                          (state in src/store/admin*.js, endpoints in src/api/admin*.js)
backend/
  prisma/schema.prisma    database schema
  prisma/migrations/      SQL migrations (applied on startup)
  prisma.config.ts        Prisma CLI config (built from DB_* variables)
  src/main.ts             bootstrap: database startup, then listen
  src/app.ts              builds the app: security middleware, Better Auth at /api/auth, /api prefix (also used by tests)
  src/auth/               admin sign-in: Better Auth config (auth.ts), admin session guard, mailer,
                          email template, security alerts, admin list (admins.ts)
  src/admin/              /api/admin/*: leads (edit), bookings (calendar, reschedule, cancel), CSV export, Security page
  src/realtime/           memory cache + live admin updates (Socket.IO) + AdminEvents (one place per change)
  src/booking/            also: manage-link.ts (lead's signed link), manage-booking.controller.ts, booking-changes.ts
  src/leads/              also: lead-emails.ts (confirmation, reminder, changes), call-calendar.ts (calendar links, .ics)
  src/scripts/            CLI: seed-admins.ts, reset-2fa.ts
  test/                   API tests (node --test + supertest) against a separate test database
  src/app.module.ts       root NestJS module: wires the modules below, rate-limit guard, error filter
  src/config/             reads and validates environment variables (injectable as APP_CONFIG)
  src/database/           PrismaService, startup sequence (wait for PostgreSQL, create DB, migrate)
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

Admin endpoints (all need a fully signed-in admin, else `401`):

- `/api/admin/me`
- `/api/admin/leads`, with `?q=&status=&page=`
- `/api/admin/leads/:id` (`GET`, or `PATCH` with any of the lead's fields; only those change)
- `/api/admin/leads/options` (status, goal and feature choices for the edit form)
- `/api/admin/leads/export.csv`
- `/api/admin/bookings`, with `?when=upcoming|past`, or `?from=&to=` for the calendar (up to 62 days)
- `/api/admin/bookings/slots` (open times, for rescheduling)
- `POST /api/admin/bookings/:id/reschedule`, with `{startsAt, note?}`
- `POST /api/admin/bookings/:id/cancel`, with `{note?}` (`DELETE /api/admin/bookings/:id` is the same, without a note)
- `/api/admin/security`
- `/api/admin/security/sessions/:id/revoke`
- `/api/admin/security/sessions/revoke-others`
- `/api/admin/security/backup-codes`, with `{code}`

Sign-in is `/api/auth/*` (Better Auth); see "Admin site" above.

The lead's private page uses `/api/booking/manage`: `GET`, plus `POST /reschedule {meetingAt, timeZone?}` and `POST /cancel`. Each needs the `X-Booking-Token` header from their email link. A wrong or revoked token gets `404`. Changes are rate limited like the lead form.

Live admin updates: Socket.IO at path `/api/realtime` (signed-in admins only). Its events are `lead.created`, `lead.updated` and `booking.changed`.

When `N8N_WEBHOOK_URL` is set, each saved lead is also POSTed there (`{event:"lead.created", lead}`, with `firstName`, `lastName`, contact details, `goals` and `features` as readable labels, and `booking: {startsAt, timeZone}`). A failing webhook never affects the visitor. This is the hook for n8n and GoHighLevel.
