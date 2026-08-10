#!/usr/bin/env bash
#
# SCRIPTS · build both images and push them to GitHub Container Registry.
#
# Both images build, and the frontend is checked for `instrumentation.js`, before either is pushed:
# a half-published pair lets production pull a frontend whose backend does not exist yet. Superseded
# LOCAL sha tags are pruned afterwards, while registry retention stays a hand operation — a botched
# delete destroys the rollback history `scripts/deploy.sh` reads, on the day it is needed most.
#
#   ./scripts/publish.sh                 build and push from a clean tree
#   ./scripts/publish.sh --allow-dirty   deliberate hotfix; the tag gets a -dirty suffix
#   ./scripts/publish.sh --dry-run       build and label, but do not push
#   ./scripts/publish.sh --help
#
# See:
# - ADR-0012 — one public package per service, so a tag says only which build it is
# - docs/ops/spec.md — the registry, the token it needs, and the pruning procedure

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

ALLOW_DIRTY=0; DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --dry-run)     DRY_RUN=1 ;;
    --help|-h) usage ;;
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

TAG_FE="${REPO_FRONTEND}:${QUALIFIER}"
TAG_BE="${REPO_BACKEND}:${QUALIFIER}"

step "Publishing ${QUALIFIER}  (branch ${BRANCH})"
info "frontend -> ${IMAGE_FRONTEND} + ${TAG_FE}"
info "backend  -> ${IMAGE_BACKEND} + ${TAG_BE}"

# --- build both before pushing either ---------------------------------------------------------------

# `deploy.sh --status` reads these labels back, which is how the server answers "which commit is
# live?" without trusting a tag name that can be moved.
build_one() {
  local name="$1" dockerfile="$2" context="$3" moving="$4" pinned="$5"
  step "Building ${name}"
  docker build \
    -f "$dockerfile" \
    -t "$moving" -t "$pinned" \
    --label "org.opencontainers.image.revision=${SHA}" \
    --label "org.opencontainers.image.created=${BUILT_AT}" \
    --label "org.opencontainers.image.source=https://github.com/felzab/frankfurtleague" \
    --label "org.opencontainers.image.version=${QUALIFIER}" \
    "$context" \
    || die "${name} build failed — NOTHING has been pushed, prod is untouched."
  ok "${name} built"
}

build_one "frontend" "fl_frontend/Dockerfile" "fl_frontend" "$IMAGE_FRONTEND" "$TAG_FE"
build_one "backend"  "fl_backend/Dockerfile"  "fl_backend"  "$IMAGE_BACKEND"  "$TAG_BE"

# --- sanity check the frontend image before it can reach prod ---------------------------------------

# At the repo root, instrumentation.ts compiles and passes the test gate, then is silently omitted
# from the standalone output — which disables the startup environment gate and all production error
# logging. One check keeps that out of the registry.
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
  info "Inspect with: docker image ls '${REPO_FRONTEND}'"
  info "          and: docker image ls '${REPO_BACKEND}'"
  exit 0
fi

step "Pushing the moving and pinned tag of each package"
for t in "$IMAGE_FRONTEND" "$TAG_FE" "$IMAGE_BACKEND" "$TAG_BE"; do
  info "pushing ${t}"
  # Progress deliberately NOT suppressed: a first push is minutes of silence otherwise, which is
  # indistinguishable from a hang.
  docker push "$t" || die "push failed for ${t}.
If this is an authentication error, log in with a token carrying write:packages:
  docker login ghcr.io -u felzab"
done
ok "every tag pushed"

# --- prune superseded LOCAL sha tags ---------------------------------------------------------------

# A superseded build keeps its own sha tag, so it never becomes dangling and `docker image prune`
# never reclaims it. The registry is what `scripts/deploy.sh` rolls back from, which makes the local
# sha tag a build byproduct.

# Deliberately after the push loop: everything removed here is already in the registry, the only copy
# deploy.sh reads. `docker image rm` untags, and deletes the image only when no other tag points at
# it — so the moving tags built above are safe.
step "Pruning superseded local sha tags"
# `docker image ls` accepts at most one repository argument, so this is two calls. Passing both
# fails, and the `|| true` below would swallow it — the prune would quietly stop working.
superseded="$( { docker image ls "$REPO_FRONTEND" --format '{{.Repository}}:{{.Tag}}'; \
                 docker image ls "$REPO_BACKEND"  --format '{{.Repository}}:{{.Tag}}'; } \
  | grep -E ':sha-' \
  | grep -vxF -e "$TAG_FE" -e "$TAG_BE" || true)"

if [[ -z "$superseded" ]]; then
  info "none — ${QUALIFIER} is the only build on this machine"
else
  while IFS= read -r old_tag; do
    [[ -n "$old_tag" ]] || continue
    if docker image rm "$old_tag" >/dev/null 2>&1; then
      info "removed ${old_tag}"
    else
      # A running container still using it is the usual cause. Not fatal: the push already succeeded.
      warn "could not remove ${old_tag} — left in place"
    fi
  done <<< "$superseded"
  ok "local sha tags are now ${QUALIFIER} only — older builds remain in the registry"
fi

printf '\n'
ok "Published ${QUALIFIER} from ${BRANCH}"
detail "On the server, deploy it:   ./scripts/deploy.sh" \
       "Or pin exactly this build:  ./scripts/deploy.sh ${QUALIFIER}" \
       "See what is live:           ./scripts/deploy.sh --status"
