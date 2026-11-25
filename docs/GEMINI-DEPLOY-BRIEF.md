# Deployment brief: Byte Bun client apps (for an AI assistant)

You are helping deploy **bytebun-web** to its production server (a Linux VPS behind Cloudflare,
Nginx as the reverse proxy, Docker Compose). Read this whole brief before running anything. When a
step's result doesn't match what is described here, **stop and report** instead of improvising.

## 1. What the system is

- One repository, one Docker image (`bytebun-web`), started with `docker-compose.prod.yml`:
  - `app`: NestJS API + the built frontend, listening on `127.0.0.1:4000` only.
  - `db`: PostgreSQL 17, data in the Docker volume **`bytebun-prod_pg-data`**. It holds two
    databases: the admin/landing database (`DB_NAME`, default `bytebun`) and the clients
    database (`CLIENTS_DB_NAME`, default `clients_db`: accounts, bookings, events).
- The app picks what to show from the **Host header**, so every host below goes to the same
  `127.0.0.1:4000`.
- On start, the app creates missing databases and applies Prisma migrations
  (`backend/prisma/migrations`, `backend/prisma-clients/migrations`). This release adds client
  migrations **0008 to 0024** (events, scanners, claimables, vouchers, map pins, retention...).
- Deploys run `scripts/deploy.sh` (from GitHub Actions over SSH, or by hand on the server at
  `/opt/bytebun-web`). It fast-forwards `main`, runs a database guard, backs up both databases
  to `backups/`, builds, restarts, waits for health, and rolls back if unhealthy.

## 2. Hosts

| Host | Purpose |
|---|---|
| `bytebuntech.com` | Main website and admin site (already live, leave as is) |
| `www.bytebuntech.com` | Redirect to `bytebuntech.com` (already live, leave as is) |
| `accounts.bytebuntech.com` | Client sign-in, invitations, new business setup |
| `bookings.bytebuntech.com` | Bookings app `/app`, public booking pages `/{business}`, event pages `/{business}/e/{event}`, `/manage` links |
| `clientportal.bytebuntech.com` | Client portal |
| `scanner.bytebuntech.com` | Event check-in scanners `/{business}/{event}/{scannerCode}` |

Current state (checked before this brief): DNS for `accounts`, `bookings`, `clientportal` exists
and is proxied by Cloudflare; **`scanner` has no DNS record yet**. `bookings.bytebuntech.com`
returns **Cloudflare 526** (the origin certificate doesn't cover it) and HTTP 404 (Nginx has no
server block for it).

## 3. Steps

### 3.1 Cloudflare (done by the person, in the dashboard)
1. DNS: add `scanner` (same target as `bookings`, proxied / orange cloud).
2. SSL/TLS → Origin Server → Create Certificate, hostnames `bytebuntech.com` and
   `*.bytebuntech.com`, RSA, 15 years.
3. SSL/TLS → Overview: mode **Full (strict)**.

### 3.2 Install the origin certificate (server)
```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/bytebuntech.pem   # paste the Origin Certificate
sudo nano /etc/ssl/cloudflare/bytebuntech.key   # paste the Private key
sudo chmod 600 /etc/ssl/cloudflare/bytebuntech.key
```
Never print, log, or copy the private key anywhere else.

### 3.3 Nginx site for the client hosts (server)
Create `/etc/nginx/sites-available/bytebun-clients`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name accounts.bytebuntech.com bookings.bytebuntech.com clientportal.bytebuntech.com scanner.bytebuntech.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name accounts.bytebuntech.com bookings.bytebuntech.com clientportal.bytebuntech.com scanner.bytebuntech.com;

    ssl_certificate     /etc/ssl/cloudflare/bytebuntech.pem;
    ssl_certificate_key /etc/ssl/cloudflare/bytebuntech.key;

    client_max_body_size 10m;

    # Live attendance (server-sent events): must not be buffered.
    location ~ ^/api/client/bookings/events/\d+/live$ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```
If Nginx is older than 1.25, replace `http2 on;` + `listen 443 ssl;` with `listen 443 ssl http2;`.

```bash
sudo ln -s /etc/nginx/sites-available/bytebun-clients /etc/nginx/sites-enabled/
sudo nginx -t            # must say "syntax is ok" / "test is successful"
sudo systemctl reload nginx
```
If `nginx -t` reports a conflicting server name, one of these hosts already exists in another
file: show that file to the person before changing it. Do not edit the main site's block.

### 3.4 Check the data volume (server) — required before deploying
```bash
docker volume ls | grep pg-data
```
- Shows **`bytebun-prod_pg-data`**: continue.
- Shows a different name (or nothing, while `/opt/bytebun-web/backups/` has `.dump` files):
  **STOP**. Deploying now would start an empty database. Report the output.

### 3.5 Check `.env` (server, `/opt/bytebun-web/.env`) — report, don't print secrets
- `HERE_API_KEY` is set (event address search and maps need it).
- `TESTING_EMAIL_ADDRESS` is not set (production ignores it anyway).
- `ACCOUNTS_URL`, `BOOKINGS_URL`, `PORTAL_URL`, `SCANNER_URL`, `CLIENT_COOKIE_DOMAIN` can stay
  unset: the defaults are the hosts above and `.bytebuntech.com`.

### 3.6 Deploy
The person commits and pushes `main` (GitHub Actions deploys), or on the server:
```bash
cd /opt/bytebun-web && scripts/deploy.sh
```
The database guard may stop once with "the db service changed", because the data volume now has
an explicit name in `docker-compose.prod.yml`. **Only if step 3.4 showed `bytebun-prod_pg-data`**,
run:
```bash
cd /opt/bytebun-web && ALLOW_DB_CHANGE=1 scripts/deploy.sh
```
If it stops for any other reason (a migration that drops or deletes data, a failed backup, a
missing volume), do not override it: report the message.

## 4. Verify

```bash
for h in bytebuntech.com accounts.bytebuntech.com bookings.bytebuntech.com clientportal.bytebuntech.com scanner.bytebuntech.com; do
  printf '%-32s ' "$h"; curl -s -o /dev/null -w '%{http_code}\n' "https://$h/"
done
docker compose -f /opt/bytebun-web/docker-compose.prod.yml ps
docker compose -f /opt/bytebun-web/docker-compose.prod.yml logs app --tail 80
```
Expected: every host answers `200` (or a `30x` redirect within the same host), the `app`
container is `healthy`, and the log shows `Migrations are up to date` / `API listening on port 4000`
with no `level":50` errors. In a browser: `https://bookings.bytebuntech.com/sign-in` shows the
"Byte Bun Bookings · Bookings & Events" sign-in.

## 5. Rules (never break these)

- **Never** run `docker compose down -v`, `docker volume rm`, `docker system prune --volumes`, or
  anything else that removes the `bytebun-prod_pg-data` volume.
- Never edit or delete files in `backend/prisma*/migrations/`; never run `prisma migrate reset`
  or `prisma db push`.
- Never set `ALLOW_DB_CHANGE=1` or `SKIP_BACKUP=1` except exactly as described in 3.6.
- Don't edit files inside `/opt/bytebun-web` by hand (the deploy refuses to fast-forward an
  edited checkout); changes go through the repository.
- Never print or paste secrets (`.env` values, the Cloudflare private key, database passwords).
- Leave the main site's Nginx block and certificate alone.
- When something fails, report the exact command and output and stop; don't try alternatives
  that touch data.

## 6. Restore (only if asked)

Backups are in `/opt/bytebun-web/backups/`: `pre-deploy-*.dump` (admin database) and
`pre-deploy-clients-*.dump` (clients database), newest 14 of each. The procedure is in
`docs/DEPLOY-VPS.md`, section "Restore". Ask the person before restoring anything.
