#!/usr/bin/env bash
# Target platform: Windows (dev machine). Builds, tags and pushes the images prod will pull.
#
# Replaces the old build_server.sh, which pushed :frontend and :backend with no version tag, from
# whatever the working tree happened to contain, without checking the build succeeded before pushing.
# Two consequences that mattered: you could not tell which commit was running in prod, and there was
# nothing to roll back TO.
#
# Every image now also carries an immutable :sha-<short> tag. :frontend / :backend stay as the moving
# "latest" pointers so nothing on the server has to change.
#
# Usage:
#   ./scripts/publish.sh           # verify tree is clean, build, tag, push
#   ./scripts/publish.sh --allow-dirty   # for a deliberate hotfix; the tag gets a -dirty suffix

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_platform windows
require_docker

ALLOW_DIRTY=0
[[ "${1:-}" == "--allow-dirty" ]] && ALLOW_DIRTY=1
[[ -n "${1:-}" && "${1:-}" != "--allow-dirty" ]] && die "Unknown option: $1"

SHA="$(git_sha)"
if git_clean; then
  TAG="sha-$SHA"
else
  (( ALLOW_DIRTY )) || die "Working tree is dirty. Commit first, or pass --allow-dirty for a deliberate hotfix."
  TAG="sha-$SHA-dirty"
  warn "Publishing a DIRTY tree as $TAG — this image cannot be reproduced from git."
fi

step "Publishing $TAG  (branch $(git rev-parse --abbrev-ref HEAD))"

# Build BOTH before pushing EITHER: a half-published pair is worse than a failed build.
step "Building frontend"
docker build -f fl_frontend/Dockerfile -t "$IMAGE_FRONTEND" -t "felzab/frankfurtleague:$TAG-frontend" fl_frontend \
  || die "frontend build failed — nothing was pushed"
ok "frontend built"

step "Building backend"
docker build -f fl_backend/Dockerfile -t "$IMAGE_BACKEND" -t "felzab/frankfurtleague:$TAG-backend" fl_backend \
  || die "backend build failed — nothing was pushed"
ok "backend built"

step "Pushing"
docker push "$IMAGE_FRONTEND"
docker push "felzab/frankfurtleague:$TAG-frontend"
docker push "$IMAGE_BACKEND"
docker push "felzab/frankfurtleague:$TAG-backend"

printf '\n'; ok "Published $TAG"
printf '      %s\n' "On the server:  ./scripts/deploy.sh"
printf '      %s\n' "To pin/roll back:  ./scripts/deploy.sh $TAG"
