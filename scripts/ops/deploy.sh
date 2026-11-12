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
# Exit 0 deployed; 1 failed, and the last line says whether the stack went back; 2 refused, with
# the stack unchanged; 130 interrupted, the stack as far as compose took it. The last build judged
# healthy is pinned as TAG= in the .env beside the compose file, which compose reads for every
# command, so `docker compose ps` and `logs` typed by hand reach the stack, and a later run that
# fails goes back to it.

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

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
  head="$(git rev-parse HEAD)" || refuse "git could not name the checkout's HEAD, so there is no tag to deploy.
Name one:  ./scripts/ops/deploy.sh sha-1a2b3c4"
  tag="sha-$(printf '%s' "$head" | cut -c1-7)"
fi
[[ "$tag" =~ $TAG_RE ]] || refuse "${tag} is not a tag CI publishes, which is sha- and seven hex digits, as sha-1a2b3c4."

# On a development machine the base file alone is production's stack, which `up --remove-orphans`
# would put in place of the local one's containers.
require_platform linux

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
  || refuse "the pull failed, and compose's own account is above: a tag CI never pushed, the registry, or this
host's network. The stack has not changed."
ok "every image is on this host"

# Through a second file and a rename, so the pin is never half written.
pin() { printf 'TAG=%s\n' "$1" > .env.next && mv -f .env.next .env; }

# Every service the compose file defines that is not running and healthy, into FAILING: one with no
# running container, and one whose health is anything but none or `healthy`, `starting` included.
# `up --wait` judges each service once, so one can turn unhealthy while it waits on another, and some
# Compose releases answer 0 at the timeout with one still starting. `ps` without `--all` lists only
# the project's running containers and no one-off container `docker compose run` left
# (https://docs.docker.com/reference/cli/docker/compose/ps/), which `--all` lists under its service's
# name. Answers 0 for none, 1 for some, and 2 where compose could not answer either read.
FAILING=()
read_states() {
  local defined listed service state health
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
    if [[ -n "$service" && ( -n "${other[$service]-}" || -z "${running[$service]-}" ) ]]; then FAILING+=("$service"); fi
  done <<<"$defined"
  (( ${#FAILING[@]} == 0 ))
}

# The services' own healthchecks decide, and their last lines say why.
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
# keeps its old configuration (https://nginx.org/en/docs/control.html), refusing some a fresh
# `nginx -t` passes, such as a zone keyed anew under its old name. Its error log, the container's
# output, says which: `start worker processes` at notice, the image's nginx.conf level, or the reason.
# Matched as an error-log line from its start, which no request can write.
reload_nginx() {
  local since="${EPOCHREALTIME/,/.}" refusal="$failure" said refused i
  quietly docker compose exec -T nginx nginx -s reload || return 1
  failure="nginx was sent this checkout's configuration and confirmed neither taking nor refusing it"
  for (( i = 0; i < 15; i++ )); do
    sleep 1
    said="$(docker compose logs --no-log-prefix --since "$since" nginx 2>&1)" \
      || { info "compose could not read nginx's output:"; detail <<<"$said"; return 1; }
    refused="$(grep -E '^[0-9/]+ [0-9:]+ \[(emerg|alert|crit)\] ' <<<"$said" || true)"
    if [[ -n "$refused" ]]; then
      failure="$refusal"
      info "nginx's running master refused the configuration nginx -t passed, which a restart of nginx, a
reboot included, loads afresh:"
      detail <<<"$refused"
      return 1
    fi
    if grep -Eq '^[0-9/]+ [0-9:]+ \[notice\] [0-9]+#[0-9]+: start worker processes$' <<<"$said"; then return 0; fi
  done
  info "nginx logged neither new workers nor a refusal within 15 seconds of the reload."
  return 1
}

# Moved by a healthy verdict alone, so a run ending without one, an interrupt included, leaves it on
# the last build that came up. --no-rollback's build retires the one before as it starts.
if (( ! ROLLBACK )); then
  pin "$tag" || refuse "the .env could not be written, so ${tag} was not started. The stack has not changed."
fi
step "Starting ${tag}"
failure="${tag} did not come up"
if up; then
  # What `up` answered and nothing more: the read below judges each service.
  ok "compose's wait ended without a failure"
  # A mounted configuration loads only on a reload. Tested first, so a refused one is named by nginx -t.
  step "nginx's configuration"
  failure="nginx did not take this checkout's configuration and still runs the one it had"
  if ! quietly docker compose exec -T nginx nginx -t; then
    # Going back moves the images alone, and nginx reads the checkout's files at any restart.
    warn "this checkout's nginx/ still holds the configuration nginx refused, which a restart of nginx, a
reboot included, loads and fails on. Pull a commit whose configuration nginx takes and deploy it."
  elif reload_nginx; then
    ok "tested, and its new workers started"
    step "Every service's state"
    read_rc=0
    read_states || read_rc=$?
    if (( read_rc == 0 )); then
      ok "every service is running and healthy"
      pin "$tag" || die "${tag} is live, but the .env could not be written and still pins ${prev:-no build}.
Write TAG=${tag} into it, or the next failed run goes back past ${tag}."
      ok "${tag} is live.${prev:+ The build before it was ${prev}.}"
      exit 0
    elif (( read_rc == 1 )); then
      printf -v named '%s, ' "${FAILING[@]}"
      failure="${tag} came up, but the last read finds ${named%, } not running and healthy"
    else
      failure="${tag} came up, but compose could not read each service's state after it"
    fi
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
# before this run.
step "Going back to ${prev}"
export TAG="$prev"
if up && read_states; then
  die "${failure}, so the stack went back to ${prev}, which is live."
fi
show_failure
die "${failure}, and ${prev} did not come up either when the stack went back to it. .env pins ${prev}."
