#!/usr/bin/env bash
# Deploys the latest `main` on the VPS. Run by GitHub Actions over SSH (docs/DEPLOY-CD.md),
# or by hand:  /opt/bytebun-web/scripts/deploy.sh
#
#   1. fast-forward the checkout to origin/main (refuses if the server copy was edited)
#   2. keep the running app image as bytebun-web:previous
#   3. build the new image and restart the app (the database container is left alone)
#   4. wait for the app's health check
#   5. not healthy in time -> switch back to :previous, reset the checkout, exit 1
#      (so the GitHub run fails and GitHub emails you)
#
# Settings (environment variables, all optional):
#   HEALTH_TIMEOUT  seconds to wait for "healthy" (default 240)
#   DEPLOY_BRANCH   branch to deploy (default main)
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
