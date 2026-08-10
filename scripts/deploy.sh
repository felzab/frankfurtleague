#!/usr/bin/env bash
#
# SCRIPTS · put a published version live, or report what is live.
#
# It only pulls what `scripts/publish.sh` already built and checked: a server that builds is a server
# that can fail a build, at the worst moment, with the site down and no known-good image to fall back
# to. The commit currently live is read before anything changes, so a failed deploy has a rollback
# target.
#
#   ./scripts/deploy.sh                    deploy the current :latest tag of both packages
#   ./scripts/deploy.sh sha-1a2b3c4        deploy, or ROLL BACK to, one published build
#   ./scripts/deploy.sh --status           report what is running right now, change nothing
#   ./scripts/deploy.sh --help
#
# See:
# - docs/ops/spec.md — the deploy contract this serves, and the tag retention a rollback needs
# - docs/ops/overview.md — why rolling back is pulling a pinned tag rather than rebuilding
# - docs/ops/runbooks.md — what the repository does and does not know about the host it runs on

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

COMPOSE="docker-compose.yml"
PIN=""; STATUS_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --status)  STATUS_ONLY=1 ;;
    --help|-h) usage ;;
    --*)       die "Unknown option: ${arg}. Try --help." ;;
    *)
      # A second tag would silently win over the first, and which one deploys becomes a matter of
      # argument order. Refuse instead.
      [[ -z "$PIN" ]] || die "Two tags given: '${PIN}' and '${arg}'. Deploy pins exactly one build."
      PIN="$arg" ;;
  esac
done

if (( STATUS_ONLY )) && [[ -n "$PIN" ]]; then
  die "--status reports what is running and changes nothing; it does not take a tag.
To deploy ${PIN}, drop --status."
fi

# Validate the pin's shape here, with the other argument handling: a typo fails instantly rather
# than after a platform and Docker check, and without it the registry answers "manifest unknown"
# instead of a sentence naming the problem.
if [[ -n "$PIN" && ! "$PIN" =~ ^sha-[0-9a-f]{7,40}(-dirty)?$ ]]; then
  die "'${PIN}' does not look like a published tag.
Expected sha-<commit>, for example sha-1a2b3c4.
See what is available:  ./scripts/deploy.sh --status"
fi

require_platform linux
require_docker
require_file "$COMPOSE"

# --- --status: answer "what is actually running?" ----------------------------------------------------

# Reads the image's own OCI labels rather than the tag name, because a tag is a moving pointer and
# can be retagged locally. The label is baked in at build time and cannot drift.
if (( STATUS_ONLY )); then
  step "Currently running"
  for svc in frontend backend; do
    cid="$(docker compose -f "$COMPOSE" ps -q "$svc" 2>/dev/null || true)"
    if [[ -z "$cid" ]]; then
      warn "${svc}: not running"
      continue
    fi
    img="$(docker inspect --format '{{.Config.Image}}' "$cid")"
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
    detail "$(printf '%-9s %s' "${svc}:" "$state")" \
           "$(printf '%-9s image    %s' "" "$img")" \
           "$(printf '%-9s commit   %s' "" "$(image_revision_display "$img")")" \
           "$(printf '%-9s built    %s' "" "$(image_created_display "$img")")"
  done
  step "Published builds available to roll back to"
  # Two calls: `docker image ls` accepts at most one repository argument. Matched on the tag, not a
  # `-sha-` substring — the tag is `sha-1a2b3c4` with no service prefix (ADR-0012), so a substring
  # match reports "none pinned" forever.
  { docker image ls "$REPO_FRONTEND" --format '{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}'; \
    docker image ls "$REPO_BACKEND"  --format '{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}'; } \
    | sort | grep -E ':sha-' | detail || \
    info "none pinned locally — pull one first: docker pull ${REPO_FRONTEND}:sha-XXXXXXX"
  exit 0
fi

# --- preflight --------------------------------------------------------------------------------------
# Everything the stack mounts or reads, before the pull rather than after: each failure below is
# instant to detect, and a half-deployed stack is not.
require_file "fl_frontend/.env" "The frontend cannot start without it. Restore it from your password manager."
require_file "fl_backend/.env"  "The backend cannot start without it."
require_file "nginx/prod.conf"  "nginx mounts this read-only; if it is missing, Docker creates a DIRECTORY at that path and nginx fails with 'not a directory'."
require_dir  "certs"            "nginx mounts this read-only for the TLS certificate and key."

# --- pull -------------------------------------------------------------------------------------------
if [[ -n "$PIN" ]]; then
  step "Pinning to ${PIN}"
  docker pull "${REPO_FRONTEND}:${PIN}" || die "No such published tag: ${REPO_FRONTEND}:${PIN}
List what exists locally: docker image ls '${REPO_FRONTEND}'
Published builds are at https://github.com/felzab?tab=packages"
  docker pull "${REPO_BACKEND}:${PIN}"  || die "No such published tag: ${REPO_BACKEND}:${PIN}"
  # Point the moving tags at the pinned build, so compose (which references them) picks it up.
  docker tag "${REPO_FRONTEND}:${PIN}" "$IMAGE_FRONTEND"
  docker tag "${REPO_BACKEND}:${PIN}"  "$IMAGE_BACKEND"
  ok "both :latest tags now point at ${PIN} locally"
else
  step "Pulling the current published images"
  docker pull "$IMAGE_FRONTEND" || die "pull failed for ${IMAGE_FRONTEND}
The packages are public, so this server needs no login. An authentication or
'not found' error almost always means the package was left PRIVATE after a
first push — check https://github.com/felzab?tab=packages"
  docker pull "$IMAGE_BACKEND"  || die "pull failed for ${IMAGE_BACKEND}"
fi

info "frontend commit: $(image_revision_display "$IMAGE_FRONTEND")"
info "backend  commit: $(image_revision_display "$IMAGE_BACKEND")"

# --- remember the current version, for rollback -----------------------------------------------------

# image_revision returns the raw commit, or empty where the image carries no label. Empty is the only
# sentinel, so every test here is a plain -n and no prose reaches a suggested command.
PREV_TAG=""
prev_cid="$(docker compose -f "$COMPOSE" ps -q frontend 2>/dev/null || true)"
if [[ -n "$prev_cid" ]]; then
  PREV_TAG="$(image_revision "$(docker inspect --format '{{.Config.Image}}' "$prev_cid")")"
  if [[ -n "$PREV_TAG" ]]; then
    info "currently live commit: ${PREV_TAG} (rollback target)"
  else
    warn "the running image has no commit label, so there is no automatic rollback target"
  fi
fi

# --- recreate ---------------------------------------------------------------------------------------

# No `docker compose down` first: compose replaces only the services whose image changed, and starts
# the replacement before removing the old container where it can. `down` guarantees a full outage.
step "Recreating containers"
docker compose -f "$COMPOSE" up -d --force-recreate --remove-orphans

step "Waiting for health"
if wait_healthy "$COMPOSE" backend 150 && wait_healthy "$COMPOSE" frontend 180; then
  printf '\n'; ok "Deploy healthy"
  step "Security headers, as served over HTTPS"
  if curl -fsSI https://frankfurtleague.de 2>/dev/null | grep -iE "content-security-policy|strict-transport-security" | detail; then
    :
  else
    warn "Could not read headers over HTTPS — check nginx and the certificates in certs/."
  fi
  # nginx is what actually serves the site, and it has no healthcheck of its own to wait on. Without
  # this, "Deploy healthy" could print while the site is unreachable.
  if [[ -n "$(docker compose -f "$COMPOSE" ps -q nginx 2>/dev/null || true)" ]]; then
    ok "nginx is running"
  else
    warn "nginx is NOT running — the site is unreachable even though the app is healthy."
    warn "Check:  docker compose -f ${COMPOSE} logs nginx"
  fi
  printf '\n'
  detail "What is live:  ./scripts/deploy.sh --status" \
         "Follow logs:   docker compose -f ${COMPOSE} logs -f frontend"
else
  printf '\n'
  warn "THE NEW VERSION IS NOT HEALTHY."
  warn "nginx waits for the frontend to be healthy, so it is not serving this version to anyone."
  printf '\n'
  warn "If the log above says 'Invalid environment variables: <NAMES>', that is the startup gate"
  warn "doing its job: fix those variables in the .env file and run this script again."
  if [[ -n "$PREV_TAG" ]]; then
    printf '\n'
    warn "To roll back to what was working:  ./scripts/deploy.sh sha-${PREV_TAG}"
  else
    printf '\n'
    warn "Rollback targets:  docker image ls '${REPO_FRONTEND}'"
  fi
  exit 1
fi
