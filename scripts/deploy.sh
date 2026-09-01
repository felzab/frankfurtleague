#!/usr/bin/env bash
#
# SCRIPTS · put a published version live, or report what is live.
#
# It only pulls what `scripts/publish.sh` already built: a server that builds is a server that can
# fail a build with the site down and nothing to fall back to. What is live is read by image ID
# during preflight, so a failed deploy has a rollback target the pull cannot have moved -- and a
# build that never becomes healthy is put back to it without waiting for anybody.
#
#   ./scripts/deploy.sh                    deploy the current :latest tag of both packages
#   ./scripts/deploy.sh sha-1a2b3c4        deploy, or ROLL BACK to, one published build
#   ./scripts/deploy.sh --status           report what is running and what the edge serves, change nothing
#   ./scripts/deploy.sh --verbose          stream each command's own output instead of capturing it
#   ./scripts/deploy.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

COMPOSE="docker-compose.yml"

# One spelling for the deploy's check of the edge and `--status`'s alike: `docs/ops/spec.md` §4 lists
# every site an API version bump has to reach, and a second copy here would be one more.
PROBE_URL="https://frankfurtleague.de/api/v0/system/is_live"

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

# Answers 2 wherever the edge's state could not be ESTABLISHED -- compose declining to answer, or to
# act -- which a caller has to be able to tell from a definite "the edge is not serving this build".
serve_through_nginx() {
  local before after rc=0
  before="$(service_cid nginx)" || rc=$?
  if (( rc )); then
    warn "compose could not say whether nginx is running (exit ${rc}), so nothing here establishes that
the site serves this build.
Ask it directly:  docker compose -f ${COMPOSE} ps"
    return 2
  fi
  # Everything recreating the application pair left alone: an nginx that was not running, a change to
  # its own service definition, and a container belonging to no service this compose file defines.
  if ! quietly docker compose -f "$COMPOSE" up -d --remove-orphans; then
    # A compose that could not act is not a problem the run survives: nothing below it ran, so the
    # edge is unreloaded and unread, and `warn` would close that green (`docs/ops/spec.md` §1.7).
    warn "compose could not bring the rest of the stack up, so nothing here says whether nginx is even
running, let alone serving this build. It was NOT reloaded. Its own output is above."
    return 2
  fi
  after="$(service_cid nginx)" || after=""
  if [[ -z "$after" ]]; then
    fail "nginx is NOT running — the site is unreachable even though the application is healthy."
    detail "Check:  docker compose -f ${COMPOSE} logs nginx"
    return 1
  fi
  # A container compose replaced loaded its configuration after the application pair existed, so it
  # resolved the new addresses as it started and has nothing to re-read.
  if [[ "$before" != "$after" ]]; then
    ok "started, so it resolved the containers this deploy created as it loaded"
    return 0
  fi
  # nginx resolves `frontend` and `backend` once, as it loads its configuration: the proxy_pass names
  # in `nginx/prod.conf` are plain, so a container recreated at a new address is invisible to a proxy
  # that kept running, and only a reload re-resolves them.
  local test_out="" test_rc=0
  # A reload with an unparseable file leaves the master serving the configuration it already had and
  # says so in nginx's log alone, so the signal on its own would prove nothing.
  test_out="$(docker compose -f "$COMPOSE" exec -T nginx nginx -t 2>&1)" || test_rc=$?
  # Replayed rather than streamed, so `--verbose` still shows what the tool said (`docs/ops/spec.md`
  # §1.7); the verdict below needs the bytes, which `quietly` discards under exactly that flag.
  if [[ -n "$test_out" ]] && { (( test_rc )) || verbose; }; then printf '%s\n' "$test_out" | detail; fi
  if (( test_rc )); then
    # The verdict is nginx's own sentence, never the status: `exec` answers 1 for a config nginx
    # rejected and for an exec that never reached it alike.
    if [[ "$test_out" == *"test failed"* ]]; then
      fail "nginx rejects the configuration it has mounted, so it was NOT reloaded and is still
proxying to the addresses of the containers this deploy replaced. Its own output is above."
      detail "Fix nginx/prod.conf, then:  docker compose -f ${COMPOSE} up -d --force-recreate nginx"
      return 1
    fi
    warn "nginx could not be asked to test its configuration (exit ${test_rc}), and nothing above is
nginx's own verdict on it, so this says nothing about nginx/prod.conf. It was NOT reloaded either
way, so it may still be proxying to the addresses of the containers this deploy replaced."
    detail "Ask it yourself:  docker compose -f ${COMPOSE} exec -T nginx nginx -t"
    return 2
  fi
  if ! quietly docker compose -f "$COMPOSE" exec -T nginx nginx -s reload; then
    fail "nginx could not be reloaded, so it is still proxying to the addresses of the containers this
deploy replaced and every request through it answers 502."
    detail "Recreate it by hand:  docker compose -f ${COMPOSE} up -d --force-recreate nginx"
    return 1
  fi
  ok "reloaded, so it is proxying to the containers this deploy created"
  return 0
}

# Called only with both previous image ids held: a rollback restoring one service and not the other
# leaves the mismatched pair `--status` refuses to call live.
roll_back() { # $1 how the build being restored is named on screen
  local name="$1" tag_rc=0 up_rc=0 healthy=1 edge_rc=0
  step "Rolling back to ${name}"
  quietly docker tag "$PREV_FE_IMG" "$IMAGE_FRONTEND" || tag_rc=1
  quietly docker tag "$PREV_BE_IMG" "$IMAGE_BACKEND"  || tag_rc=1
  if (( tag_rc )); then
    fail "the images this deploy replaced could not be re-tagged, so the rollback never started and
this host is still holding the build that failed. One of the two tags may have moved before the
other refused, which leaves a mismatched pair."
    detail "What is published:  ./scripts/deploy.sh --status"
    return 1
  fi
  quietly docker compose -f "$COMPOSE" up -d --force-recreate frontend backend || up_rc=$?
  if (( up_rc )); then
    fail "compose could not recreate the application containers from the restored images (exit ${up_rc}),
so the site is down. Compose's own output is above."
    return 1
  fi
  wait_healthy "$COMPOSE" backend 150  || healthy=0
  wait_healthy "$COMPOSE" frontend 180 || healthy=0
  if (( ! healthy )); then
    fail "THE RESTORED BUILD IS NOT HEALTHY EITHER, so the site is down and nothing here can lift it."
    detail "Both services' logs:  docker compose -f ${COMPOSE} logs frontend backend"
    return 1
  fi
  # Passed up rather than folded into 1: 2 is "the edge's state could not be established", and a
  # caller told the restored build is not being served has been told something nothing here knows.
  serve_through_nginx || edge_rc=$?
  if (( edge_rc )); then return "$edge_rc"; fi
  # Not "the site is back", which neither read above establishes: the edge is answered by --status.
  ok "rolled back — ${name} is healthy again and nginx is proxying to it"
  return 0
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

  step "The site, as the internet reaches it"
  # Every row above is read from a container, and nginx resolves its upstreams once as it loads: a
  # healthy pair says nothing about whether the edge is still pointed at it. This asks the edge.
  status_code="$(curl -s -o /dev/null -w '%{http_code}' --max-redirs 0 --max-time 10 "$PROBE_URL" 2>/dev/null || true)"
  if [[ "$status_code" == "200" ]]; then
    ok "the edge answers the liveness probe"
  elif [[ -z "$status_code" ]]; then
    # An advisory, not the refusal below, which speaks for the container rows: those are complete
    # and are what a registry is pruned from, whether or not this host can reach its own front door.
    warn "curl reached no HTTP status at all, which is not the same as the site being down: this
host's own DNS, egress or TLS trust sits between the two. Ask from somewhere else before acting."
  else
    fail "the edge answered ${PROBE_URL} with ${status_code}, not 200, so whatever is running above is
not what a visitor is being served."
    detail "Reload the edge:  docker compose -f ${COMPOSE} up -d --force-recreate nginx"
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
# The rollback re-tags by IMAGE ID rather than by the pin: an id cannot move, and a no-argument
# deploy pulls `:latest` alone — so the build it replaces usually carries no `:sha-` tag on this host
# for `:latest` to be pointed back at.
PREV_FE_IMG=""
PREV_BE_IMG=""
PS_RC=0
RECORDED=1
# An empty answer from a compose that FAILED would otherwise print "nothing is running" and discard
# the rollback target on the one run that needs it.
prev_cid="$(service_cid frontend)" || PS_RC=$?
if (( PS_RC )); then
  RECORDED=0
  warn "compose could not say what is running (exit ${PS_RC}), so this deploy has nothing to roll back to.
Ask it directly:  docker compose -f ${COMPOSE} ps"
elif [[ -z "$prev_cid" ]]; then
  info "nothing is running here yet, so this deploy has nothing to roll back to"
else
  # Guarded for the same reason as the `--status` read: the container can go between `ps` and
  # `inspect`, and an unread image is not an unlabelled one.
  prev_img="$(running_image "$prev_cid")" || prev_img=""
  if [[ -z "$prev_img" ]]; then
    RECORDED=0
    warn "the running container's image could not be read, so this deploy has nothing to roll back to"
  else
    PREV_FE_IMG="$prev_img"
    PREV_RC=0
    PREV_PIN="$(published_tag "$prev_img")" || PREV_RC=1
    info "commit $(image_revision_display "$prev_img"), built $(image_created_display "$prev_img")"
    # Only what the rollback is CALLED rests on the label; the image it restores is already held.
    if (( PREV_RC )); then
      PREV_PIN=""
      warn "the running image's build label could not be read, so a rollback can restore it but cannot name it"
    elif [[ "$PREV_PIN" =~ $PIN_RE ]]; then
      info "rollback target: ${PREV_PIN}"
    else
      PREV_PIN=""
      warn "the running image carries no published-tag label, so a rollback can restore it but cannot name it"
    fi
  fi
fi

# The backend's half, read the same way and for the same reason.
BE_PS_RC=0
prev_be_cid="$(service_cid backend)" || BE_PS_RC=$?
if (( BE_PS_RC )); then
  RECORDED=0
  warn "compose could not say which image the backend is running (exit ${BE_PS_RC}), so this deploy has
nothing to roll back to"
elif [[ -z "$prev_be_cid" ]]; then
  # Silent where the frontend was not running either: the branch above has already said so.
  if [[ -n "$PREV_FE_IMG" ]]; then
    RECORDED=0
    warn "the frontend is running and the backend is not, so this deploy has no matched pair to roll back to"
  fi
else
  PREV_BE_IMG="$(running_image "$prev_be_cid")" || PREV_BE_IMG=""
  if [[ -z "$PREV_BE_IMG" ]]; then
    RECORDED=0
    warn "the backend container's image could not be read, so this deploy has nothing to roll back to"
  fi
fi

# Both halves or neither: `roll_back` restores a pair or does not run.
ROLLBACK_READY=0
if [[ -n "$PREV_FE_IMG" && -n "$PREV_BE_IMG" ]]; then ROLLBACK_READY=1; fi

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

# The application pair alone: `--force-recreate` over the whole project tears down an nginx nothing
# changed, and its `service_healthy` gate then holds the edge closed until both are healthy — or for
# good, where the new build never is.
step "Recreating the application containers"

# Guarded, not bare: a service that cannot be created exits `up` non-zero, and an unguarded call
# would skip the diagnostics and the rollback below.
UP_RC=0
quietly docker compose -f "$COMPOSE" up -d --force-recreate frontend backend || UP_RC=$?
if (( UP_RC )); then
  fail "compose could not recreate the application containers (exit ${UP_RC}); each service is asked what happened below"
else
  ok "frontend and backend recreated"
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
    # Nothing is rolled back from here even where preflight held a target: putting a build back acts
    # on a verdict about the new one, and this run reached none.
    refuse "compose cannot be asked about this stack (exit ${ASK_RC}), so nothing here says whether
the new version is healthy — and the containers WERE recreated, so the site's state is unknown too.
No rollback runs on that: it would be undoing a build nothing here has judged.
Ask it directly:  docker compose -f ${COMPOSE} ps
Then, if the new build turns out to be the problem:  ./scripts/deploy.sh ${PREV_PIN:-<a published tag>}"
  fi
fi

if (( HEALTHY )); then
  ok "both services are healthy"

  section "checks"
  SITE_VERIFIED=1

  # First, and the two checks below are what prove it landed: `nginx -s reload` returns 0 when the
  # signal is sent, not when the master has applied anything. Both of those read the site through
  # this edge.
  step "nginx"
  EDGE_RC=0
  serve_through_nginx || EDGE_RC=$?
  if (( EDGE_RC == 2 )); then
    refuse "the edge's state could not be established — the line above says what compose declined to
answer or to do — so nothing here says that the site serves this build, and the application
containers WERE recreated.
Ask it directly:  docker compose -f ${COMPOSE} ps"
  elif (( EDGE_RC )); then
    SITE_VERIFIED=0
  fi

  step "Security headers, as served over HTTPS"
  headers="$(curl -fsSI https://frankfurtleague.de 2>/dev/null | grep -iE "content-security-policy|strict-transport-security" || true)"
  if [[ -n "$headers" ]]; then
    printf '%s\n' "$headers" | detail
    ok "the edge is serving them"
  else
    SITE_VERIFIED=0
    warn "Could not read the headers over HTTPS — check nginx and the certificates in certs/."
  fi

  # The container healthcheck calls this from inside, so it stays green while the edge answers a
  # monitor 404 or 400 (docs/ops/spec.md I13). The version is spelled here -- §4 names the sites a
  # version left behind breaks.
  step "The liveness probe, through the edge"
  probe_code="$(curl -s -o /dev/null -w '%{http_code}' --max-redirs 0 --max-time 10 "$PROBE_URL" 2>/dev/null || true)"
  if [[ "$probe_code" == "200" ]]; then
    ok "the edge answers it"
  else
    SITE_VERIFIED=0
    warn "The edge answered /api/v0/system/is_live with ${probe_code:-no status}, not 200. An uptime
monitor watching it sees the same thing. Check nginx's liveness location, api_trusted_hosts, and
whether anything in front is redirecting."
  fi

  end_section
  detail "What is live:  ./scripts/deploy.sh --status" \
         "Follow logs:   docker compose -f ${COMPOSE} logs -f frontend"
  # The sentence is a claim about the live site, so neither `curl` nor the nginx query above may
  # leave it unqualified.
  if (( SITE_VERIFIED )); then finish "The pulled build is live."; else finish; fi
else
  fail "THE NEW VERSION IS NOT HEALTHY."
  detail "This deploy did not tear nginx down, so where it was running the site is answering 502" \
         "rather than refusing the connection." \
         "If a log above says 'Invalid environment variables: <NAMES>', that is the startup gate" \
         "doing its job: fix those names in the .env file and run this script again."
  if (( ROLLBACK_READY )); then
    # Read rather than discarded: the rollback's own failures are already findings, but its 2 says
    # the restored build's edge could not be established, which no finding above it states.
    RB_RC=0
    roll_back "${PREV_PIN:-the build that was running before this deploy}" || RB_RC=$?
    if (( RB_RC == 2 )); then
      detail "" "The restored pair is healthy, but nothing here establishes that the edge is serving it."
    fi
    detail "" "What is live:  ./scripts/deploy.sh --status"
  else
    detail "" "This deploy recorded no rollback target, so nothing here can put a previous build back." \
              "Published builds on this host:  docker image ls '${REPO_FRONTEND}'"
  fi
  finish
fi
