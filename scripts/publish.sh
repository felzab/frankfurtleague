#!/usr/bin/env bash
#
# scripts/publish.sh — build the images and push them to GitHub Container Registry.
# TARGET PLATFORM: Windows (your development machine).
#
# WHAT IT DOES, in order:
#   1. refuses to run unless the git working tree is clean (so the tag means something)
#   2. builds the frontend image, then the backend image
#   3. only if BOTH built, pushes all four tags
#   4. removes superseded LOCAL sha tags — never registry ones, see below
#   5. prints the exact command to deploy or roll back to this build
#
# WHY BOTH ARE BUILT BEFORE EITHER IS PUSHED: a half-published pair is worse than a failed build.
# If the backend build fails after the frontend was already pushed, prod can pull a frontend that
# expects a backend which does not exist yet.
#
# WHY LOCAL SHA TAGS ARE PRUNED AND REGISTRY ONES ARE NOT:
#   deploy.sh rolls back by PULLING a pinned tag, so the registry is the rollback mechanism and a
#   local sha tag is only a build byproduct. Left alone they never expire: each publish re-points
#   the moving tag, but the superseded image keeps its own sha tag, so it never becomes dangling
#   and `docker image prune` never reclaims it. That is ~750 MB per publish, accumulating with no
#   upper bound. Pruning happens only after every push has succeeded, so the copy that matters is
#   already in the registry before anything local is touched.
#   Registry retention is deliberately NOT automated: a botched delete destroys rollback history,
#   and rollback is the one thing that must work on your worst day. Prune it by hand, keeping
#   roughly the last five per package. scripts/README.md has the procedure.
#
# TAGS PUSHED (one package per service, so the tag says only which build it is — ADR-0017):
#   ghcr.io/felzab/frankfurtleague-frontend:latest        moving pointer — what deploy.sh pulls
#   ghcr.io/felzab/frankfurtleague-frontend:sha-1a2b3c4   immutable — the rollback target
#   ...and the same two for the backend package.
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
    --label "org.opencontainers.image.source=https://github.com/felzab/frankfurtleague" \
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
  info "Inspect with: docker image ls '${REPO_FRONTEND}'"
  info "          and: docker image ls '${REPO_BACKEND}'"
  exit 0
fi

step "Pushing four tags"
for t in "$IMAGE_FRONTEND" "$TAG_FE" "$IMAGE_BACKEND" "$TAG_BE"; do
  info "pushing ${t}"
  # Progress deliberately NOT suppressed: a first push of a ~370 MB image is minutes of silence
  # otherwise, which is indistinguishable from a hang.
  docker push "$t" || die "push failed for ${t}.
       If this is an authentication error, log in with a token carrying write:packages:
         docker login ghcr.io -u felzab"
done
ok "all four tags pushed"

# --- prune superseded LOCAL sha tags ---------------------------------------------------------------
# Deliberately placed after the push loop: everything removed here is already in the registry, which
# is the only copy deploy.sh reads. `docker image rm` on a tag untags it, and deletes the underlying
# image only when no other tag points at it — so the moving tags built above are never at risk.
step "Pruning superseded local sha tags"
# `docker image ls` accepts at most ONE repository argument, so this is two calls rather than one
# with both. Passing both fails, and the `|| true` below would swallow it — the prune would quietly
# stop working and local sha tags would accumulate again with nothing to show for it.
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
printf '       %s\n' "On the server, deploy it:   ./scripts/deploy.sh"
printf '       %s\n' "Or pin exactly this build:  ./scripts/deploy.sh ${QUALIFIER}"
printf '       %s\n' "See what is live:           ./scripts/deploy.sh --status"
