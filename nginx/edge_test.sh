#!/usr/bin/env bash
# OPS · the running edge: what its logs CONTAIN, which headers it sends, and which it hands upstream.
#
# `nginx -t` parses, seeing no log line and no response, so a query written to the access line and a
# location dropping a header both pass it. This serves the checkout's own files, never a copy — a copy proves
# the copy — and grades what nginx wrote, sent and answered: `nginx/local/` for every location, and
# `nginx/prod/` for the blocks production alone serves, each started with the privileges
# `docker-compose.yml` grants nginx. It answers nothing about which locations the edge makes reachable.
#
# Invariants:
# - A mailed link's query never reaches an access line, and every line holds the request's trace id.
# - A visitor's `traceparent` is replaced on every location proxying to the frontend, and the protocol
#   Next is handed is the edge's own word: `https` from production's blocks, `http` from the local ones.
# - Each security header is sent once, as written, on every location's response.
# - Each upstream is named through a variable and found through Docker's DNS alone, and the
#   capabilities the model grants are enough to start nginx.
# - `docs/ops/spec.md` §1.3's server-action and link-page pairs, and the code check's.
# - A server action's body and the crash report's, on both its paths, each taken at its cap and refused past it.
#
#   ./nginx/edge_test.sh --verbose   print the access line every case was graded on
#   ./nginx/edge_test.sh --help

_here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/_lib.sh
source "${_here}/scripts/lib/_lib.sh"

# Parsed before any environmental check, so a typo fails instantly instead of demanding Docker.
# shellcheck disable=SC2034  # the --verbose arm assigns VERBOSE for _lib.sh's `verbose`
for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE=1 ;;
    --help|-h) usage ;;
    # `refuse`, not `die`: an invocation nobody can carry out leaves this run with no verdict on
    # the edge, which the exit contract spells 2 (`docs/ops/spec.md` §1.7).
    *) refuse "Unknown option: ${arg}. Try --help." ;;
  esac
done

require_docker
command -v curl >/dev/null 2>&1 \
  || refuse "curl is not on PATH, so the edge was not driven."

# Distinctive enough that a substring test over the whole access line is the assertion.
TOK="Rk9VUlRJTUVTQlJPS0VO"

CONTAINER="fl-edge-$$"
PROD_CONTAINER="fl-edge-prod-$$"
# A user-defined network, as both stacks' are: only one carries Docker's embedded DNS, which the edge
# resolves its upstreams through, and no hosts-file entry reaches nginx's resolver.
NETWORK="fl-edge-net-$$"
# The stand-in answering as `backend`, so the name resolves on the test's network.
BACKEND_GONE="fl-edge-backend-$$"
# Under the repo root because MSYS rewrites a POSIX-looking path (`scripts/README.md`), and named
# for this run because two runs sharing a path would delete each other's stub.
SCRATCH_NAME=".tmp-edge-$$"
SCRATCH="${REPO_ROOT}/${SCRATCH_NAME}"

cleanup() {
  docker rm -f "$CONTAINER" "$PROD_CONTAINER" "$BACKEND_GONE" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -rf "$SCRATCH" || true
}
trap cleanup EXIT

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"

# Each header's name and value off the file the set is written in, so a location restating the set
# with a different value fails as surely as one dropping it.
declare -A SECURITY_HEADERS=()
while IFS= read -r written_line; do
  [[ "$written_line" =~ ^[[:space:]]*add_header ]] || continue
  [[ "$written_line" =~ ^[[:space:]]*add_header[[:space:]]+([A-Za-z-]+)[[:space:]]+\"([^\"]*)\"[[:space:]]+always\;$ ]] \
    || refuse "nginx/shared/security_headers.conf holds '${written_line}', whose name and value this test cannot read."
  SECURITY_HEADERS["${BASH_REMATCH[1],,}"]="${BASH_REMATCH[2]}"
done < "${REPO_ROOT}/nginx/shared/security_headers.conf"
(( ${#SECURITY_HEADERS[@]} > 0 )) || refuse "nginx/shared/security_headers.conf yielded no header to compare."

# The stub answers as `frontend`, the edge's own alias on the network, from inside the same nginx, so
# each case is graded on a real 200 rather than a 502 that never reached a location.

# It answers with the two headers it was handed, so the header block below reads what reached Next,
# and with its own copy of every security header, which the edge must not pass beside its own.
{
  cat <<'STUB'
server {
    listen 3000;
    server_name _;
    # Off, so the stub's own lines stay out of the stream being asserted.
    access_log off;
    add_header X-Seen-Traceparent $http_traceparent always;
    add_header X-Seen-Next-Action $http_next_action always;
    add_header X-Seen-Forwarded-Proto $http_x_forwarded_proto always;
    # Any body, so a 413 the body caps' cases read is the edge's and never the stub's own 1m default.
    client_max_body_size 0;
STUB
  for name in "${!SECURITY_HEADERS[@]}"; do printf '    add_header %s "upstream" always;\n' "$name"; done
  # Setting no header, so it forwards every one the edge sent as the edge sent it, to the listener
  # the empty `Next-Action` case starts.
  printf '%s\n' '    location = /next-action-relay { proxy_pass http://127.0.0.1:3001; }'
  # A redirect naming the upstream itself, which the edge must hand the visitor as its own origin.
  printf '%s\n' '    location = /location-probe { return 302 http://frontend:3000/landed; }'
  printf '%s\n' '    location / { return 200 "stub\n"; }' '}'
} > "${SCRATCH}/zz-upstream-stub.conf"
# The relay's listener answers only after recording the head's blank line: one answering first, as a
# piped `nc` does, lets the stub's nginx, which reads an upstream's answer whatever it has sent, close
# before writing the request.
cat > "${SCRATCH}/relay-record.sh" <<'RECORD'
cr="$(printf '\r')"
while IFS= read -r line; do printf '%s\n' "$line"; [ "$line" = "$cr" ] && break; done > /tmp/relay-seen
printf 'HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n'
RECORD

# Each `*.conf` of `nginx/local/` mounted by name beside the stub, which a read-only directory
# mount would refuse. The empty tmpfs under them hides the image's own `default.conf`, as the
# stacks' directory mount does.
LOCAL_MOUNTS=( --tmpfs /etc/nginx/conf.d )
for conf in "${REPO_ROOT}"/nginx/local/*.conf; do
  [[ -f "$conf" ]] || continue
  LOCAL_MOUNTS+=( -v "/${conf}:/etc/nginx/conf.d/${conf##*/}:ro" )
done
(( ${#LOCAL_MOUNTS[@]} > 2 )) || refuse "nginx/local/ holds no *.conf, so there is no edge to serve."

# The edge's image and privileges off the model Compose renders for the local stack, by the gate's
# own `scripts/lib/_lib.sh :: render_compose_model`, so the release and the capabilities this serves
# with are the ones the stacks start.
EDGE_PY="$(any_python || true)"
if [[ -z "$EDGE_PY" ]] || ! python_at_floor "$EDGE_PY"; then
  refuse "no python at the checkers' floor, so the edge's image could not be read off its model."
fi
stage_compose_models "${SCRATCH}/model"
render_compose_model "${SCRATCH}/model" local \
  || refuse "compose could not render the local stack's model, so the edge's image is unknown."
EDGE_MODEL_READ='
import json
import sys

nginx = json.loads(open(sys.argv[1], "rb").read())["services"]["nginx"]
print("image", nginx.get("image") or "", sep="\t")
for key, flag in (("cap_drop", "--cap-drop"), ("cap_add", "--cap-add"), ("security_opt", "--security-opt")):
    for entry in nginx.get(key) or []:
        print("privilege", flag, entry, sep="\t")
'
EDGE_IMAGE=""
# The capabilities and options the model starts nginx with, on both edges below: a master refused a
# capability it needs never starts.
EDGE_PRIVILEGES=()
mapfile -t EDGE_MODEL < <("$EDGE_PY" -c "$EDGE_MODEL_READ" "${SCRATCH}/model/local.json" \
  || echo "unread")
for model_line in "${EDGE_MODEL[@]}"; do
  model_line="${model_line%$'\r'}"
  case "$model_line" in
    image$'\t'*) EDGE_IMAGE="${model_line#*$'\t'}" ;;
    privilege$'\t'*)
      model_line="${model_line#*$'\t'}"
      EDGE_PRIVILEGES+=( "${model_line%%$'\t'*}" "${model_line#*$'\t'}" ) ;;
    *) refuse "the local stack's model could not be read: ${model_line}" ;;
  esac
done
[[ -n "$EDGE_IMAGE" ]] || refuse "the local stack's model names no image for nginx, so there is no release to serve."
if verbose; then info "the model starts ${EDGE_IMAGE} with: ${EDGE_PRIVILEGES[*]}"; fi

quietly docker network create "$NETWORK" \
  || refuse "could not create the edge test's network ${NETWORK}. Docker's own reason is above."
# Before either edge, as compose orders the pair before nginx: a configuration resolving its upstreams
# at load still starts, and fails only the case aimed at it. Listening nowhere, it answers the header
# pass's liveness probe with the edge's own 502 as soon as asked, where a name nothing holds leaves
# that probe to the resolver.
docker run -d --name "$BACKEND_GONE" --network "$NETWORK" --network-alias backend \
  "$EDGE_IMAGE" sleep 3600 >/dev/null \
  || refuse "could not start the stand-in answering as backend."

# The leading slash on each `-v` subject is `scripts/gate/verify.sh`'s nginx step's MSYS exclusion.
MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" \
  -p 127.0.0.1:0:80 \
  --network "$NETWORK" --network-alias frontend \
  "${LOCAL_MOUNTS[@]}" \
  "${EDGE_PRIVILEGES[@]}" \
  -v "/${REPO_ROOT}/nginx/shared:/etc/nginx/shared:ro" \
  -v "/${SCRATCH}/zz-upstream-stub.conf:/etc/nginx/conf.d/zz-upstream-stub.conf:ro" \
  -v "/${SCRATCH}/relay-record.sh:/relay-record.sh:ro" \
  "$EDGE_IMAGE" >/dev/null \
  || refuse "could not start the pinned nginx for the edge test."

# The container's two streams as Docker holds them, read whole into the scratch directory: nginx's
# access lines on stdout, its error lines on stderr.
ACCESS_LOG="${SCRATCH}/stdout"
ERROR_LOG="${SCRATCH}/stderr"
read_streams() {
  docker logs "$CONTAINER" > "$ACCESS_LOG" 2> "$ERROR_LOG" \
    || refuse "could not read the edge test's nginx streams back from Docker."
}

# `docker port`, never a fixed number: a developer's own stack shares this host, and a collision
# would read as a redaction failure rather than as a port already taken.
ADDR="$(docker port "$CONTAINER" 80/tcp | head -n 1)" \
  || refuse "the edge test's nginx published no port."
[[ -n "$ADDR" ]] || refuse "the edge test's nginx published no port."
BASE="http://${ADDR%$'\r'}"

# nginx accepts a connection before the worker serves, so retrying on connect is what separates
# "not up yet" from "refuses this request". It carries no marker, so the grading below ignores it.

# Any status is an answer: an edge answering 502 everywhere is a configuration defect the cases below
# name, exit 1, where waiting for a 200 would refuse it as no verdict.
_up=0
for _ in $(seq 1 50); do
  _status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 -H "Host: localhost" "${BASE}/healthprobe" 2>/dev/null || true)"
  if [[ -n "$_status" && "$_status" != 000 ]]; then _up=1; break; fi
  sleep 0.2
done
(( _up )) || refuse "the edge test's nginx never answered on ${BASE}."

# --- a mailed link's access line ------------------------------------------------------------------

# A mailed link's request, its token in the query as every link this site mints carries it, marked by
# its user agent so its line is found among the rest. Whatever the edge writes of its query, the
# token reaches the stream with it.
MARKER="fl-mailed-link"
LINE_FAILURES=0
CURL_RC=0
curl -s -o /dev/null --max-time 5 -H "Host: localhost" -A "$MARKER" "${BASE}/confirm/kontakt?token=${TOK}" || CURL_RC=$?
# Docker carries a line to its log after curl already has the response, so one read races it.
MAILED_LINE=""
for _ in $(seq 1 50); do
  read_streams
  MAILED_LINE="$({ grep -F "\"user_agent\":\"${MARKER}\"" "$ACCESS_LOG" || true; })"
  [[ -z "$MAILED_LINE" ]] || break
  sleep 0.2
done
# `refuse`, not `die`: nothing was judged, and a 1 here would read as a leak nobody observed.
[[ -n "$MAILED_LINE" ]] || refuse "the edge logged no line for the mailed link's request on its stdout, curl having exited ${CURL_RC}.
No access line was judged."
if [[ "$MAILED_LINE" != *'"path":"/confirm/kontakt",'* ]]; then
  fail "LINE the mailed link's path"
  detail "expected path /confirm/kontakt alone, nginx wrote: ${MAILED_LINE}"
  LINE_FAILURES=$(( LINE_FAILURES + 1 ))
elif verbose; then
  info "the mailed link's line"
  detail "$MAILED_LINE"
fi

# --- the security headers, as served -----------------------------------------------------------

HEADER_FAILURES=0
declare -A SENT=() SENT_VALUE=()
read_headers() {
  SENT=(); SENT_VALUE=()
  [[ -f "$1" ]] || return 0
  while IFS= read -r header_line; do
    header_line="${header_line%$'\r'}"
    header_name="${header_line%%:*}"
    header_name="${header_name,,}"
    # The blank line closing the block names no header.
    [[ -n "$header_name" ]] || continue
    SENT["$header_name"]=$(( ${SENT["$header_name"]:-0} + 1 ))
    SENT_VALUE["$header_name"]="${header_line#*: }"
  done < "$1"
}
# The bot check's script and widget, which the sign-in and both public forms load: a policy losing
# the origin from either directive breaks all three while every header still matches the file
# (`docs/ops/spec.md` §1.4).
BOT_CHECK_ORIGIN="https://challenges.cloudflare.com"
grade_security_headers() { # $1 what the request was, the headers already read
  local name directive pattern
  for directive in script-src frame-src; do
    pattern=";[[:space:]]*${directive}[[:space:]]+([^;]*)"
    if [[ ! "; ${SENT_VALUE[content-security-policy]:-}" =~ $pattern || " ${BASH_REMATCH[1]} " != *" ${BOT_CHECK_ORIGIN} "* ]]; then
      fail "HEADER $1"
      detail "expected the Content-Security-Policy's ${directive} to admit ${BOT_CHECK_ORIGIN}"
      HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
    fi
  done
  for name in "${!SECURITY_HEADERS[@]}"; do
    # Exactly one: none is a location whose own add_header dropped the inherited set, two a copy
    # restated beside the include -- for the CSP, a second enforcing policy.
    if [[ "${SENT[$name]:-0}" != 1 ]]; then
      fail "HEADER $1"
      detail "expected one ${name}, nginx sent ${SENT[$name]:-0}"
      HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
    elif [[ "${SENT_VALUE[$name]}" != "${SECURITY_HEADERS[$name]}" ]]; then
      fail "HEADER $1"
      detail "expected ${name}: ${SECURITY_HEADERS[$name]}" "nginx sent ${name}: ${SENT_VALUE[$name]}"
      HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
    fi
  done
}

# One request into EVERY location `nginx/shared/site.conf` declares, the list read off that file so a
# location added there is probed without this one learning it.
HEADER_PATHS=()
# Set for a location whose `proxy_pass` names the backend: nothing listens as `backend` until the
# last case, so what it hands upstream is not read.
declare -A TO_BACKEND=()
while IFS= read -r location_line; do
  if [[ "$location_line" =~ ^[[:space:]]*proxy_pass[[:space:]]+http://\$backend_upstream\; ]]; then
    TO_BACKEND[$(( ${#HEADER_PATHS[@]} - 1 ))]=1
    continue
  fi
  [[ "$location_line" =~ ^[[:space:]]*location[[:space:]]+(.*)[[:space:]]*\{ ]] || continue
  location_args="${BASH_REMATCH[1]%"${BASH_REMATCH[1]##*[![:space:]]}"}"
  case "$location_args" in
    "= "*) HEADER_PATHS+=( "${location_args#= }" ) ;;
    /*/) HEADER_PATHS+=( "${location_args}probe" ) ;;
    /) HEADER_PATHS+=( "/" ) ;;
    /*) HEADER_PATHS+=( "${location_args}/probe" ) ;;
    # Reached through `error_page` alone, never a path: the server-action pair below asks it with a
    # request the edge refuses.
    @*) ;;
    # A regex location answers no path this can derive, and probing around it would call the file
    # covered while one of its locations went unasked.
    *) refuse "nginx/shared/site.conf declares 'location ${location_args}', whose path this probe cannot derive." ;;
  esac
done < "${REPO_ROOT}/nginx/shared/site.conf"
(( ${#HEADER_PATHS[@]} > 0 )) || refuse "nginx/shared/site.conf yielded no location to probe."

# The header a visitor may not choose, sent on every request below: nginx forwards every request
# header no `proxy_set_header` names, so a location dropping the inherited set hands it to Next as
# it arrived.
CLIENT_TRACE="0af7651916cd43dd8448eb211c80319c"
# On a GET, which the action pair's key leaves out, and inside the burst of every zone keyed on a GET,
# so every location answers.
CLIENT_ACTION="fl-edge-action-probe"
# One curl for every path, each response's headers to a file of its own, and the counting in bash:
# on Windows a spawn costs ~0.1s, which a grep per header would pay a hundred times.
HEADER_REQUESTS=()
for _i in "${!HEADER_PATHS[@]}"; do
  if (( _i > 0 )); then HEADER_REQUESTS+=( --next ); fi
  HEADER_REQUESTS+=( -s -o /dev/null -D "${SCRATCH}/headers-${_i}" --max-time 5 -H "Host: localhost"
    -H "traceparent: 00-${CLIENT_TRACE}-b7ad6b7169203331-01"
    -H "X-Forwarded-Proto: https"
    -H "Next-Action: ${CLIENT_ACTION}" "${BASE}${HEADER_PATHS[_i]}" )
done
curl "${HEADER_REQUESTS[@]}" || true
UPSTREAM_READ=0
for _i in "${!HEADER_PATHS[@]}"; do
  read_headers "${SCRATCH}/headers-${_i}"
  grade_security_headers "${HEADER_PATHS[_i]}"
  [[ -z "${TO_BACKEND[$_i]:-}" ]] || continue
  UPSTREAM_READ=$(( UPSTREAM_READ + 1 ))
  seen_trace="${SENT_VALUE[x-seen-traceparent]:-}"
  if [[ ! "$seen_trace" =~ ^00-[0-9a-f]{32}-[0-9a-f]{16}-01$ || "$seen_trace" == *"$CLIENT_TRACE"* ]]; then
    fail "UPSTREAM ${HEADER_PATHS[_i]}"
    detail "expected the edge's own traceparent at Next, Next received '${seen_trace}'"
    HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
  fi
  # This hop's own scheme, never the `https` the request claimed: Next builds the request's URL from it.
  if [[ "${SENT_VALUE[x-seen-forwarded-proto]:-}" != http ]]; then
    fail "UPSTREAM ${HEADER_PATHS[_i]}"
    detail "expected X-Forwarded-Proto http at Next from the local edge, Next received '${SENT_VALUE[x-seen-forwarded-proto]:-}'"
    HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
  fi
  # That no location clears the id a server action is posted with; the empty one is the relay's below.
  if [[ "${SENT_VALUE[x-seen-next-action]:-}" != "$CLIENT_ACTION" ]]; then
    fail "UPSTREAM ${HEADER_PATHS[_i]}"
    detail "expected Next-Action ${CLIENT_ACTION} at Next, Next received '${SENT_VALUE[x-seen-next-action]:-}'"
    HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
  fi
done

# --- an empty Next-Action, as Next would receive it --------------------------------------------------

# The empty header `nginx/shared/site.conf` drops before Next, which runs one as a server action: the
# stub's `$http_next_action` reads empty and missing alike, so a raw listener behind the stub's relay
# records the headers themselves.

# One transfer through the edge to the relay, printing the request the listener recorded, or nothing
# where no whole header block arrived.
relay_seen() { # the curl options naming the transfer's headers
  local _k status="" seen=""
  MSYS_NO_PATHCONV=1 docker exec -d "$CONTAINER" sh -c \
    "rm -f /tmp/relay-seen; exec nc -l -p 3001 -e sh /relay-record.sh" \
    || return 0
  # A 502 alone is retried, the relay's answer before the listener is up: the listener takes one
  # connection, so a retry after a timeout that reached it reads a 502 and judges nothing.
  for _k in $(seq 1 25); do
    status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 -H "Host: localhost" "$@" "${BASE}/next-action-relay" || true)"
    [[ "$status" == 502 ]] || break
    sleep 0.2
  done
  # The `.` keeps the head's closing newline, which the substitution would strip: a bodiless
  # request ends on its blank line, so without it no whole head ever matches.
  seen="$(MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" cat /tmp/relay-seen 2>/dev/null || true; printf .)"
  seen="${seen%.}"
  # A capture cut before its blank line can lack the very header the empty case looks for, which
  # would read as the edge having dropped it.
  [[ "$seen" == *$'\r\n\r\n'* ]] || return 0
  printf '%s' "${seen//$'\r'/}"
}
RELAY_SENT="$(relay_seen -H "Next-Action: ${CLIENT_ACTION}")"
RELAY_EMPTY="$(relay_seen -H "Next-Action;")"
if [[ "$RELAY_SENT" != *"GET /next-action-relay "* || "$RELAY_EMPTY" != *"GET /next-action-relay "* ]]; then
  refuse "the stub's relay recorded no whole request head, so whether the edge hands Next an empty Next-Action was not judged.
It listens with the image's own busybox nc: ask it with  docker exec ${CONTAINER} nc -h"
fi
# The control: a relay dropping every Next-Action would pass the empty case below unasked.
if ! grep -qiE "^next-action: ${CLIENT_ACTION}$" <<< "$RELAY_SENT"; then
  fail "UPSTREAM /next-action-relay"
  detail "expected Next-Action ${CLIENT_ACTION} at the relay, it recorded: ${RELAY_SENT}"
  HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
fi
if grep -qi "^next-action:" <<< "$RELAY_EMPTY"; then
  fail "UPSTREAM an empty Next-Action"
  detail "the edge handed Next an empty Next-Action, which Next runs as a server action and the action meter reads as none: ${RELAY_EMPTY}"
  HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
fi

# --- the server-action pair -----------------------------------------------------------------------

# One network's actions: saves at an administrator's pace pass, a flood past the burst is refused,
# both form posts count as actions, and a request that is no action is never metered.
ACTION_FAILURES=0
ACTION_ID="7f3c0ffee7f3c0ffee7f3c0ffee7f3c0ffee7f3c0f"
# Every transfer of this pass goes to one curl as lines of a config read from stdin (`curl -K -`), not
# as arguments: a pass grows with the bursts it floods past, and Windows caps one command line at
# 32,767 characters. Nothing rewrites a config line as MSYS rewrites an argument, so each file this
# pass writes is named relative to the repository root, where the library leaves the working
# directory, and a body nobody reads goes to a scratch file rather than to `/dev/null`, which a
# Windows curl cannot open.
config_transfer() { # curl options naming one transfer, its one bare argument the URL
  local value
  if (( ${#ACTION_CONFIG[@]} > 0 )); then ACTION_CONFIG+=( "--next" ); fi
  while (( $# > 0 )); do
    case "$1" in
      -s|--head) ACTION_CONFIG+=( "$1" ); shift ;;
      -o|-w|-D|-H|-X|-A|-F|--data|--max-time)
        # Quoted, as a value holding a space must be, with the two escapes a quoted value reads.
        value="${2//\\/\\\\}"; value="${value//\"/\\\"}"
        ACTION_CONFIG+=( "$1 \"${value}\"" ); shift 2 ;;
      -*) refuse "nginx/edge_test.sh's config_transfer has no rule for curl's $1, so it cannot write that transfer." ;;
      *)
        value="${1//\\/\\\\}"; value="${value//\"/\\\"}"
        ACTION_CONFIG+=( "--url \"${value}\"" ); shift ;;
    esac
  done
}
action_request() { # $1 a label, the rest curl options naming one transfer
  local label="$1"; shift
  ACTION_LABELS+=( "$label" )
  config_transfer -s -o "${SCRATCH_NAME}/unread.body" -w '%{http_code}\n' --max-time 5 -H "Host: localhost" "$@"
}
# A spent key still admits one request per refill interval, which a lone probe can land on. Sent
# twice back to back, a pair never holds two admissions, while a key nothing spent answers 200 twice.
spent_request() { # $1 a label, the rest curl options naming one transfer; each half keeps its answer
  local label="$1" half; shift
  for half in a b; do
    ACTION_LABELS+=( "$label" )
    config_transfer -s -D "${SCRATCH_NAME}/${label}-${half}.headers" -o "${SCRATCH_NAME}/${label}-${half}.body" \
      -w '%{http_code}\n' --max-time 5 -H "Host: localhost" "$@"
  done
}
ACTION_LABELS=()
ACTION_CONFIG=()
# Each burst off its own block, so a figure moved there is driven as written.
ACTION_BURST="$(sed -n '/^location \/ {$/,/^}$/s/^[[:space:]]*limit_req zone=action burst=\([0-9]*\) nodelay;$/\1/p' "${REPO_ROOT}/nginx/shared/site.conf")"
[[ -n "$ACTION_BURST" ]] || refuse "nginx/shared/site.conf declares no action burst on location / this test can read."
# Every block's action burst, none above location /'s: Next runs an action at whatever path it is posted to, so a
# block raising it raises every action's ceiling, which the spent link pages below might still answer inside.
mapfile -t ACTION_BURSTS < <(sed -n 's/^[[:space:]]*limit_req zone=action burst=\([0-9]*\) nodelay;$/\1/p' "${REPO_ROOT}/nginx/shared/site.conf")
(( ${#ACTION_BURSTS[@]} > 1 )) || refuse "nginx/shared/site.conf declares no action burst outside location / this test can read."
for _burst in "${ACTION_BURSTS[@]}"; do
  if (( _burst > ACTION_BURST )); then
    fail "ACTION a raised burst"
    detail "nginx/shared/site.conf declares limit_req zone=action burst=${_burst}, above location /'s ${ACTION_BURST}"
    ACTION_FAILURES=$(( ACTION_FAILURES + 1 ))
  fi
done
# Twenty saves at once, under the burst of thirty.
for _ in $(seq 1 20); do
  action_request rhythm -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" \
    --data '[]' "${BASE}/admin/spielorte"
done
# Thirty more inside the same seconds: the burst and the second or two of refill are spent.
for _ in $(seq 1 30); do
  action_request flood -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" \
    --data '[]' "${BASE}/"
done
# The key spent, so each of these is refused only if the map takes it for an action.
spent_request multipart -X POST -F "probe=1" "${BASE}/"
spent_request urlencoded -X POST --data "probe=1" "${BASE}/"
spent_request static-prefix -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' "${BASE}/_next/static/chunk.js"
# An id opening with a colon, which a key joined on `:` would read as no id at all.
spent_request colon-id -X POST -H "Next-Action: :${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' "${BASE}/"
# Each link page's block restates the action pair at location /'s burst: with the key spent past it, a
# flood landing on a link page is refused as one landing anywhere else is.
LINK_ACTION_PATHS=( /confirm/kontakt /registrierung /registrierung/ /erasure /erasure/ )
for _ in $(seq 1 30); do
  action_request link-action-flood -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' \
    "${BASE}/confirm/kontakt"
done
# Each link page's block, whose link pair has room left here, so only its restated action pair refuses,
# at location /'s burst: a block restating it higher may pass these.
for _i in "${!LINK_ACTION_PATHS[@]}"; do
  spent_request "link-action-${_i}" -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' \
    "${BASE}${LINK_ACTION_PATHS[_i]}"
done
# The refusal itself, kept whole: what Next's action client reads as the press's error.
spent_request refusal -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' "${BASE}/"
# And each of these answers 200 only if the map leaves it out, an empty `Next-Action` among them.
action_request empty-id -X POST -H "Next-Action;" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' "${BASE}/"
action_request json-post -X POST -H "Content-Type: application/json" --data '{}' "${BASE}/"
action_request page-load "${BASE}/"
action_request asset-load "${BASE}/_next/static/chunk.js"

# The link pages' pair, every request it meters a page render or the proxy's redirect into one. Its
# burst read off the file, so a burst moved there is still flooded past, with twenty more for the
# refill the run takes.
LINK_BURST="$(sed -n 's/^[[:space:]]*limit_req zone=linkpage burst=\([0-9]*\) nodelay;$/\1/p' "${REPO_ROOT}/nginx/shared/site.conf" | head -n 1)"
[[ -n "$LINK_BURST" ]] || refuse "nginx/shared/site.conf declares no linkpage burst this test can read."
for _ in $(seq 1 $(( LINK_BURST + 20 ))); do
  action_request link-flood "${BASE}/confirm/kontakt?token=${TOK}"
done
# The key spent: every link page and each block's own twin, each kept whole, since a block declaring
# its own error_page answers 429 too.
LINK_MARKER="fl-link"
LINK_SPENT=(
  "/confirm/kontakt?token=${TOK}"
  "/confirm/schiedsrichter?token=${TOK}"
  "/confirm/spieler?token=${TOK}"
  "/confirm/address?token=${TOK}"
  "/registrierung?token=${TOK}"
  "/registrierung/?token=${TOK}"
  "/erasure?token=${TOK}"
  "/erasure/?token=${TOK}"
)
for _i in "${!LINK_SPENT[@]}"; do
  spent_request "link-spent-${_i}" -A "$LINK_MARKER" "${BASE}${LINK_SPENT[_i]}"
done
# A key covering GETs alone lets both of these through, and one exempting HEAD, which a mail
# gateway's link check may send, the second.
spent_request link-json -A "$LINK_MARKER" -X POST -H "Content-Type: application/json" --data '{}' "${BASE}/confirm/kontakt?token=${TOK}"
spent_request link-head -A "$LINK_MARKER" --head "${BASE}/confirm/kontakt?token=${TOK}"

# The code check's pair, read off its own block and flooded past with five more: the library's prefix
# block meters the same path five times as loosely, so a check fallen back to it answers no 429 here.
CODE_BURST="$(sed -n '/^location = \/api\/auth\/sign-in\/email-otp {$/,/^}$/s/^[[:space:]]*limit_req zone=confirmation burst=\([0-9]*\) nodelay;$/\1/p' "${REPO_ROOT}/nginx/shared/site.conf")"
[[ -n "$CODE_BURST" ]] || refuse "nginx/shared/site.conf declares no confirmation burst on the code check this test can read."
for _ in $(seq 1 $(( CODE_BURST + 5 ))); do
  action_request code-flood -X POST -H "Content-Type: application/json" --data '{}' "${BASE}/api/auth/sign-in/email-otp"
done

# A transfer curl never answered reads as `none`.
mapfile -t ACTION_STATUSES < <(printf '%s\n' "${ACTION_CONFIG[@]}" | curl -K - || true)
expect_action() { # $1 label, $2 the status every transfer of it must answer, or "some:<status>"
  local label="$1" wanted="$2" _j _status found=0 all=1 answered=""
  for _j in "${!ACTION_LABELS[@]}"; do
    [[ "${ACTION_LABELS[_j]}" == "$label" ]] || continue
    _status="${ACTION_STATUSES[_j]:-none}"; _status="${_status%$'\r'}"
    answered+="${_status} "
    if [[ "$_status" == "${wanted#some:}" ]]; then found=1; else all=0; fi
  done
  if [[ "$wanted" == some:* ]] && (( found )); then return 0; fi
  if [[ "$wanted" != some:* ]] && (( all )); then return 0; fi
  fail "ACTION ${label}"
  detail "expected ${wanted/some:/at least one } from every '${label}' transfer, nginx answered: ${answered}"
  ACTION_FAILURES=$(( ACTION_FAILURES + 1 ))
}
expect_action rhythm 200
expect_action flood some:429
expect_action multipart some:429
expect_action urlencoded some:429
expect_action static-prefix some:429
expect_action colon-id some:429
expect_action refusal some:429

# The sentence `nginx/shared/site.conf :: @edge_refusal` returns, read off the file so a rewording there
# is graded too.
REFUSAL_WRITTEN="$(sed -n 's/^[[:space:]]*return 429 "\(.*\)";$/\1/p' "${REPO_ROOT}/nginx/shared/site.conf")"
[[ -n "$REFUSAL_WRITTEN" ]] || refuse "nginx/shared/site.conf returns no 429 sentence this test can read."
grade_refusal() { # $1 the transfer's label, its files named for it
  read_headers "${SCRATCH}/$1.headers"
  # Exactly, as Next compares it: a `charset` appended is the failure this case exists for.
  if [[ "${SENT_VALUE[content-type]:-}" != "text/plain" ]]; then
    fail "ACTION $1"
    detail "expected Content-Type: text/plain, nginx sent '${SENT_VALUE[content-type]:-}'"
    ACTION_FAILURES=$(( ACTION_FAILURES + 1 ))
  fi
  # Bytes, not a text read: an appended newline or a byte outside ASCII changes what the frontend compares.
  if ! cmp -s "${SCRATCH}/$1.body" <(printf '%s' "$REFUSAL_WRITTEN") || LC_ALL=C grep -q '[^ -~]' "${SCRATCH}/$1.body"; then
    fail "ACTION $1"
    detail "expected the body '${REFUSAL_WRITTEN}' in ASCII alone, nginx sent '$(cat "${SCRATCH}/$1.body" 2>/dev/null)'"
    ACTION_FAILURES=$(( ACTION_FAILURES + 1 ))
  fi
  grade_security_headers "the edge's own 429, $1"
}
# The page `nginx/shared/site.conf :: @edge_refusal_page` returns, read off the file as nginx sends it:
# the single-quoted string, its newlines kept.
REFUSAL_PAGE="${SCRATCH}/refusal-page.html"
awk "/^[[:space:]]*return 429 '/ { open = 1; sub(/^[[:space:]]*return 429 '/, \"\") }
  open && /^';\$/ { exit }
  open { print }" "${REPO_ROOT}/nginx/shared/site.conf" > "$REFUSAL_PAGE"
[[ -s "$REFUSAL_PAGE" ]] || refuse "nginx/shared/site.conf returns no 429 page this test can read."

# The page's colours against the tokens the rebuilt site paints, `fl_frontend/src/app/tokens.css`, each
# copied by hand under the name that file gives it, and the page's ground and its card's each on the element
# that wears it. The read is a standalone script, so it needs nothing of this scope's interpreter beyond its
# standard library.
PAGE_PALETTE_READ='
import re
import sys

page = open(sys.argv[1], "rb").read().decode("utf-8")
SITE_TOKENS = ("--bg", "--bg-card", "--fg-muted", "--fg", "--border", "--brand")


def body_after(text, opener):
    found = re.search(opener, text)
    if found is None:
        return ""
    depth = 1
    for offset in range(found.end(), len(text)):
        depth += {"{": 1, "}": -1}.get(text[offset], 0)
        if depth == 0:
            return text[found.end():offset]
    return ""


site = open(sys.argv[2] + "/fl_frontend/src/app/tokens.css", "rb").read().decode("utf-8")
site = re.sub(r"/\*.*?\*/", lambda comment: re.sub(r"[^\n]", " ", comment.group(0)), site, flags=re.DOTALL)
problems = []
for theme, site_opener, page_opener in (
    ("light", r":root\s*\{", r":root\s*\{"),
    ("dark", r"\[data-theme=\"dark\"\]\s*\{", r"prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{"),
):
    tokens = dict(re.findall(r"(--[a-z0-9-]+)\s*:\s*(\S+?)\s*;", body_after(site, site_opener)))
    shown = {
        name: "".join(format(int(channel), "02x") for channel in channels)
        for name, *channels in re.findall(r"(--[a-z-]+):\s*rgb\((\d+) (\d+) (\d+)\);", body_after(page, page_opener))
    }
    for name in SITE_TOKENS:
        wanted = tokens.get(name, "").lower().removeprefix(chr(35))
        if not wanted or shown.get(name) != wanted:
            problems.append(f"{theme} {name} reads {shown.get(name)}, tokens.css {wanted or None}")
# Where the two grounds stand: the body is the ground of the page and the box a card on it, as on every rebuilt
# page, so a right value painted on the wrong element is a page in another look.
for element, wanted in (("body", "var(--bg)"), ("main", "var(--bg-card)")):
    rule = body_after(page, r"(?<![\w.:-])" + element + r"\s*\{")
    painted = re.findall(r"(?<![\w-])background(?:-color)?\s*:\s*([^;]+?)\s*;", rule)
    if painted != [wanted]:
        problems.append(f"{element} paints {painted or None}, wanted {wanted}")
print("; ".join(problems))
sys.exit(1 if problems else 0)
'
grade_page() { # $1 the transfer's label, its files named for it; $2 "head" where no body is sent
  read_headers "${SCRATCH}/$1.headers"
  # The charset in the header: a page with none is read in whatever encoding the browser guesses first.
  if [[ "${SENT_VALUE[content-type]:-}" != "text/html; charset=utf-8" ]]; then
    fail "ACTION $1"
    detail "expected Content-Type: text/html; charset=utf-8, nginx sent '${SENT_VALUE[content-type]:-}'"
    ACTION_FAILURES=$(( ACTION_FAILURES + 1 ))
  fi
  if [[ "${2:-}" != head ]] && ! cmp -s "${SCRATCH}/$1.body" "$REFUSAL_PAGE"; then
    fail "ACTION $1"
    detail "expected the body of nginx/shared/site.conf :: @edge_refusal_page, nginx sent $(wc -c < "${SCRATCH}/$1.body" 2>/dev/null || echo no) bytes"
    ACTION_FAILURES=$(( ACTION_FAILURES + 1 ))
  fi
  # The file is what the body is compared to, so a page losing either passes that comparison. Its URL carries the
  # link's token, which a referer to the icon or the start page would hand on.
  local palette
  if [[ "${2:-}" != head ]] && ! grep -qF '<meta name="referrer" content="no-referrer" />' "${SCRATCH}/$1.body"; then
    fail "ACTION $1"
    detail "expected the page to withhold the referrer as every link page does, nginx sent no such meta tag"
    ACTION_FAILURES=$(( ACTION_FAILURES + 1 ))
  fi
  if [[ "${2:-}" != head ]] && ! palette="$("$EDGE_PY" -c "$PAGE_PALETTE_READ" "${SCRATCH}/$1.body" "$REPO_ROOT" 2>&1)"; then
    fail "ACTION $1"
    detail "expected the page's colours to be the rebuilt site's tokens: ${palette}"
    ACTION_FAILURES=$(( ACTION_FAILURES + 1 ))
  fi
  grade_security_headers "the edge's own 429 page, $1"
}
grade_spent() { # $1 a `spent_request` label: graded on the half the edge refused, where one was; $2 "page" or "head"
  local _j half=a
  for _j in "${!ACTION_LABELS[@]}"; do
    [[ "${ACTION_LABELS[_j]}" == "$1" ]] || continue
    if [[ "${ACTION_STATUSES[_j]:-none}" == 429* ]]; then
      if [[ -n "${2:-}" ]]; then grade_page "$1-${half}" "$2"; else grade_refusal "$1-${half}"; fi
      return
    fi
    half=b
  done
}
grade_spent refusal
expect_action empty-id 200
expect_action json-post 200
expect_action page-load 200
expect_action asset-load 200
expect_action link-action-flood some:429
# A link page's action still reads the sentence: the page is its load's alone.
for _i in "${!LINK_ACTION_PATHS[@]}"; do
  _before=$ACTION_FAILURES
  expect_action "link-action-${_i}" some:429
  grade_spent "link-action-${_i}"
  (( ACTION_FAILURES == _before )) || detail "link-action-${_i} posted to ${LINK_ACTION_PATHS[_i]}"
done
expect_action link-flood some:429
for _i in "${!LINK_SPENT[@]}"; do
  _before=$ACTION_FAILURES
  expect_action "link-spent-${_i}" some:429
  grade_spent "link-spent-${_i}" page
  (( ACTION_FAILURES == _before )) || detail "link-spent-${_i} asked for ${LINK_SPENT[_i]}"
done
expect_action link-json some:429
grade_spent link-json
expect_action link-head some:429
grade_spent link-head head
expect_action code-flood some:429

# A refusal's error line repeats the request line, live token included, so `limit_req_log_level` keeps
# it below the log's own level. Read once every kept refusal's access line is written, which comes
# after its error line.
LINK_LOGGED=0
# Every spent link pair is marked, each sending two.
LINK_KEPT=$(( 2 * (${#LINK_SPENT[@]} + 2) ))
for _ in $(seq 1 50); do
  read_streams
  LINK_LOGGED="$({ grep -c "\"user_agent\":\"${LINK_MARKER}\"" "$ACCESS_LOG" 2>/dev/null || true; })"
  if (( ${LINK_LOGGED:-0} >= LINK_KEPT )); then break; fi
  sleep 0.2
done
(( ${LINK_LOGGED:-0} >= LINK_KEPT )) \
  || refuse "the edge logged ${LINK_LOGGED:-0} of the ${LINK_KEPT} link-page requests kept whole, so whether a refusal reached the error log was not judged."
LINK_ERRORS="$({ grep -F "$TOK" "$ERROR_LOG" 2>/dev/null || true; })"
if [[ -n "$LINK_ERRORS" ]]; then
  fail "ACTION link-log"
  detail "an error line on stderr holds a live token: ${LINK_ERRORS}"
  ACTION_FAILURES=$(( ACTION_FAILURES + 1 ))
fi

# --- the body caps --------------------------------------------------------------------------------

# Each cap posted at its figure and one byte past it: the byte past holds a cap raised or dropped, which
# lets the edge buffer a body the application refuses, and the figure holds one lowered, which refuses a
# body the application takes. The figures are the application's own, written here rather than read off
# `nginx/shared/site.conf`, which is what they judge.
BODY_FAILURES=0
# Next's `serverActions.bodySizeLimit` at its default, `1024 * 1024` in
# `next/dist/server/app-render/action-handler.js`, which `fl_frontend/next.config.ts` leaves standing.
# Every page path takes a server action, so `/` stands for the server block's cap.
ACTION_BODY_MAX=1048576
# Room for the largest report `fl_frontend/src/app/api/client-error/route.ts :: ClientErrorReportSchema`
# takes, as `nginx/shared/site.conf :: location = /api/client-error` reasons it; its twin carries the same.
REPORT_BODY_MAX=32768
BODY_CASES=(
  "/|${ACTION_BODY_MAX}"
  "/api/client-error|${REPORT_BODY_MAX}"
  "/api/client-error/|${REPORT_BODY_MAX}"
)
BODY_LABELS=()
BODY_WANTED=()
BODY_REQUESTS=()
for case_line in "${BODY_CASES[@]}"; do
  body_path="${case_line%%|*}"
  body_max="${case_line#*|}"
  for body_size in "$body_max" $(( body_max + 1 )); do
    [[ -f "${SCRATCH}/body-${body_size}" ]] || head -c "$body_size" /dev/zero > "${SCRATCH}/body-${body_size}"
    BODY_LABELS+=( "${body_size} bytes to ${body_path}" )
    if (( body_size > body_max )); then BODY_WANTED+=( 413 ); else BODY_WANTED+=( 200 ); fi
    if (( ${#BODY_REQUESTS[@]} > 0 )); then BODY_REQUESTS+=( --next ); fi
    # A type the action pair's key leaves out, so no zone refuses first; no `Expect`, so each answer is
    # the body's verdict. The relative path, for the MSYS reason at the streams' 413 above.
    BODY_REQUESTS+=( -s -o /dev/null -w '%{http_code}\n' --max-time 10 -H "Host: localhost" -H "Expect:"
      -H "Content-Type: application/octet-stream" --data-binary "@${SCRATCH_NAME}/body-${body_size}" "${BASE}${body_path}" )
  done
done
mapfile -t BODY_STATUSES < <(curl "${BODY_REQUESTS[@]}" || true)
for _j in "${!BODY_LABELS[@]}"; do
  _status="${BODY_STATUSES[_j]:-none}"; _status="${_status%$'\r'}"
  if [[ "$_status" != "${BODY_WANTED[_j]}" ]]; then
    fail "BODY ${BODY_LABELS[_j]}"
    detail "expected ${BODY_WANTED[_j]}, nginx answered ${_status}"
    BODY_FAILURES=$(( BODY_FAILURES + 1 ))
  fi
done

# --- the block production alone serves -----------------------------------------------------------

# `nginx/prod/` mounted as production mounts it, on the plain port the connector dials: the www
# redirect is the one block outside `nginx/shared/site.conf` that includes the header set, and the
# catch-all the one that answers a name nobody configured.
MSYS_NO_PATHCONV=1 docker run -d --name "$PROD_CONTAINER" \
  -p 127.0.0.1:0:80 \
  --network "$NETWORK" \
  "${EDGE_PRIVILEGES[@]}" \
  -v "/${REPO_ROOT}/nginx/prod:/etc/nginx/conf.d:ro" \
  -v "/${REPO_ROOT}/nginx/shared:/etc/nginx/shared:ro" \
  "$EDGE_IMAGE" >/dev/null \
  || refuse "could not start the pinned nginx over nginx/prod/."
PROD_ADDR="$(docker port "$PROD_CONTAINER" 80/tcp | head -n 1)" \
  || refuse "the nginx/prod/ edge published no port."
PROD_ADDR="${PROD_ADDR%$'\r'}"
[[ -n "$PROD_ADDR" ]] || refuse "the nginx/prod/ edge published no port."
PROD_BASE="http://${PROD_ADDR}"
_up=0
for _ in $(seq 1 50); do
  if curl -s -o /dev/null --max-time 2 -H "Host: www.frankfurtleague.de" "${PROD_BASE}/probe" 2>/dev/null; then _up=1; break; fi
  sleep 0.2
done
(( _up )) || refuse "the nginx/prod/ edge never answered on ${PROD_ADDR}."
WWW_STATUS="$(curl -s -o /dev/null -D "${SCRATCH}/headers-www" -w '%{http_code}' --max-time 5 -H "Host: www.frankfurtleague.de" "${PROD_BASE}/probe" || true)"
read_headers "${SCRATCH}/headers-www"
if [[ "$WWW_STATUS" != 301 || "${SENT_VALUE[location]:-}" != "https://frankfurtleague.de/probe" ]]; then
  fail "REDIRECT www.frankfurtleague.de"
  detail "expected 301 to https://frankfurtleague.de/probe, nginx answered ${WWW_STATUS} to '${SENT_VALUE[location]:-}'"
  HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
fi
grade_security_headers "www.frankfurtleague.de"
# A Host no block names, which must reach neither the frontend nor a redirect.
UNKNOWN_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "Host: unrecognised.invalid" "${PROD_BASE}/" || true)"
if [[ "$UNKNOWN_STATUS" != 421 ]]; then
  fail "CATCH-ALL nginx/prod/"
  detail "expected 421 for a Host no block names, nginx answered ${UNKNOWN_STATUS}"
  HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
fi

# --- the upstreams, found by name while both edges serve --------------------------------------------

RESOLVE_FAILURES=0
RESOLVER_HOME="nginx/shared/http.conf"
# Seconds; empty until the shared resolver's `valid` is read.
RESOLVER_VALID=""
# The configuration's own part of finding a recreated upstream; the re-resolution itself is nginx's
# documented behaviour for a `proxy_pass` naming a variable.
judge_resolver() { # $1 the file, relative to the root, $2 its resolver line
  local file="$1" line="$2" token valid="" amount
  local -a tokens addresses=()
  # A directive's words, where `_lib.sh`'s repo-wide IFS splits on newlines and tabs alone.
  local IFS=$' \t'
  # Any other `resolver` replaces the shared one for what it wraps, or is refused at load beside it.
  if [[ "$file" != "$RESOLVER_HOME" ]]; then
    fail "RESOLVER ${file}"
    detail "'${line#"${line%%[![:space:]]*}"}' is not ${RESOLVER_HOME}'s, the one resolver either edge may name"
    RESOLVE_FAILURES=$(( RESOLVE_FAILURES + 1 ))
    return
  fi
  read -ra tokens <<< "${line%%;*}"
  for token in "${tokens[@]:1}"; do
    case "$token" in
      valid=*) valid="${token#valid=}" ;;
      *=*) ;;
      *) addresses+=( "$token" ) ;;
    esac
  done
  # Docker's embedded DNS alone: a second address is asked in turn and cannot find `frontend`.
  if [[ "${addresses[*]}" != "127.0.0.11" ]]; then
    fail "RESOLVER ${file}"
    detail "expected Docker's embedded DNS, 127.0.0.11, alone; the line names '${addresses[*]}'"
    RESOLVE_FAILURES=$(( RESOLVE_FAILURES + 1 ))
  fi
  if [[ -z "$valid" ]]; then
    fail "RESOLVER ${file}"
    detail "names no valid=, so nothing in the configuration bounds how long a worker keeps a recreated container's old address"
    RESOLVE_FAILURES=$(( RESOLVE_FAILURES + 1 ))
    return
  fi
  # nginx's time units this file could carry; a compound such as 1m30s is not read.
  if [[ "$valid" =~ ^([0-9]+)(ms|s|m|h)?$ ]]; then
    amount="${BASH_REMATCH[1]}"
    case "${BASH_REMATCH[2]}" in
      ms) RESOLVER_VALID=$(( amount / 1000 )) ;;
      m) RESOLVER_VALID=$(( amount * 60 )) ;;
      h) RESOLVER_VALID=$(( amount * 3600 )) ;;
      *) RESOLVER_VALID="$amount" ;;
    esac
  else
    refuse "${file}'s resolver holds valid=${valid}, a lifetime this test cannot read."
  fi
}
# Each file's directives as `<file>\t<directive>`, split as nginx's tokeniser splits: at `;`, at `{`,
# at a `}` opening a word, and a `#` opening a word ending the line. A line-anchored read passes a
# one-line location's `proxy_pass`.
conf_directives() { # $@ the files
  awk '
    BEGIN { sq = sprintf("%c", 39) }
    FNR == 1 { emit(); file = FILENAME; q = "" }
    {
      sub(/\r$/, "")
      n = length($0)
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        # A quoted word ends only at its own quote; a backslash keeps the next character.
        if (q != "") {
          buf = buf c
          if (c == "\\" && i < n) { i++; buf = buf substr($0, i, 1) } else if (c == q) q = ""
          continue
        }
        if (buf == "" || buf ~ /[ \t]$/) {
          if (c == "#") break
          if (c == "\"" || c == sq) { q = c; buf = buf c; continue }
          if (c == "}") { emit(); continue }
        }
        # `${name}` keeps its brace, as nginx keeps it.
        if (c == ";" || (c == "{" && substr($0, i - 1, 1) != "$")) { emit(); continue }
        if (c == "\\" && i < n) { buf = buf c; i++; buf = buf substr($0, i, 1); continue }
        buf = buf c
      }
      if (buf != "") buf = buf " "
    }
    END { emit() }
    function emit() {
      gsub(/[ \t]+/, " ", buf); sub(/^ /, "", buf); sub(/ $/, "", buf)
      if (buf != "") print file "\t" buf
      buf = ""
    }
  ' "$@"
}
CONF_FILES=()
for conf in "${REPO_ROOT}"/nginx/shared/*.conf "${REPO_ROOT}"/nginx/local/*.conf "${REPO_ROOT}"/nginx/prod/*.conf; do
  if [[ -f "$conf" ]]; then CONF_FILES+=( "$conf" ); fi
done
CONF_DIRECTIVES="$(conf_directives "${CONF_FILES[@]}")" \
  || refuse "awk could not read the directives of nginx/'s configuration, so no upstream or resolver was judged."
# A literal upstream is a server group, which a variable naming the same host and port matches before
# the resolver is asked: one such directive pins every location naming that upstream to its address at load.
while IFS=$'\t' read -r conf directive; do
  case "$directive" in
    "resolver "*) judge_resolver "${conf#"${REPO_ROOT}/"}" "$directive" ;;
    "proxy_pass "*)
      [[ "$directive" =~ ^proxy_pass\ http://\$(frontend|backend)_upstream$ ]] && continue
      fail "UPSTREAM ${conf#"${REPO_ROOT}/"}"
      detail "'${directive}' names no upstream variable, so nginx resolves it once, as it loads"
      RESOLVE_FAILURES=$(( RESOLVE_FAILURES + 1 ))
      ;;
  esac
done <<< "$CONF_DIRECTIVES"

# The stub's redirect naming `frontend:3000`, which a variable `proxy_pass` hands the visitor as sent
# unless `proxy_redirect` names it.
rm -f "${SCRATCH}/headers-location"
curl -s -o /dev/null -D "${SCRATCH}/headers-location" --max-time 5 -H "Host: localhost" "${BASE}/location-probe" || true
read_headers "${SCRATCH}/headers-location"
if [[ "${SENT_VALUE[location]:-}" != "/landed" ]]; then
  fail "REDIRECT the frontend's own name"
  detail "expected Location: /landed, nginx sent '${SENT_VALUE[location]:-}'"
  RESOLVE_FAILURES=$(( RESOLVE_FAILURES + 1 ))
fi

# The production block reaching the frontend: a `resolver` of its own there replaces the shared one
# for every location it wraps, and a public one finds no `frontend`.
PROD_STATUS="$(curl -s -o /dev/null -D "${SCRATCH}/headers-prod-site" -w '%{http_code}' --max-time 10 \
  -H "Host: frankfurtleague.de" "${PROD_BASE}/" || true)"
read_headers "${SCRATCH}/headers-prod-site"
if [[ "$PROD_STATUS" != 200 || -z "${SENT_VALUE[x-seen-traceparent]:-}" ]]; then
  fail "UPSTREAM frankfurtleague.de/"
  detail "expected the frontend stub's 200 through nginx/prod/, nginx answered '${PROD_STATUS}'"
  RESOLVE_FAILURES=$(( RESOLVE_FAILURES + 1 ))
fi
# Every visitor reached Cloudflare over https, which this plain hop's own scheme does not say.
if [[ "${SENT_VALUE[x-seen-forwarded-proto]:-}" != https ]]; then
  fail "UPSTREAM frankfurtleague.de/"
  detail "expected X-Forwarded-Proto https at Next from nginx/prod/, Next received '${SENT_VALUE[x-seen-forwarded-proto]:-}'"
  RESOLVE_FAILURES=$(( RESOLVE_FAILURES + 1 ))
fi

# --- every access line ------------------------------------------------------------------------------

# Every line the run wrote, the floods' included, each holding the trace id the application's lines
# join it on and a path with no query; and the token on no line of stdout at all, which also catches
# a log beside ours writing the request line whole.
read_streams
mapfile -t LOGGED_LINES < <({ grep '^{' "$ACCESS_LOG" || true; })
(( ${#LOGGED_LINES[@]} > 0 )) || refuse "the edge's stdout holds no access line, so no line was judged."
for logged_line in "${LOGGED_LINES[@]}"; do
  if [[ ! "$logged_line" =~ \"trace_id\":\"[0-9a-f]{32}\", ]]; then
    fail "LINE trace id"
    detail "expected a 32-hex trace_id, nginx wrote: ${logged_line}"
    LINE_FAILURES=$(( LINE_FAILURES + 1 ))
  fi
  logged_path="${logged_line#*\"path\":\"}"
  if [[ "$logged_path" == "$logged_line" || "${logged_path%%\"*}" == *'?'* ]]; then
    fail "LINE path"
    detail "expected a path with no query, nginx wrote: ${logged_line}"
    LINE_FAILURES=$(( LINE_FAILURES + 1 ))
  fi
done
TOKEN_LINES="$({ grep -F "$TOK" "$ACCESS_LOG" || true; })"
if [[ -n "$TOKEN_LINES" ]]; then
  fail "LINE a live token"
  detail "the edge's stdout holds the token: ${TOKEN_LINES}"
  LINE_FAILURES=$(( LINE_FAILURES + 1 ))
fi

if (( LINE_FAILURES + HEADER_FAILURES + ACTION_FAILURES + BODY_FAILURES + RESOLVE_FAILURES > 0 )); then
  die "${LINE_FAILURES} access-line, ${HEADER_FAILURES} header, ${ACTION_FAILURES} server-action, ${BODY_FAILURES} body-cap and ${RESOLVE_FAILURES} upstream cases failed.
Each is what nginx SENT or ANSWERED, or what reached Next through it."
fi

ok "${#LOGGED_LINES[@]} access lines each holding its trace id and no query, the mailed link's token on none,
${#HEADER_PATHS[@]} paths and the www redirect each sending the security headers once as written,
${UPSTREAM_READ} of those paths handing Next the edge's own traceparent, an empty
Next-Action handed to no one, server
actions metered on their own pair and nothing else metered by it, refused in plain text an action reads, every link page
metered on every request, its load refused with the edge's own page and no token reaching the error log,
the code check metered on its own pair, every body cap taking its figure and refusing a byte past it,
every upstream named through a variable and found through Docker's DNS alone, holding an answer ${RESOLVER_VALID}s,
and the frontend's redirect naming itself handed back as the visitor's origin"
