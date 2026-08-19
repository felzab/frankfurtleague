#!/usr/bin/env bash
#
# SCRIPTS · build both images and push them to GitHub Container Registry.
#
# Both images build, and the frontend is checked for `instrumentation.js`, before either is pushed:
# a half-published pair lets production pull a frontend whose backend does not exist yet. The two
# immutable tags are pushed before the two moving ones, so `:latest` moves as a pair of manifest
# flips rather than across an image upload. Superseded LOCAL sha tags are pruned afterwards, while
# registry retention stays a hand operation — a botched delete destroys the rollback history
# `scripts/deploy.sh` reads, on the day it is needed most.
#
#   ./scripts/publish.sh                 build and push from a clean tree
#   ./scripts/publish.sh --allow-dirty   deliberate hotfix; the tag gets a -dirty suffix
#   ./scripts/publish.sh --dry-run       build and label, but do not push
#   ./scripts/publish.sh --verbose       stream each command's own output instead of capturing it
#   ./scripts/publish.sh --help
#
# See:
# - docs/ops/spec.md — the registry, the token it needs, and the pruning procedure

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

ALLOW_DIRTY=0; DRY_RUN=0
# shellcheck disable=SC2034  # the --verbose arm assigns VERBOSE for _lib.sh's `quietly`
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --dry-run)     DRY_RUN=1 ;;
    --verbose)     VERBOSE=1 ;;
    --help|-h) usage ;;
    *)             die "Unknown option: ${arg}. Try --help." ;;
  esac
done

require_platform windows
require_docker

section "preflight"

step "The tree this build comes from"
require_file "fl_frontend/Dockerfile"
require_file "fl_backend/Dockerfile"

SHA="$(git_sha)"
BRANCH="$(git_branch)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if git_clean; then
  QUALIFIER="sha-${SHA}"
  ok "clean at ${SHA} on ${BRANCH}"
else
  (( ALLOW_DIRTY )) || die "The working tree has uncommitted changes.
A tag naming a commit must be reproducible FROM that commit, and this one would not be.
Commit your work, or pass --allow-dirty for a deliberate hotfix."
  # A fingerprint of the tree, not just the commit: two hotfix builds from one commit are two
  # different images, and one shared tag lets the second replace the first in the registry — a
  # moving tag inside the class that exists to be immutable.
  DIRTY_ID="$( { git diff HEAD; git ls-files --others --exclude-standard -z | xargs -0 -r cat 2>/dev/null || true; } \
    | sha1sum | cut -c1-7 )"
  QUALIFIER="sha-${SHA}-dirty-${DIRTY_ID}"
  warn "Publishing an uncommitted tree as ${QUALIFIER} — this image cannot be rebuilt from git.
The fingerprint is of the tracked diff plus every untracked file, so it tells two hotfix
builds of ${SHA} apart; it says nothing about which of them is which."
  ok "dirty at ${SHA} on ${BRANCH}"
fi

# `:latest` is production's default pull target and a `sha-` tag is a rollback target, so both name
# a commit somebody else must resolve (docs/ops/spec.md I12). Any remote branch clears the bar, so
# a release or a hotfix branch still publishes.
step "The commit this build names"

# Each remote is asked what it has, rather than `git branch -r`, whose tracking refs are a local
# cache: a branch deleted upstream answers `--contains` until something prunes it.
ON_REMOTE=0
UNASKED=()
while IFS= read -r remote; do
  [[ -n "$remote" ]] || continue
  # A remote wanting credentials would otherwise hang the publish on a prompt nobody is watching.
  heads="$(GIT_TERMINAL_PROMPT=0 git ls-remote --heads "$remote")" || { UNASKED+=("$remote"); continue; }
  while IFS=$'\t' read -r tip _; do
    [[ -n "$tip" ]] || continue
    # Only a tip this clone holds can be tested, so a branch somebody else advanced since the last
    # fetch is skipped rather than believed.
    if git merge-base --is-ancestor HEAD "$tip" 2>/dev/null; then ON_REMOTE=1; break 2; fi
  done <<< "$heads"
done <<< "$(git remote)"

if (( ! ON_REMOTE )); then
  # A remote that could not answer leaves the bar unproven rather than failed: the commit
  # may well be on it, and nothing read here says otherwise.
  if (( ${#UNASKED[@]} )); then
    # One command per remote: `git ls-remote` takes one repository and reads a later name as a ref
    # pattern, so a joined command asks the first alone — and answers exit 0 in silence once that
    # one is reachable, which reads as this refusal disproved.
    unasked_names="$(printf '%s, ' "${UNASKED[@]}")"; unasked_names="${unasked_names%, }"
    unasked_cmds="$(printf '\n  git ls-remote --heads %s' "${UNASKED[@]}")"
    refuse "could not get a branch list from ${unasked_names} — so nothing establishes that
${SHA} is fetchable, and ${QUALIFIER} would name it. NOTHING has been built or pushed.
Ask by hand:${unasked_cmds}"
  fi
  die "HEAD is on no branch a remote has, so ${QUALIFIER} would name a commit nobody else can
resolve, and :latest would move to it. Push the branch first. Only a branch tip this clone holds can
be tested, so run 'git fetch' if the branch carrying HEAD has moved on elsewhere."
fi
ok "${SHA} is on a branch a remote has"

TAG_FE="${REPO_FRONTEND}:${QUALIFIER}"
TAG_BE="${REPO_BACKEND}:${QUALIFIER}"

info "frontend -> ${TAG_FE} + ${IMAGE_FRONTEND}"
info "backend  -> ${TAG_BE} + ${IMAGE_BACKEND}"

# --- build both before pushing either ---------------------------------------------------------------

section "build"

# `deploy.sh` reads these labels back, which is how the server answers "which commit is live?" and
# "which tag do I roll back to?" without trusting a name that moves. `version` holds the whole
# qualifier, fingerprint included; `revision` the commit.
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
PROBE_RC=0
quietly docker run --rm --entrypoint sh "$IMAGE_FRONTEND" -c '[ -f .next/server/instrumentation.js ]' || PROBE_RC=$?
if (( PROBE_RC == 0 )); then
  ok "instrumentation.js is in the image (env gate + error logging will run)"
elif (( PROBE_RC == 1 )); then
  die "instrumentation.js is MISSING from the frontend image.
It must live at fl_frontend/src/instrumentation.ts — from the repo root it is dropped
from output:\"standalone\" without any error. NOTHING has been pushed."
else
  # 1 is the test's own answer; anything above it is docker's — no `sh` in the image, a container
  # that would not start — and says nothing about the file either way.
  refuse "the probe container did not run (exit ${PROBE_RC}), so whether instrumentation.js reached
the image is unknown. NOTHING has been pushed. Ask the image directly:
  docker run --rm --entrypoint sh ${IMAGE_FRONTEND} -c 'ls .next/server'"
fi

if (( DRY_RUN )); then
  end_section
  detail "Inspect with: docker image ls '${REPO_FRONTEND}'" \
         "         and: docker image ls '${REPO_BACKEND}'"
  finish "Dry run — images built and labelled locally, nothing pushed."
fi

# --- push -------------------------------------------------------------------------------------------

section "push"

push_one() {
  # Progress deliberately NOT captured: a first push is minutes of silence otherwise, which is
  # indistinguishable from a hang. `$2` is what this particular failure leaves behind, which the
  # caller knows and a helper pushing one name cannot.
  info "pushing $1"
  docker push "$1" || die "push failed for $1.
If this is an authentication error, log in with a token carrying write:packages:
  docker login ghcr.io -u felzab${2:+

$2}"
}

# The immutable tags first, because they carry every layer. `deploy.sh` follows `:latest` or an
# explicit pin and never sees these, so nothing in production can reach a half-pushed pair while they
# upload.
step "Pushing the pinned tag of each package"
push_one "$TAG_FE"
push_one "$TAG_BE"
ok "${QUALIFIER} is in the registry for both packages"

# Both layer sets are already up there, so each of these is a manifest write: the window in which the
# registry serves a new frontend against an old backend is the gap between two sub-second flips
# rather than the length of an image upload.
step "Moving the :latest tag of each package"
push_one "$IMAGE_FRONTEND"
push_one "$IMAGE_BACKEND" "THE FRONTEND'S :latest HAS ALREADY MOVED to ${QUALIFIER} and the backend's
has not, so './scripts/deploy.sh' with no tag would ship a mismatched pair. Both pinned tags ARE in
the registry: deploy ./scripts/deploy.sh ${QUALIFIER}, or re-run this script to move the pair."
ok "both moving tags now point at ${QUALIFIER}"

# --- prune superseded LOCAL sha tags ---------------------------------------------------------------

# A superseded build keeps its own sha tag, so it never becomes dangling and `docker image prune`
# never reclaims it. The registry is what `scripts/deploy.sh` rolls back from, which makes the local
# sha tag a build byproduct.

# Deliberately after the push loop: everything removed here is already in the registry, the only copy
# deploy.sh reads. `docker image rm` untags, and deletes the image only when no other tag points at
# it — so the moving tags built above are safe.
section "prune"

step "Pruning superseded local sha tags"
# `docker image ls` accepts at most one repository argument, so this is two calls, each read on its
# own: a listing that FAILED is empty too, and reported as "none" it describes this machine from a
# command that never answered.
LS_RC=0
listed_fe="$(docker image ls "$REPO_FRONTEND" --format '{{.Repository}}:{{.Tag}}')" || LS_RC=$?
listed_be="$(docker image ls "$REPO_BACKEND"  --format '{{.Repository}}:{{.Tag}}')" || LS_RC=$?
superseded="$(printf '%s\n%s\n' "$listed_fe" "$listed_be" \
  | grep -E ':sha-' \
  | grep -vxF -e "$TAG_FE" -e "$TAG_BE" || true)"

if (( LS_RC )); then
  warn "could not list this machine's images (exit ${LS_RC}), so nothing was pruned and nothing here
says what is left behind. Every build is already in the registry, which is what deploy.sh reads.
Clean up by hand:  docker image ls '${REPO_FRONTEND}'"
elif [[ -z "$superseded" ]]; then
  ok "none — ${QUALIFIER} is the only build on this machine"
else
  removed=0
  while IFS= read -r old_tag; do
    [[ -n "$old_tag" ]] || continue
    if docker image rm "$old_tag" >/dev/null 2>&1; then
      removed=$(( removed + 1 ))
    else
      # A running container still using it is the usual cause. Not fatal: the push already succeeded.
      warn "could not remove ${old_tag} — left in place"
    fi
  done <<< "$superseded"
  ok "${removed} superseded local tag(s) removed — older builds remain in the registry"
fi

end_section
detail "On the server, deploy it:   ./scripts/deploy.sh" \
       "Or pin exactly this build:  ./scripts/deploy.sh ${QUALIFIER}" \
       "See what is live:           ./scripts/deploy.sh --status"
finish "Published ${QUALIFIER} from ${BRANCH}."
