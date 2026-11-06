# Continuous deployment (GitHub Actions)

Every push to `main` deploys automatically:

```
push to main ──► GitHub: build production image ──► SSH to VPS ──► scripts/deploy.sh
                 (broken build? stops here)                         pull, rebuild, restart app,
                                                                    wait for health check,
                                                                    roll back if unhealthy
```

- Workflow: [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)
- Server script: [scripts/deploy.sh](../scripts/deploy.sh) (also works by hand on the VPS)
- Pushes that only change `*.md` or `docs/` don't deploy.
- A failed deploy fails the GitHub run, and GitHub emails you. The site keeps running the previous version.

The SSH key GitHub uses is **locked to the deploy script** on the server (a "forced command"): it can't open a shell, run other commands or forward ports, even if it leaks.

## One-time setup

You need a working deployment first ([DEPLOY-VPS.md](DEPLOY-VPS.md)): the repo cloned at `/opt/bytebun-web`, `.env` in place, and the site up. The commands below use `you` for your VPS user and `VPS_IP` for the server address.

### 1. Get the deploy script onto the server

Push this commit, then on the VPS run once:

```bash
cd /opt/bytebun-web
git pull
ls -l scripts/deploy.sh        # should show -rwxr-xr-x
```

The first push also starts a GitHub run that fails at "Check configuration" (no secrets yet). That's expected.

### 2. Create the deploy key (on the VPS)

```bash
ssh-keygen -t ed25519 -f ~/gha_deploy -N "" -C "github-actions-deploy"

# Allow it, but only to run the deploy script ("restrict" turns off shells, forwarding, pty).
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "command=\"/opt/bytebun-web/scripts/deploy.sh\",restrict $(cat ~/gha_deploy.pub)" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Your VPS user must be in the `docker` group and own `/opt/bytebun-web` (DEPLOY-VPS.md step 1 did both). This key is separate from the read-only deploy key of DEPLOY-VPS.md step 2: that one lets the server read GitHub, this one lets GitHub run the deploy script on the server.

### 3. Collect the values for GitHub (on the VPS)

```bash
# VPS_SSH_KEY: the private key, the whole thing including the BEGIN/END lines
cat ~/gha_deploy

# VPS_KNOWN_HOSTS: this server's host keys, so GitHub refuses impostor servers.
# Replace VPS_IP with exactly what you'll put in VPS_HOST.
for f in /etc/ssh/ssh_host_*_key.pub; do echo "VPS_IP $(cut -d' ' -f1,2 "$f")"; done
```

If SSH listens on a port other than 22, write the host as `[VPS_IP]:2222` in those lines.

### 4. Add them to GitHub

Repo → **Settings** → **Secrets and variables** → **Actions**.

**Secrets** tab, **New repository secret**:

| Name | Value |
|---|---|
| `VPS_HOST` | server IP or hostname, e.g. `203.0.113.10` |
| `VPS_USER` | your VPS user, e.g. `you` |
| `VPS_SSH_KEY` | output of `cat ~/gha_deploy` |
| `VPS_KNOWN_HOSTS` | output of the `for` loop |

**Variables** tab, **New repository variable**:

| Name | Value |
|---|---|
| `SITE_URL` | `https://yourdomain.com` (checked after each deploy; optional) |
| `VPS_PORT` | only if SSH isn't on port 22 |

Then delete the private key from the server (GitHub has its copy; the `.pub` stays):

```bash
shred -u ~/gha_deploy
```

### 5. Test it

GitHub → **Actions** → **Deploy** → **Run workflow**. Both jobs should go green in a few minutes. The "Deploy" step's log shows the server output, ending in `==> Deployed <commit>`.

From now on, `git push` to `main` is a deploy.

### 6. Recommended: guard production

- **Approval before each deploy** (optional, needs GitHub Pro for a private repo): create an environment under **Settings → Environments**, add yourself as a required reviewer, and add `environment: production` to the `deploy` job in the workflow. Skip this for fully automatic deploys.
- **Settings → Branches → Add rule for `main`**: block force-pushes. Everything pushed to `main` goes live.

## Day to day

| Task | How |
|---|---|
| Deploy | push to `main` |
| Re-deploy the same commit | Actions → Deploy → Run workflow |
| Watch a deploy | Actions tab, or on the VPS `docker compose -f docker-compose.prod.yml logs -f app` |
| Deploy by hand (e.g. GitHub down) | on the VPS: `/opt/bytebun-web/scripts/deploy.sh` |
| Undo a bad release | `git revert <commit>` and push (the rollback only covers releases that fail the health check) |
| Pause automatic deploys | Actions → Deploy → ⋯ → Disable workflow |
| Revoke GitHub's access | delete the `github-actions-deploy` line from `~/.ssh/authorized_keys` on the VPS |

## Troubleshooting

| Failing step / message | Cause and fix |
|---|---|
| Check configuration: `Missing secrets` | Add the listed secrets (step 4). Names are case-sensitive. |
| Deploy: `Host key verification failed` | `VPS_KNOWN_HOSTS` doesn't match `VPS_HOST` (IP vs hostname, or a non-22 port written without `[host]:port`). Redo step 3. |
| Deploy: `Permission denied (publickey)` | Wrong user in `VPS_USER`, key missing from `~/.ssh/authorized_keys`, or the secret is missing its BEGIN/END lines. |
| `Can't fast-forward: files on the server were edited` | Someone changed files in `/opt/bytebun-web`. Run `git status` there; keep changes in the repo, not on the server. |
| `New version is NOT healthy` | The printed app logs show why (often a missing `.env` value or a failing migration). The previous version is back online; fix and push again. |
| Build job fails | The commit doesn't build. Same error as `docker build .` locally. |
| Deploy works but `Check the public site` fails | App is healthy but not reachable from outside: check Caddy (`sudo systemctl status caddy`) and DNS. |

**Migrations and rollback:** the app applies database migrations on startup. If a release with a migration gets rolled back, the old code runs against the new schema. Keep migrations backward-compatible (add columns or tables; drop or rename in a later release).
