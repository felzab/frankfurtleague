#!/usr/bin/env bash
#
# SCRIPTS · put a published version live, or report what is live.
#
# It only pulls what `scripts/publish.sh` already built: a server that builds is a server that can
# fail a build with the site down and nothing to fall back to. What is live is read by image ID
# during preflight, so a failed deploy has a rollback target the pull cannot have moved.
#
#   ./scripts/deploy.sh                    deploy the current :latest tag of both packages
#   ./scripts/deploy.sh sha-1a2b3c4        deploy, or ROLL BACK to, one published build
#   ./scripts/deploy.sh --status           report what is running right now, change nothing
#   ./scripts/deploy.sh --verbose          stream each command's own output instead of capturing it
#   ./scripts/deploy.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

COMPOSE="docker-compose.yml"

# An older engine REFUSES the create rather than ignoring `start_interval:`, and `--force-recreate`
# has stopped what was running by then — so preflight asks, rather than the deploy.
ENGINE_MIN=25

# One shape, for what the operator types and for a label read off a running image. The fingerprint
# is optional so an older image's label still names a rollback target.
PIN_RE='^sha-[0-9a-f]{7,40}(-dirty(-[0-9a-f]{7})?)?$'

PIN=""; STATUS_ONLY=0
# shellcheck disable=SC2034  # the --verbose arm assigns VERBOSE for _lib.sh's `quietly`
for arg in "$@"; do
  case "$arg" in
    --status)  STATUS_ONLY=1 ;;
    --verbose) VERBOSE=1 ;;
    --help|-h) usage ;;
    --*)       die "Unknown option: ${arg}. Try --help." ;;
    *)
      # A second tag would silently win over the first, and which one deploys becomes a matter of
      # argument order. Stop instead.
      [[ -z "$PIN" ]] || die "Two tags given: '${PIN}' and '${arg}'. Deploy pins exactly one build."
      PIN="$arg" ;;
  esac
done

if (( STATUS_ONLY )) && [[ -n "$PIN" ]]; then
  die "--status reports what is running and changes nothing; it does not take a tag.
To deploy ${PIN}, drop --status."
fi

# Validated with the other argument handling: without it the registry answers "manifest unknown"
# after a platform and Docker check, instead of a sentence naming the problem.
if [[ -n "$PIN" && ! "$PIN" =~ $PIN_RE ]]; then
  die "'${PIN}' does not look like a published tag.
Expected sha-<commit>, for example sha-1a2b3c4.
See what is available:  ./scripts/deploy.sh --status"
fi

require_platform linux
require_docker
require_file "$COMPOSE"

# `revision` is the commit alone, so a rollback built from it names a tag that was never pushed when
# the previous deploy was dirty; `version` carries the whole qualifier.
published_tag() {
  local value=""
  # Returns 1 where the inspect itself failed, so a caller can tell "this image carries no such
  # label" from "nothing answered" — only the first may skip a comparison.
  value="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$1" 2>/dev/null)" \
    || return 1
  [[ "$value" == "<no value>" ]] && value=""
  printf '%s' "$value"
}

# An ID cannot move. `.Config.Image` is the REFERENCE it was created with, and every tag in this
# script's vocabulary moves.
running_image() {
  docker inspect --format '{{.Image}}' "$1"
}

# The status is the caller's to read: a failure and an answer of "nothing" are both empty output,
# and reading the first as the second prints "not running" about a stack this never asked.
service_cid() {
  docker compose -f "$COMPOSE" ps -q "$1" 2>/dev/null
}

# --- --status: answer "what is actually running?" ----------------------------------------------------

if (( STATUS_ONLY )); then
  section "status"
  step "Currently running"
  running=0
  # Set wherever the host declined to answer: a question nobody answered leaves this report stating
  # nothing, and the refusal below is that ending.
  UNANSWERED=0
  RUNNING_FE=""; RUNNING_BE=""
  for svc in frontend backend; do
    ps_rc=0
    cid="$(service_cid "$svc")" || ps_rc=$?
    if (( ps_rc )); then
      warn "${svc}: compose could not answer (exit ${ps_rc}), which is not the same as not running.
Ask it directly:  docker compose -f ${COMPOSE} ps"
      UNANSWERED=1
      continue
    fi
    if [[ -z "$cid" ]]; then
      warn "${svc}: not running"
      continue
    fi
    # The container can be removed between `ps` and `inspect`, and an unguarded read takes the error
    # trap, turning a report that changes nothing into a crash.
    img_id="$(running_image "$cid")" || img_id=""
    if [[ -z "$img_id" ]]; then
      warn "${svc}: the container compose named is already gone, so nothing about it could be read"
      UNANSWERED=1
      continue
    fi
    running=$(( running + 1 ))
    short_id="${img_id#sha256:}"
    tag_rc=0
    tag="$(published_tag "$img_id")" || tag_rc=1
    # An unread label is not an absent one, and this row is what a registry is pruned from.
    if (( tag_rc )); then
      UNANSWERED=1
      tag_cell="could not be read"
    else
      tag_cell="${tag:-unlabelled (not built by publish.sh)}"
    fi
    case "$svc" in frontend) RUNNING_FE="$tag" ;; backend) RUNNING_BE="$tag" ;; esac
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")" || state="unreadable"
    detail "$(printf '%-9s %s' "${svc}:" "$state")" \
           "$(printf '%-9s image    %s' "" "${short_id:0:12}")" \
           "$(printf '%-9s tag      %s' "" "$tag_cell")" \
           "$(printf '%-9s commit   %s' "" "$(image_revision_display "$img_id")")" \
           "$(printf '%-9s built    %s' "" "$(image_created_display "$img_id")")"
  done
  if (( running )); then ok "${running} service(s), read from the image each container is running"; fi

  # The two packages move independently, so a host can serve a pair no single build names — and
  # each service is healthy against its own half, so these rows are the only place it shows.
  if [[ -n "$RUNNING_FE" && -n "$RUNNING_BE" && "$RUNNING_FE" != "$RUNNING_BE" ]]; then
    fail "the two services are running different builds: frontend ${RUNNING_FE}, backend ${RUNNING_BE}.
Deploy the build both packages have:  ./scripts/deploy.sh ${RUNNING_BE}"
  fi

  step "Published builds available to roll back to"
  # Two calls: `docker image ls` accepts at most one repository argument. Matched on the tag, not a
  # `-sha-` substring — the tag carries no service prefix, so that would report "none" forever.
  local_tags="$( { docker image ls "$REPO_FRONTEND" --format '{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}'; \
                   docker image ls "$REPO_BACKEND"  --format '{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}'; } | sort)"
  # Never `grep -q` in a pipeline: it closes the pipe on its first match, so under `pipefail` the
  # writer's SIGPIPE fails the pipeline exactly when there WAS a match.
  pinned="$(printf '%s\n' "$local_tags" | grep -E ':sha-' || true)"
  if [[ -n "$pinned" ]]; then
    printf '%s\n' "$pinned" | detail
    ok "$(printf '%s\n' "$pinned" | wc -l | tr -d ' ') pinned build(s) on this host"
  else
    info "none pinned locally — pull one first: docker pull ${REPO_FRONTEND}:sha-XXXXXXX"
    ok "the registry still has them: https://github.com/felzab?tab=packages"
  fi
  if (( UNANSWERED )); then
    refuse "This is not a statement of what is live: something above could not be asked, and an
unasked service reads exactly like a stopped one. Registry pruning is decided from this
report (docs/ops/spec.md §1.5), so delete nothing until it answers."
  fi
  finish
fi

# --- preflight --------------------------------------------------------------------------------------

section "preflight"

# Everything the stack mounts or reads, before the pull rather than after: each failure below is
# instant to detect, and a half-deployed stack is not.
step "Files and directories the stack mounts"
require_file "fl_frontend/.env" "The frontend cannot start without it. Restore it from your password manager."
require_file "fl_backend/.env"  "The backend cannot start without it."
require_file "nginx/prod.conf"  "nginx mounts this read-only; if it is missing, Docker creates a DIRECTORY at that path and nginx fails with 'not a directory'."
require_dir  "certs"            "nginx mounts this read-only for the TLS certificate and key."
ok "all present"

step "Docker Engine version"
ENGINE="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
ENGINE_MAJOR="${ENGINE%%.*}"
if [[ ! "$ENGINE_MAJOR" =~ ^[0-9]+$ ]] || (( ENGINE_MAJOR < ENGINE_MIN )); then
  die "This host reports Docker Engine '${ENGINE:-none}', and ${COMPOSE} needs ${ENGINE_MIN} or newer.
An older engine refuses a healthcheck start_interval outright, and the refusal arrives at
container-create time — which is after the running containers would have been stopped.
NOTHING has been stopped or pulled: the site is still serving what it was serving.
Upgrade the engine, or drop the start_interval lines from both compose files."
fi
ok "engine ${ENGINE}, which is ${ENGINE_MIN} or newer"

# --- the build now live, read before anything moves --------------------------------------------------

step "The build now live"
PREV_PIN=""
PS_RC=0
RECORDED=1
# An empty answer from a compose that FAILED would otherwise print "nothing is running" and discard
# the rollback target on the one run that needs it.
prev_cid="$(service_cid frontend)" || PS_RC=$?
if (( PS_RC )); then
  RECORDED=0
  warn "compose could not say what is running (exit ${PS_RC}), so this deploy has no rollback target it can name.
Ask it directly:  docker compose -f ${COMPOSE} ps"
elif [[ -z "$prev_cid" ]]; then
  info "nothing is running here yet, so this deploy has nothing to roll back to"
else
  # Guarded for the same reason as the `--status` read: the container can go between `ps` and
  # `inspect`, and an unread image is not an unlabelled one.
  prev_img="$(running_image "$prev_cid")" || prev_img=""
  if [[ -z "$prev_img" ]]; then
    RECORDED=0
    warn "the running container's image could not be read, so this deploy has no rollback target it can name"
  else
    PREV_RC=0
    PREV_PIN="$(published_tag "$prev_img")" || PREV_RC=1
    info "commit $(image_revision_display "$prev_img"), built $(image_created_display "$prev_img")"
    if (( PREV_RC )); then
      RECORDED=0
      PREV_PIN=""
      warn "the running image's build label could not be read, so this deploy has no rollback target it can name"
    elif [[ "$PREV_PIN" =~ $PIN_RE ]]; then
      info "rollback target: ${PREV_PIN}"
    else
      PREV_PIN=""
      warn "the running image carries no published-tag label, so this deploy has no automatic rollback target"
    fi
  fi
fi
# Only where something was read. A verdict on the branch above that recorded nothing is a pass
# printed directly beneath the line saying the opposite.
if (( RECORDED )); then ok "recorded before anything is pulled or recreated"; fi

# --- pull -------------------------------------------------------------------------------------------

section "pull"

if [[ -n "$PIN" ]]; then
  step "Pinning to ${PIN}"
  info "pulling ${REPO_FRONTEND}:${PIN} and ${REPO_BACKEND}:${PIN}"
  docker pull "${REPO_FRONTEND}:${PIN}" || die "No such published tag: ${REPO_FRONTEND}:${PIN}
List what exists locally: docker image ls '${REPO_FRONTEND}'
Published builds are at https://github.com/felzab?tab=packages"
  docker pull "${REPO_BACKEND}:${PIN}"  || die "No such published tag: ${REPO_BACKEND}:${PIN}"
  # Only now, with both pulls behind us, do the moving tags compose reads by name move.
  quietly docker tag "${REPO_FRONTEND}:${PIN}" "$IMAGE_FRONTEND" || die "could not point ${IMAGE_FRONTEND} at ${PIN}."
  quietly docker tag "${REPO_BACKEND}:${PIN}"  "$IMAGE_BACKEND"  || die "could not point ${IMAGE_BACKEND} at ${PIN}.
The frontend tag has already moved, so this host's pair is mismatched: re-run this command."
  ok "both :latest tags now point at ${PIN} locally"
else
  step "Pulling the current published images"
  # What :latest names before the pull moves it, so a failed second pull leaves no new frontend
  # beside an old backend. `image ls`, not `inspect`, which reads an absent image and a dead daemon
  # alike where only the second may skip the restore.
  BEFORE_RC=0
  before_fe="$(docker image ls --quiet --no-trunc "$IMAGE_FRONTEND" 2>/dev/null)" || BEFORE_RC=$?
  docker pull "$IMAGE_FRONTEND" || die "pull failed for ${IMAGE_FRONTEND}
The packages are public, so this server needs no login. An authentication or
'not found' error almost always means the package was left PRIVATE after a
first push — check https://github.com/felzab?tab=packages"
  if ! docker pull "$IMAGE_BACKEND"; then
    if (( BEFORE_RC )); then
      warn "what ${IMAGE_FRONTEND} named before this run could not be read (exit ${BEFORE_RC}), so the
frontend tag cannot be put back. This host's pair may be mismatched until a deploy pulls both again:
  ./scripts/deploy.sh --status"
    elif [[ -n "$before_fe" ]]; then
      if quietly docker tag "$before_fe" "$IMAGE_FRONTEND"; then
        info "the frontend tag was put back to the image it named before this run"
      else
        warn "could not put the frontend tag back — this host's pair stays mismatched until the next deploy"
      fi
    fi
    die "pull failed for ${IMAGE_BACKEND} — nothing has been recreated, and the site is untouched."
  fi
  ok "both packages pulled"
fi

info "frontend commit: $(image_revision_display "$IMAGE_FRONTEND")"
info "backend  commit: $(image_revision_display "$IMAGE_BACKEND")"

# A publish that moved one tag and failed on the other leaves a pair no tag names. Three answers
# rather than two, because a label nobody could read is not an absent one.
FE_RC=0; BE_RC=0
FE_BUILD="$(published_tag "$IMAGE_FRONTEND")" || FE_RC=1
BE_BUILD="$(published_tag "$IMAGE_BACKEND")"  || BE_RC=1
if (( FE_RC || BE_RC )); then
  refuse "the pulled images' build labels could not be read, so nothing says whether these two
packages are the same build. NOTHING has been recreated. Pin the build explicitly instead:
  ./scripts/deploy.sh <tag>       (./scripts/deploy.sh --status lists them)"
elif [[ -z "$FE_BUILD" || -z "$BE_BUILD" ]]; then
  warn "one of the pulled images carries no published-tag label, so this deploy is NOT verified as a
matched pair. An image not built by publish.sh is the usual cause."
elif [[ "$FE_BUILD" != "$BE_BUILD" ]]; then
  die "The two :latest tags are different builds: frontend ${FE_BUILD}, backend ${BE_BUILD}.
A publish that moved one and failed on the other leaves exactly this pair, and nothing downstream
sees it: each service is healthy against its own half. NOTHING has been recreated.
Deploy the build both packages have:  ./scripts/deploy.sh ${BE_BUILD}"
fi

# --- recreate ---------------------------------------------------------------------------------------

section "deploy"

# No `docker compose down` first: compose replaces only the services whose image changed, and starts
# the replacement before removing the old container where it can. `down` guarantees a full outage.
step "Recreating containers"
# Guarded, not bare: nginx depends on both services being HEALTHY, so `up` exits non-zero on an
# unhealthy deploy and an unguarded call would skip the diagnostics and the rollback advice.
UP_RC=0
quietly docker compose -f "$COMPOSE" up -d --force-recreate --remove-orphans || UP_RC=$?
if (( UP_RC )); then
  fail "compose could not bring the stack up (exit ${UP_RC}); each service is asked what happened below"
else
  ok "containers recreated"
fi

step "Waiting for health"
HEALTHY=1
# Both are waited on even when the first fails: chaining them means one deploy reports one problem,
# and the second is discovered by deploying again.
wait_healthy "$COMPOSE" backend 150  || HEALTHY=0
wait_healthy "$COMPOSE" frontend 180 || HEALTHY=0
if (( UP_RC )); then HEALTHY=0; fi

# `wait_healthy` answers 1 for "reports UNHEALTHY" and "could not ask compose" alike, and only the
# first is a verdict on this build. Asking compose again separates them.
if (( ! HEALTHY && ! UP_RC )); then
  # Not where `up` itself exited non-zero: the recreate was attempted and did not complete, so this
  # deploy has a verdict whether or not the daemon answered afterwards.
  ASK_RC=0
  service_cid backend  >/dev/null || ASK_RC=$?
  service_cid frontend >/dev/null || ASK_RC=$?
  if (( ASK_RC )); then
    refuse "compose cannot be asked about this stack (exit ${ASK_RC}), so nothing here says whether
the new version is healthy — and the containers WERE recreated, so the site's state is unknown too.
Ask it directly:  docker compose -f ${COMPOSE} ps"
  fi
fi

if (( HEALTHY )); then
  ok "both services are healthy"

  section "checks"
  SITE_VERIFIED=1
  step "Security headers, as served over HTTPS"
  headers="$(curl -fsSI https://frankfurtleague.de 2>/dev/null | grep -iE "content-security-policy|strict-transport-security" || true)"
  if [[ -n "$headers" ]]; then
    printf '%s\n' "$headers" | detail
    ok "the edge is serving them"
  else
    SITE_VERIFIED=0
    warn "Could not read the headers over HTTPS — check nginx and the certificates in certs/."
  fi

  # nginx is what actually serves the site, and it has no healthcheck of its own to wait on. Without
  # this, "healthy" could print while the site is unreachable.
  step "nginx"
  NGINX_RC=0
  nginx_cid="$(service_cid nginx)" || NGINX_RC=$?
  if (( NGINX_RC )); then
    refuse "compose could not say whether nginx is running (exit ${NGINX_RC}), so nothing establishes
that the site serves this build — and after --force-recreate that is the one thing left to establish.
Ask it directly:  docker compose -f ${COMPOSE} ps"
  elif [[ -n "$nginx_cid" ]]; then
    ok "running"
  else
    fail "nginx is NOT running — the site is unreachable even though the app is healthy."
    detail "Check:  docker compose -f ${COMPOSE} logs nginx"
  fi

  end_section
  detail "What is live:  ./scripts/deploy.sh --status" \
         "Follow logs:   docker compose -f ${COMPOSE} logs -f frontend"
  # The sentence is a claim about the live site, so neither `curl` nor the nginx query above may
  # leave it unqualified.
  if (( SITE_VERIFIED )); then finish "The pulled build is live."; else finish; fi
else
  fail "THE NEW VERSION IS NOT HEALTHY."
  detail "nginx waits for the frontend to be healthy, so it is not serving this version to anyone." \
         "If a log above says 'Invalid environment variables: <NAMES>', that is the startup gate" \
         "doing its job: fix those names in the .env file and run this script again."
  if [[ -n "$PREV_PIN" ]]; then
    detail "" "To roll back to what was working:  ./scripts/deploy.sh ${PREV_PIN}"
  else
    detail "" "Rollback targets:  docker image ls '${REPO_FRONTEND}'"
  fi
  finish
fi
