# Deploy to a VPS

Production runs two containers from `docker-compose.prod.yml`:

- **app**: one image with the NestJS API serving the built website and `/api`. Published on `127.0.0.1:APP_PORT` only.
- **db**: PostgreSQL 17, data in the `pg-data` Docker volume. **No published port**, so it isn't reachable from outside.

Your reverse proxy (Caddy, Nginx, or Traefik) handles HTTPS and forwards to the app.

## Requirements

- Linux VPS, x86-64 or ARM64.
- At least **1 GB RAM** (2 GB is comfortable, mostly for the Docker build).
- Docker Engine with the Compose plugin (`docker compose version` works).
- A domain pointing to the server (DNS A/AAAA record).

## Steps

Commands assume Ubuntu 22.04/24.04. `you` is your VPS user, `yourdomain.com` your domain, `VPS_IP` the server's IP.

0. **Point the domain at the server.** At your DNS provider add an `A` record for `yourdomain.com` and one for `www`, both to `VPS_IP` (plus `AAAA` records if the server has IPv6). Check with `nslookup yourdomain.com` before step 7: HTTPS certificates can only be issued once DNS points here.

1. **Prepare the server** (once, logged in as root or with sudo):
   ```bash
   # A normal user for deploys (skip if you already have one)
   adduser you && usermod -aG sudo you

   # Docker Engine + Compose plugin (official convenience script)
   curl -fsSL https://get.docker.com | sh
   usermod -aG docker you          # lets "you" run docker without sudo (log out and in again)

   # Firewall: SSH, HTTP, HTTPS only
   ufw allow OpenSSH && ufw allow 80,443/tcp && ufw --force enable

   # App folder owned by the deploy user
   mkdir -p /opt/bytebun-web && chown you:you /opt/bytebun-web
   ```
   From here on, work as `you` (`ssh you@VPS_IP`). `docker compose version` should print a version.

2. **Give the server read access to the private repo** with a read-only deploy key (as `you`):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/github_bytebun -N "" -C "bytebun-vps-read-only"
   cat >> ~/.ssh/config <<'CONF'
   Host github.com
     IdentityFile ~/.ssh/github_bytebun
     IdentitiesOnly yes
   CONF
   chmod 600 ~/.ssh/config
   cat ~/.ssh/github_bytebun.pub
   ```
   GitHub → your repo → **Settings → Deploy keys → Add deploy key**: paste the `.pub` line, title it "VPS", **leave "Allow write access" unchecked**. Then test (answer `yes` once, after checking the fingerprint against [GitHub's published SSH key fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)):
   ```bash
   ssh -T git@github.com     # "Hi <owner>/<repo>! You've successfully authenticated..."
   ```
   This key only lets the server read this one repo. `scripts/deploy.sh` uses it for every `git fetch`.

3. **Clone the project:**
   ```bash
   git clone git@github.com:OWNER/REPO.git /opt/bytebun-web
   ```

4. **Create `.env`** from the example and set real values:
   ```bash
   cd /opt/bytebun-web
   cp .env.example .env
   chmod 600 .env
   nano .env
   ```
   Set at least: `NODE_ENV=production`, `SITE_URL=https://yourdomain.com`, `FRONTEND_ORIGIN=https://yourdomain.com`, and a new strong `DB_PASSWORD`. Generate one with `openssl rand -hex 24`; avoid `$`.

   The db container creates the `DB_USER` role and `DB_NAME` database with that password on its **first** start. Changing `DB_PASSWORD` later doesn't change the role's password; do that in psql (`ALTER ROLE bytebun PASSWORD '...'`), then update `.env`.

   To use a managed PostgreSQL instead of the db container, point `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD` at it, set `DB_SSL=true`, and remove the `db` service and the app's `depends_on`.

5. **Build and start** (the first build takes several minutes):
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

6. **Check health:**
   ```bash
   docker compose -f docker-compose.prod.yml ps          # both "healthy"
   docker compose -f docker-compose.prod.yml logs -f app # look for "API listening"
   curl -s http://127.0.0.1:4000/api/health
   ```

7. **Put a reverse proxy in front.** Caddy is the simplest (automatic HTTPS). Install it ([caddyserver.com/docs/install](https://caddyserver.com/docs/install), "Debian, Ubuntu" section), then put this in `/etc/caddy/Caddyfile` and run `sudo systemctl reload caddy`:
   ```
   yourdomain.com {
       reverse_proxy 127.0.0.1:4000
   }
   www.yourdomain.com {
       redir https://yourdomain.com{uri} permanent
   }
   ```
   Nginx equivalent: `proxy_pass http://127.0.0.1:4000;` with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` and `proxy_set_header X-Forwarded-Proto $scheme;`, plus a certificate from Certbot.

   The API trusts one proxy hop (`TRUST_PROXY=1`), so rate limits use the visitor's real IP. **Behind Cloudflare, keep it at 1**: the app recognizes Cloudflare's addresses and reads the visitor's IP from the `CF-Connecting-IP` header (only when the request really came from Cloudflare, so it can't be faked; see `backend/src/common/client-ip.ts`). For a different CDN, increase it to the number of hops. Don't expose the app port publicly: with `TRUST_PROXY` set, anyone reaching it directly could fake their IP.

   If your proxy runs in Docker (e.g. Traefik), attach it to the `bytebun` network and route to `app:4000` instead of using the published port.

## Backups

Dump the database with `pg_dump` (custom format, compressed) straight to the host:

```bash
cd /opt/bytebun-web
mkdir -p backups
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/bytebun-$(date +%F).dump"
```

Schedule it (e.g. daily with cron), and copy backups **off the server** (object storage or another machine). Test a restore occasionally.

### Restore

```bash
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < backups/bytebun-YYYY-MM-DD.dump
docker compose -f docker-compose.prod.yml start app
```

## Updating

Pushes to `main` deploy automatically once continuous deployment is set up: see [DEPLOY-CD.md](DEPLOY-CD.md). To update by hand, run `scripts/deploy.sh` on the server (it pulls, rebuilds, and rolls back if the new version is unhealthy), or do it step by step:

`scripts/deploy.sh` protects the data in two ways. **First, it refuses database changes:** if an update changes the `db` service (a new engine or version, a different volume, or different settings) or contains a risky migration (dropping a table or column, deleting rows, changing a column's type, or editing or deleting an existing migration), it stops without deploying. Run it with `ALLOW_DB_CHANGE=1` once you have a plan for the data. **Second, it backs up before every deploy:** a `pg_dump` goes to `backups/pre-deploy-*.dump` (the newest 14 are kept), and if the backup fails, nothing is deployed. These dumps stay on the server, so keep making the off-server copies described in [Backups](#backups).

```bash
cd /opt/bytebun-web
# take a backup first (above)
git pull                                              # or copy the new files
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Database migrations in `backend/prisma/migrations` run automatically when the app starts. Remove old images now and then with `docker image prune`.

## Security checklist

- [ ] **Firewall**: allow only SSH (22), HTTP (80), and HTTPS (443). E.g. `ufw default deny incoming && ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`. Note that Docker-published ports can bypass ufw; this setup only publishes on `127.0.0.1`, so that's fine.
- [ ] **No root logins**: deploy as a normal user with sudo; disable SSH password login and root login (`PermitRootLogin no`, `PasswordAuthentication no`).
- [ ] **HTTPS** via the reverse proxy; HTTP redirects to HTTPS.
- [ ] **Secrets**: `.env` is `chmod 600`, never committed, and `DB_PASSWORD` is unique to this server.
- [ ] **Database not exposed**: `docker compose -f docker-compose.prod.yml ps` shows no `0.0.0.0:5432`.
- [ ] **Backups** run on a schedule, are stored off-server, and a restore has been tested.
- [ ] **Updates**: enable unattended OS security updates; update Docker images regularly (`docker compose ... pull` then `up -d --build`).
- [ ] The app container runs as a non-root user (built into the image).
