# Deploy to a VPS

Production runs two containers from `docker-compose.prod.yml`:

- **app**: one image with Express serving the built website and `/api`. Published on `127.0.0.1:APP_PORT` only.
- **db**: SQL Server, data in the `mssql-data` Docker volume. **No published port**, so it isn't reachable from outside.

Your reverse proxy (Caddy, Nginx, or Traefik) handles HTTPS and forwards to the app.

## Requirements

- Linux VPS on **x86-64 (amd64)**. The SQL Server image does not run on ARM servers.
- At least **2 GB RAM free for SQL Server**, so 4 GB total is a sensible minimum.
- Docker Engine with the Compose plugin (`docker compose version` works).
- A domain pointing to the server (DNS A/AAAA record).

## Steps

1. **Copy the project** to the server, e.g. `/opt/bytebun-web` (`git clone`, or `rsync` without `node_modules`, `.data`, and `.env`).

2. **Create `.env`** from the example and set real values:
   ```bash
   cd /opt/bytebun-web
   cp .env.example .env
   chmod 600 .env
   nano .env
   ```
   Set at least: `NODE_ENV=production`, `SITE_URL=https://yourdomain.com`, `FRONTEND_ORIGIN=https://yourdomain.com`, a new strong `MSSQL_SA_PASSWORD`, and the same value in `DB_PASSWORD`. Generate a password with `openssl rand -base64 24` and add a symbol if it lacks one; avoid `$`.

   SQL Server edition: the default is `MSSQL_PID=Express` (free, 10 GB per database). Developer edition is not licensed for production. To use a paid edition, set `MSSQL_PID` and make sure you have the license.

3. **Build and start:**
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

4. **Check health:**
   ```bash
   docker compose -f docker-compose.prod.yml ps          # both "healthy"
   docker compose -f docker-compose.prod.yml logs -f app # look for "API listening"
   curl -s http://127.0.0.1:4000/api/health
   ```

5. **Put a reverse proxy in front.** Caddy is the simplest (automatic HTTPS). `/etc/caddy/Caddyfile`:
   ```
   yourdomain.com {
       reverse_proxy 127.0.0.1:4000
   }
   www.yourdomain.com {
       redir https://yourdomain.com{uri} permanent
   }
   ```
   Nginx equivalent: `proxy_pass http://127.0.0.1:4000;` with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` and `proxy_set_header X-Forwarded-Proto $scheme;`, plus a certificate from Certbot.

   Express trusts one proxy hop (`TRUST_PROXY=1`), so rate limits use the visitor's real IP. If you add a CDN in front of the proxy, increase it to the number of hops. Don't expose the app port publicly: with `TRUST_PROXY` set, anyone reaching it directly could fake their IP.

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
