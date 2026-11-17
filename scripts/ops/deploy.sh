#!/usr/bin/env bash
#
# SCRIPTS · put one published build live by its tag, and go back to the build before it if it fails.
#
#   ./scripts/ops/deploy.sh                  deploy the build of the checkout's HEAD, sha-<first 7 hex>
#   ./scripts/ops/deploy.sh sha-1a2b3c4      deploy one published build, or go back to one
#   ./scripts/ops/deploy.sh --no-rollback    on a failure, stop and leave the stack as it stands, for a
#                                            build the one before must never run after, such as one
#                                            whose migration has already changed the data; it is
#                                            pinned before it starts, so no later run goes back past it
#   ./scripts/ops/deploy.sh --help
#
# Exit 0 deployed; 1 failed, and the last line says whether the stack went back: once the start has
# begun, every failure, of the start, of the read after it and of nginx's test and reload, goes back
# to the build before, and a pin that could not be renamed into place after the reload leaves the
# new build live, the last line naming the hand step; 2 refused, a wrong argument, a machine that is
# not Linux, or Docker or its Compose plugin not answering, with the stack unchanged; 130
# interrupted, the stack as far as compose took it; 3 or more a step before the start that crashed,
# a HEAD git could not name, a failed pull or a pin it could not write, each leaving the stack
# unchanged and its sentence saying so. The last build judged healthy is pinned as TAG= in the .env
# beside the compose file, which compose reads for every command, so `docker compose ps` and `logs`
# typed by hand reach the stack, and a later run that fails goes back to it.

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh" || exit 3

# The tag CI pushes a build under: docker/metadata-action's `type=sha`, seven hex digits by default.
TAG_RE='^sha-[0-9a-f]{7}$'

# Above the healthchecks' start period plus three failed probes, so a service is judged by its own
# healthcheck before the wait gives up on it.
WAIT_S=180

ROLLBACK=1
tag=""
for arg in "$@"; do
  case "$arg" in
    --no-rollback) ROLLBACK=0 ;;
    --help|-h) usage ;;
    -*) refuse "Unknown option: ${arg}. Try --help." ;;
    *)
      [[ -z "$tag" ]] || refuse "Two tags given, ${tag} and ${arg}. A deploy puts one build live."
      tag="$arg" ;;
  esac
done

# `cut` rather than `git rev-parse --short`, which lengthens a prefix another object shares.
if [[ -z "$tag" ]]; then
  head="$(git rev-parse HEAD)" || crash "git could not name the checkout's HEAD, so there is no tag to deploy.
Name one:  ./scripts/ops/deploy.sh sha-1a2b3c4"
  tag="sha-$(printf '%s' "$head" | cut -c1-7)"
fi
[[ "$tag" =~ $TAG_RE ]] || refuse "${tag} is not a tag CI publishes, which is sha- and seven hex digits, as sha-1a2b3c4."

# On a development machine the base file alone is production's stack, which `up --remove-orphans`
# would put in place of the local one's containers.
require_platform linux
require_docker
require_compose

# The last build judged healthy, which only this script writes. A first run finds none and rolls
# nothing back: the build it replaces is then the one from before this script, which never runs again.
prev=""
if [[ -f .env ]]; then prev="$(sed -n 's/^TAG=//p' .env | tail -n 1)"; fi
# Any other shape was written by hand, and may name images from before this script.
if [[ -n "$prev" && ! "$prev" =~ $TAG_RE ]]; then
  warn ".env pins TAG=${prev}, which is no build's tag, so no build is pinned to go back to."
  prev=""
fi

# Every compose call below takes the tag from here, over any TAG the operator's shell exports.
export TAG="$tag"

# Before the pull, whose images no container references yet: `-a` removes every image but those a
# container references, so this keeps the running build. The one this run replaces then stays on
# this host until the next deploy, and going back to it by hand needs no registry.
step "Images nothing runs"
if quietly docker image prune -af; then ok "removed"; else warn "the prune failed, and its account is above."; fi

# `missing`, because every image this stack names is one build for good: a sha- tag is one commit's,
# and the edge's images are pinned by digest. A build already on this host is taken as it is.
step "Pulling every image ${tag} runs with"
quietly docker compose pull --policy missing \
  || crash "the pull failed, and compose's own account is above: a tag CI never pushed, the registry, or this
host's network. The stack has not changed."
ok "every image is on this host"

# Through a second file and a rename, so the pin is never half written. The file is written before the start, where a
# full disk or a permission leaves the stack unchanged, so only the rename is left once the build is live.
stage_pin() { printf 'TAG=%s\n' "$1" > .env.next; }
pin() { mv -f .env.next .env; }

# Every service the compose file defines that is not running and healthy, into FAILING, a health of
# `starting` included. `up --wait` judges each service once, so one can turn unhealthy while it waits
# on another, and some Compose releases answer 0 at the timeout with one still starting. `ps` without
# `--all` lists the project's running containers alone, never a one-off container `docker compose
# run` left, which `--all` lists under its service's name. Answers 0 for none, 1 for some, and 2
# where compose could not answer either read or named no service, which would read as none failing.
FAILING=()
read_states() {
  local defined listed service state health
  local -i services=0
  local -A running=() other=()
  FAILING=()
  defined="$(docker compose config --services)" || return 2
  listed="$(docker compose ps --format '{{.Service}} {{.State}} {{.Health}}')" || return 2
  while IFS=' ' read -r service state health; do
    if [[ "$state" == running && ( -z "$health" || "$health" == healthy ) ]]; then
      running[$service]=1
    elif [[ -n "$service" ]]; then
      other[$service]=1
    fi
  done <<<"$listed"
  while IFS= read -r service; do
    if [[ -z "$service" ]]; then continue; fi
    services+=1
    if [[ -n "${other[$service]-}" || -z "${running[$service]-}" ]]; then FAILING+=("$service"); fi
  done <<<"$defined"
  (( services )) || return 2
  (( ${#FAILING[@]} == 0 ))
}

# The services' own healthchecks decide, and their last lines say why. Each read is an account of a
# failure already decided, so one compose cannot give is shown and passed: ending the run there would
# leave the stack where it stands rather than going back.
show_failure() {
  local IFS=' '
  info "compose's own account of each service:"
  docker compose ps --all 2>&1 | detail || true
  read_states || true
  if (( ${#FAILING[@]} )); then
    info "the last 60 lines of ${FAILING[*]}:"
    docker compose logs --tail=60 "${FAILING[@]}" 2>&1 | detail || true
  fi
}

# `--remove-orphans`, so a service deleted from the compose file leaves no container running.
up() { quietly docker compose up -d --wait --wait-timeout "$WAIT_S" --remove-orphans; }

# `nginx -s reload` answers 0 once the signal is sent. The running master then starts new workers or
# keeps its old configuration, refusing some a fresh `nginx -t` passes, such as a zone keyed anew
# under its old name. Its error log, the container's output, says which, each line naming the pid
# that wrote it. The master logs `reconfiguring`, then the reason it refuses or `start worker
# processes` at notice, the image's nginx.conf level. Only the master's lines are read: a worker's
# request can log an alert of its own, such as its connections running out, which bears no
# connection number either. Run as a condition, so any step of it that fails goes back.
reload_nginx() {
  local since="${EPOCHREALTIME/,/.}" refusal="$failure" said master refused i
  quietly docker compose exec -T nginx nginx -s reload || return 1
  failure="nginx was sent this checkout's configuration and confirmed neither taking nor refusing it"
  for (( i = 0; i < 15; i++ )); do
    sleep 1
    said="$(docker compose logs --no-log-prefix --since "$since" nginx 2>&1)" \
      || { info "compose could not read nginx's output:"; detail <<<"$said"; return 1; }
    master="$(sed -nE 's/^[0-9/]+ [0-9:]+ \[notice\] ([0-9]+)#[0-9]+: reconfiguring$/\1/p' <<<"$said" | tail -n 1)"
    if [[ -z "$master" ]]; then continue; fi
    refused="$(grep -E "^[0-9/]+ [0-9:]+ \[(emerg|alert|crit)\] ${master}#[0-9]+: " <<<"$said" || true)"
    if [[ -n "$refused" ]]; then
      failure="$refusal"
      info "nginx's running master refused the configuration nginx -t passed, which a restart of nginx, a
reboot included, loads afresh:"
      detail <<<"$refused"
      return 1
    fi
    if grep -Eq "^[0-9/]+ [0-9:]+ \[notice\] ${master}#[0-9]+: start worker processes$" <<<"$said"; then return 0; fi
  done
  info "nginx logged neither new workers nor a refusal within 15 seconds of the reload."
  return 1
}

# Moved by a healthy verdict alone, so a run ending without one, an interrupt included, leaves it on
# the last build that came up. --no-rollback's build retires the one before as it starts.
stage_pin "$tag" || crash "the .env could not be written, so ${tag} was not started. The stack has not changed."
if (( ! ROLLBACK )); then
  pin || crash "the .env could not be written, so ${tag} was not started. The stack has not changed."
fi
step "Starting ${tag}"
failure="${tag} did not come up"
# From here every failure before the pin goes back, so each step runs as a condition and none ends the run.
if up; then
  # What `up` answered and nothing more: the read below judges each service.
  ok "compose's wait ended without a failure"
  # Before nginx is reloaded, so a run this read fails goes back with nginx on the configuration it had.
  step "Every service's state"
  read_rc=0
  read_states || read_rc=$?
  if (( read_rc == 0 )); then
    ok "every service is running and healthy"
    # A mounted configuration loads only on a reload. Tested first, so a refused one is named by nginx -t.
    step "nginx's configuration"
    failure="nginx did not take this checkout's configuration and still runs the one it had"
    if ! quietly docker compose exec -T nginx nginx -t; then
      # Going back moves the images alone, and nginx reads the checkout's files at any restart.
      warn "nginx -t did not pass this checkout's nginx/, its own account above. Where nginx refused it, the
checkout still holds the configuration nginx refused, which a restart of nginx, a reboot included,
loads and fails on. Pull a commit whose configuration nginx takes and deploy it."
    elif reload_nginx; then
      ok "tested, and its new workers started"
      if (( ROLLBACK )); then
        step "Pinning ${tag}"
        # Not gone back: the build is live and whole under the configuration nginx has just loaded, which going
        # back would leave the build before it to run under.
        pin || die "${tag} is live and healthy under this checkout's nginx configuration, but the pin could not be
renamed into .env, which still pins ${prev:-no build}, the build a later failing run would go back to. Pin ${tag}
by hand:  printf 'TAG=%s\n' ${tag} > .env"
      fi
      ok "${tag} is live.${prev:+ The build before it was ${prev}.}"
      exit 0
    fi
  elif (( read_rc == 1 )); then
    printf -v named '%s, ' "${FAILING[@]}"
    failure="${tag} came up, but the last read finds ${named%, } not running and healthy"
  else
    failure="${tag} came up, but compose could not read each service's state after it"
  fi
fi

show_failure
if (( ! ROLLBACK )); then
  die "${failure}. --no-rollback leaves the stack as it stands, .env pinning ${tag}.${prev:+
The build before it was ${prev}.}"
fi
# Never to the tag that has just failed.
if [[ -z "$prev" || "$prev" == "$tag" ]]; then
  die "${failure}, and no other build is pinned to go back to, so the stack stands as it is."
fi

# The images alone go back: the checkout's compose file and nginx's configuration stay as pulled.
# nginx is not reloaded, so unless the start above recreated it, it runs the configuration it had
# before this run, except after a reload nginx confirmed neither way, which the failure names.
step "Going back to ${prev}"
export TAG="$prev"
back_rc=1
if up; then
  back_rc=0
  read_states || back_rc=$?
fi
if (( back_rc == 0 )); then
  die "${failure}, so the stack went back to ${prev}, which is live."
fi
show_failure
# `up` answered 0 and nothing read the services after it, so the build is neither live nor down.
if (( back_rc == 2 )); then
  die "${failure}, so the stack went back to ${prev}, but compose could not read each service's state after it. .env pins ${prev}."
fi
die "${failure}, and ${prev} did not come up either when the stack went back to it. .env pins ${prev}."
