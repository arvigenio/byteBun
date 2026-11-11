#!/usr/bin/env bash
# Deploys the latest `main` on the VPS. Run by GitHub Actions over SSH (docs/DEPLOY-CD.md),
# or by hand:  /opt/bytebun-web/scripts/deploy.sh
#
#   1. fast-forward the checkout to origin/main (refuses if the server copy was edited)
#   2. database guard: STOPS (and resets the checkout) if the update changes the db service
#      (image, volume, settings) or contains a risky migration; see check_database_changes
#   3. backs up the database (pg_dump) to backups/, keeping the newest 14; no backup, no deploy
#   4. keep the running app image as bytebun-web:previous
#   5. build the new image and restart the app
#   6. wait for the app's health check
#   7. not healthy in time -> switch back to :previous, reset the checkout, exit 1
#      (so the GitHub run fails and GitHub emails you)
#
# Settings (environment variables, all optional):
#   HEALTH_TIMEOUT   seconds to wait for "healthy" (default 240)
#   DEPLOY_BRANCH    branch to deploy (default main)
#   ALLOW_DB_CHANGE  1 = deploy even though the guard (step 2) found database changes. Only a
#                    person on the server can set it: GitHub's key runs this script with no
#                    settings. Do the data migration/backup plan first.
#   SKIP_BACKUP      1 = deploy without the step 3 backup (e.g. the running db isn't PostgreSQL)
#
# Note on rollback: the app applies Prisma migrations on startup. If a deploy that added a
# migration is rolled back, the old code runs against the new schema. Keep migrations
# backward-compatible (add columns, don't drop/rename in the same release).

set -euo pipefail

IMAGE=bytebun-web
LOCK_FILE=/tmp/bytebun-deploy.lock

log() { printf '\n==> %s\n' "$*"; }

main() {
  local app_dir branch timeout
  app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  branch="${DEPLOY_BRANCH:-main}"
  timeout="${HEALTH_TIMEOUT:-240}"
  cd "$app_dir"
  compose() { docker compose -f "$app_dir/docker-compose.prod.yml" "$@"; }

  # One deploy at a time (GitHub also queues runs, this covers manual runs too).
  exec 9>"$LOCK_FILE"
  if ! flock -w 900 9; then
    echo "Another deploy is still running after 15 minutes; giving up." >&2
    return 1
  fi

  [[ -f .env ]] || { echo "Missing $app_dir/.env (see docs/DEPLOY-VPS.md, step 4)." >&2; return 1; }

  log "Updating code from origin/$branch"
  local previous_commit new_commit
  previous_commit="$(git rev-parse HEAD)"
  git fetch --quiet origin "$branch"
  if ! git merge --ff-only --quiet "origin/$branch"; then
    echo "Can't fast-forward: files on the server were edited or the branch was rewritten." >&2
    echo "Inspect with: cd $app_dir && git status" >&2
    return 1
  fi
  new_commit="$(git rev-parse HEAD)"
  echo "$(git rev-parse --short "$previous_commit") -> $(git log -1 --format='%h %s' "$new_commit")"

  log "Checking for database changes"
  local db_changes
  db_changes="$(check_database_changes "$previous_commit" "$new_commit")"
  if [[ -n $db_changes ]]; then
    printf '%s\n' "$db_changes"
    if [[ ${ALLOW_DB_CHANGE:-} != 1 ]]; then
      git reset --quiet --hard "$previous_commit"
      log "STOPPED: this update changes the database, so it is not deployed automatically."
      echo "Nothing was changed on the server; it still runs $(git log -1 --format='%h %s')."
      echo "A different db image or volume starts an EMPTY database, and a risky migration can delete data."
      echo "Plan how the data moves over, take a backup, then deploy by hand on the server:"
      echo "  cd $app_dir && ALLOW_DB_CHANGE=1 scripts/deploy.sh"
      return 1
    fi
    echo "ALLOW_DB_CHANGE=1: deploying anyway."
  else
    echo "none"
  fi

  log "Backing up the database"
  if [[ ${SKIP_BACKUP:-} == 1 ]]; then
    echo "SKIP_BACKUP=1: no backup taken."
  elif ! backup_database "$app_dir/backups" "$previous_commit"; then
    git reset --quiet --hard "$previous_commit"
    log "STOPPED: the backup failed, so nothing was deployed (set SKIP_BACKUP=1 to deploy without one)."
    return 1
  fi

  local have_previous=false
  if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
    docker tag "$IMAGE:latest" "$IMAGE:previous"
    have_previous=true
  fi

  log "Building"
  compose build app

  log "Starting"
  compose up -d --remove-orphans

  log "Waiting up to ${timeout}s for the app to report healthy"
  if wait_healthy "$timeout"; then
    log "Deployed $(git log -1 --format='%h %s')"
    docker image prune -f >/dev/null
    compose ps
    return 0
  fi

  log "New version is NOT healthy. Last app logs:"
  compose logs --tail 60 app || true

  if [[ $have_previous == true ]]; then
    log "Rolling back to the previous image"
    docker tag "$IMAGE:previous" "$IMAGE:latest"
    compose up -d --no-build app
    git reset --quiet --hard "$previous_commit"
    if wait_healthy "$timeout"; then
      log "Rolled back to $(git log -1 --format='%h %s'). Fix the problem and push again."
    else
      log "Rollback is not healthy either. The site may be down: check 'docker compose -f docker-compose.prod.yml logs app'."
    fi
  else
    log "No previous image to roll back to (first deploy)."
  fi
  return 1
}

# Prints one line per reason this update between two commits could lose data; nothing if safe.
#  - the db service as Compose resolves it (image, volumes and their real names, environment)
#    differs: e.g. another database engine/version or a renamed volume = an empty database
#  - an existing migration was deleted, renamed or edited, or migration_lock.toml changed
#  - a new migration drops a table/column, truncates, deletes rows, or changes a column's type,
#    unless its folder has a `deploy-guard-reviewed` file (someone checked that the data is
#    carried over first, e.g. backfill then drop; the file says why). A separate file, not a
#    comment, so migration.sql's Prisma checksum never changes. Those deploy automatically;
#    the pre-deploy backup still runs.
# If a commit's db service can't be resolved, that counts as a change (fail safe).
check_database_changes() {
  local from=$1 to=$2 old new tmp f
  [[ $from == "$to" ]] && return 0

  db_service_at() {
    tmp="$(mktemp)"
    git show "$1:docker-compose.prod.yml" >"$tmp" 2>/dev/null &&
      docker compose -f "$tmp" --project-directory "$app_dir" config db 2>/dev/null
    local rc=$?
    rm -f "$tmp"
    return $rc
  }
  if ! old="$(db_service_at "$from")" || ! new="$(db_service_at "$to")"; then
    echo "- docker-compose.prod.yml: couldn't compare the db service between the two versions"
  elif [[ $old != "$new" ]]; then
    echo "- docker-compose.prod.yml: the db service changed:"
    diff <(printf '%s\n' "$old") <(printf '%s\n' "$new") | grep '^[<>]' | sed 's/^/    /' || true
  fi

  git diff --name-only --diff-filter=DMR "$from" "$to" -- backend/prisma/migrations |
    sed 's/^/- existing migration changed or removed: /'
  git diff --name-only --diff-filter=A "$from" "$to" -- 'backend/prisma/migrations/*.sql' |
    while read -r f; do
      # Process substitution, not a pipe: with pipefail, grep -q stopping early could fail the pipe.
      if git cat-file -e "$to:$(dirname "$f")/deploy-guard-reviewed" 2>/dev/null; then
        echo "  (reviewed, deploying automatically: $f)" >&2
      elif grep -qiE 'drop[[:space:]]+(table|column|schema|database)|truncate|delete[[:space:]]+from|alter[[:space:]]+column[^;]*[[:space:]]type[[:space:]]' <(git show "$to:$f"); then
        echo "- new migration drops, deletes or retypes data: $f"
      fi
    done
}

# pg_dump of the running database into <dir>, keeping the newest 14 pre-deploy dumps.
# Restore: docs/DEPLOY-VPS.md, "Restore". Fails (so the deploy stops) if it can't make a
# readable dump; succeeds without one only when no db container is running yet (first deploy).
backup_database() {
  local dir=$1 commit=$2 file
  if ! compose ps --status running --services 2>/dev/null | grep -x db >/dev/null; then
    echo "No running db container (first deploy?): nothing to back up."
    return 0
  fi
  if ! compose exec -T db sh -c 'command -v pg_dump' >/dev/null 2>&1; then
    echo "The running db container isn't PostgreSQL (no pg_dump); can't back it up." >&2
    return 1
  fi
  mkdir -p "$dir"
  file="$dir/pre-deploy-$(date +%F-%H%M%S)-${commit:0:7}.dump"
  if ! compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$file.part" ||
    ! compose exec -T db pg_restore --list <"$file.part" >/dev/null; then
    rm -f "$file.part"
    echo "pg_dump failed or produced an unreadable file." >&2
    return 1
  fi
  mv "$file.part" "$file"
  chmod 600 "$file"
  echo "Saved $file ($(du -h "$file" | cut -f1))"
  ls -1t "$dir"/pre-deploy-*.dump 2>/dev/null | tail -n +15 | xargs -r -d '\n' rm -f --
}

# Polls the app container's Docker health status until healthy, unhealthy, or timeout.
# Uses compose(), which main defines.
wait_healthy() {
  local timeout=$1 waited=0 id status
  while (( waited < timeout )); do
    id="$(compose ps -q app)"
    status="$( [[ -n $id ]] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    case $status in
      healthy) echo "healthy after ${waited}s"; return 0 ;;
      unhealthy | exited | dead) echo "status: $status"; return 1 ;;
    esac
    sleep 5
    waited=$(( waited + 5 ))
  done
  echo "timed out (last status: ${status:-unknown})"
  return 1
}

# Everything runs from inside main on one line, so bash has read the whole script before
# `git merge` replaces this file with the new version.
main "$@"; exit $?
