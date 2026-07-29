#!/usr/bin/env bash
#
# scripts/publish.sh — build the images and push them to Docker Hub.
# TARGET PLATFORM: Windows (your development machine).
#
# WHAT IT DOES, in order:
#   1. refuses to run unless the git working tree is clean (so the tag means something)
#   2. builds the frontend image, then the backend image
#   3. only if BOTH built, pushes all four tags
#   4. prints the exact command to deploy or roll back to this build
#
# WHY BOTH ARE BUILT BEFORE EITHER IS PUSHED: a half-published pair is worse than a failed build.
# If the backend build fails after the frontend was already pushed, prod can pull a frontend that
# expects a backend which does not exist yet.
#
# TAGS PUSHED (Docker Hub free plan = one private repo, so tags separate the services):
#   frankfurtleague:frontend                  moving pointer — what deploy.sh pulls by default
#   frankfurtleague:frontend-sha-1a2b3c4      immutable — the rollback target
#   ...and the same two for backend.
#
# Every image also carries OCI labels recording the commit and build time, so the server can report
# what is running without trusting the tag name.
#
# USAGE:
#   ./scripts/publish.sh                 build and push from a clean tree
#   ./scripts/publish.sh --allow-dirty   deliberate hotfix; tag gets a -dirty suffix
#   ./scripts/publish.sh --dry-run       build and label, but do not push
#   ./scripts/publish.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

ALLOW_DIRTY=0; DRY_RUN=0
for arg in "${@:-}"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --dry-run)     DRY_RUN=1 ;;
    --help|-h) usage ;;
    "")            ;;
    *)             die "Unknown option: ${arg}. Try --help." ;;
  esac
done

require_platform windows
require_docker

require_file "fl_frontend/Dockerfile"
require_file "fl_backend/Dockerfile"

SHA="$(git_sha)"
BRANCH="$(git_branch)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if git_clean; then
  QUALIFIER="sha-${SHA}"
else
  (( ALLOW_DIRTY )) || die "The working tree has uncommitted changes.
       A tag naming a commit must be reproducible FROM that commit, and this one would not be.
       Commit your work, or pass --allow-dirty for a deliberate hotfix."
  QUALIFIER="sha-${SHA}-dirty"
  warn "Publishing an uncommitted tree as ${QUALIFIER} — this image cannot be rebuilt from git."
fi

TAG_FE="${DOCKER_REPO}:frontend-${QUALIFIER}"
TAG_BE="${DOCKER_REPO}:backend-${QUALIFIER}"

step "Publishing ${QUALIFIER}  (branch ${BRANCH})"
info "frontend -> ${IMAGE_FRONTEND} + ${TAG_FE}"
info "backend  -> ${IMAGE_BACKEND} + ${TAG_BE}"

# --- build both before pushing either ---------------------------------------------------------------
# OCI labels are the standard, tool-readable way to record provenance. `deploy.sh --status` reads them
# back, which is how the server answers "which commit is live?" reliably.
build_one() {
  local name="$1" dockerfile="$2" context="$3" moving="$4" pinned="$5"
  step "Building ${name}"
  docker build \
    -f "$dockerfile" \
    -t "$moving" -t "$pinned" \
    --label "org.opencontainers.image.revision=${SHA}" \
    --label "org.opencontainers.image.created=${BUILT_AT}" \
    --label "org.opencontainers.image.source=https://github.com/felixzabb/frankfurtleague" \
    --label "org.opencontainers.image.version=${QUALIFIER}" \
    "$context" \
    || die "${name} build failed — NOTHING has been pushed, prod is untouched."
  ok "${name} built"
}

build_one "frontend" "fl_frontend/Dockerfile" "fl_frontend" "$IMAGE_FRONTEND" "$TAG_FE"
build_one "backend"  "fl_backend/Dockerfile"  "fl_backend"  "$IMAGE_BACKEND"  "$TAG_BE"

# --- sanity check the frontend image before it can reach prod ---------------------------------------
# At the repo root, instrumentation.ts compiles and passes the whole test gate, and is then silently
# omitted from the standalone output — which disables the startup environment gate AND all production
# error logging. One cheap check stops that ever shipping again.
step "Checking the frontend image is sound"
if docker run --rm --entrypoint sh "$IMAGE_FRONTEND" -c '[ -f .next/server/instrumentation.js ]'; then
  ok "instrumentation.js is in the image (env gate + error logging will run)"
else
  die "instrumentation.js is MISSING from the frontend image.
       It must live at fl_frontend/src/instrumentation.ts — from the repo root it is dropped
       from output:\"standalone\" without any error. NOTHING has been pushed."
fi

if (( DRY_RUN )); then
  printf '\n'; ok "Dry run complete — images built and labelled locally, nothing pushed."
  info "Inspect with: docker image ls '${DOCKER_REPO}'"
  exit 0
fi

step "Pushing four tags"
for t in "$IMAGE_FRONTEND" "$TAG_FE" "$IMAGE_BACKEND" "$TAG_BE"; do
  info "pushing ${t}"
  docker push "$t" >/dev/null || die "push failed for ${t}.
       If this is an authentication error, run: docker login -u felzab"
done
ok "all four tags pushed"

printf '\n'
ok "Published ${QUALIFIER} from ${BRANCH}"
printf '       %s\n' "On the server, deploy it:   ./scripts/deploy.sh"
printf '       %s\n' "Or pin exactly this build:  ./scripts/deploy.sh ${QUALIFIER}"
printf '       %s\n' "See what is live:           ./scripts/deploy.sh --status"
