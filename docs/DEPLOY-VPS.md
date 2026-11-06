# Deploy to a VPS

Production runs two containers from `docker-compose.prod.yml`:

- **app**: one image with the NestJS API serving the built website and `/api`. Published on `127.0.0.1:APP_PORT` only.
- **db**: SQL Server, data in the `mssql-data` Docker volume. **No published port**, so it isn't reachable from outside.

Your reverse proxy (Caddy, Nginx, or Traefik) handles HTTPS and forwards to the app.

## Requirements

- Linux VPS on **x86-64 (amd64)**. The SQL Server image does not run on ARM servers.
- At least **2 GB RAM free for SQL Server**, so 4 GB total is a sensible minimum.
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
   Set at least: `NODE_ENV=production`, `SITE_URL=https://yourdomain.com`, `FRONTEND_ORIGIN=https://yourdomain.com`, a new strong `MSSQL_SA_PASSWORD`, and the same value in `DB_PASSWORD`. Generate a password with `openssl rand -base64 24` and add a symbol if it lacks one; avoid `$`.

   SQL Server edition: the default is `MSSQL_PID=Express` (free, 10 GB per database). Developer edition is not licensed for production. To use a paid edition, set `MSSQL_PID` and make sure you have the license.

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

   The API trusts one proxy hop (`TRUST_PROXY=1`), so rate limits use the visitor's real IP. If you add a CDN in front of the proxy, increase it to the number of hops. Don't expose the app port publicly: with `TRUST_PROXY` set, anyone reaching it directly could fake their IP.

   If your proxy runs in Docker (e.g. Traefik), attach it to the `bytebun` network and route to `app:4000` instead of using the published port.

## Backups

Create a backup inside the db container, then copy it to the host:

```bash
cd /opt/bytebun-web
docker compose -f docker-compose.prod.yml exec db bash -c '
  mkdir -p /var/opt/mssql/backup &&
  SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b \
    -Q "BACKUP DATABASE [bytebun] TO DISK = N'"'"'/var/opt/mssql/backup/bytebun.bak'"'"' WITH INIT"'
mkdir -p backups
docker compose -f docker-compose.prod.yml cp db:/var/opt/mssql/backup/bytebun.bak "backups/bytebun-$(date +%F).bak"
```

Schedule it (e.g. daily with cron), and copy backups **off the server** (object storage or another machine). Test a restore occasionally.

### Restore

```bash
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml cp backups/bytebun-YYYY-MM-DD.bak db:/var/opt/mssql/backup/restore.bak
docker compose -f docker-compose.prod.yml exec db bash -c '
  SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b \
    -Q "RESTORE DATABASE [bytebun] FROM DISK = N'"'"'/var/opt/mssql/backup/restore.bak'"'"' WITH REPLACE"'
docker compose -f docker-compose.prod.yml start app
```

## Updating

Pushes to `main` deploy automatically once continuous deployment is set up: see [DEPLOY-CD.md](DEPLOY-CD.md). To update by hand, run `scripts/deploy.sh` on the server (it pulls, rebuilds, and rolls back if the new version is unhealthy), or do it step by step:

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
- [ ] **Secrets**: `.env` is `chmod 600`, never committed, and the SA password is unique to this server.
- [ ] **Database not exposed**: `docker compose -f docker-compose.prod.yml ps` shows no `0.0.0.0:1433`.
- [ ] **Backups** run on a schedule, are stored off-server, and a restore has been tested.
- [ ] **Updates**: enable unattended OS security updates; update Docker images regularly (`docker compose ... pull` then `up -d --build`).
- [ ] The app container runs as a non-root user (built into the image).
