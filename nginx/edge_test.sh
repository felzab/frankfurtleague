#!/usr/bin/env bash
# OPS · the running edge: what its logs CONTAIN, which headers it sends, and which it hands upstream.
#
# `nginx -t` is a parse and sees neither a log line nor a response, so a redaction failing open and a
# location dropping a header both pass it. This serves the checkout's own files, never a copy — a
# copy proves the copy — and grades what nginx wrote, sent and answered: `nginx/local/` for every
# location and the Control API the deploy reloads through, started as `docker-compose.yml` starts
# it, and `nginx/prod/` behind a throwaway certificate for the block production alone serves. Which
# locations the edge makes reachable (`docs/ops/spec.md` I13) is a question this answers nothing
# about.
#
# Invariants:
# - `docs/logging/spec.md` L11, and the edge's half of L12, the span every line carries.
# - `docs/logging/spec.md` L7 and L10, on every location proxying to the frontend.
# - `docs/ops/spec.md` I2, each security header sent once, as written, on every location's response.
# - `docs/ops/spec.md` I352, no visitor named in the container's own streams.
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
# curl, not the image's own wget: a client that tidies a path before sending it rewrites //api,
# /api/./auth and %3F away, and so grades a leak as a pass.
command -v curl >/dev/null 2>&1 \
  || refuse "curl is not on PATH, so the edge's redaction was not driven.
Only curl has --path-as-is, which every alternate spelling in this table needs."
command -v openssl >/dev/null 2>&1 \
  || refuse "openssl is not on PATH, so there is no certificate for nginx/prod/ to serve behind."

# Distinctive enough that a substring test over the whole access line is the assertion.
TOK="Rk9VUlRJTUVTQlJPS0VO"
EM="admin.probe@frankfurtleague.de"

CONTAINER="fl-edge-$$"
PROD_CONTAINER="fl-edge-prod-$$"
# Under the repo root because MSYS rewrites a POSIX-looking path (`scripts/README.md`), and named
# for this run because two runs sharing a path would delete each other's stub.
SCRATCH_NAME=".tmp-edge-$$"
SCRATCH="${REPO_ROOT}/${SCRATCH_NAME}"

cleanup() {
  docker rm -f "$CONTAINER" "$PROD_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$SCRATCH" || true
}
trap cleanup EXIT

rm -rf "$SCRATCH"
# `log/` is what the edge's access_log path resolves to once mounted below, and it must exist
# before the run: Docker would otherwise create it root-owned, which the cleanup cannot remove.
mkdir -p "${SCRATCH}/log"

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

# The stub answers as `frontend` from inside the same nginx, so each case is graded on a real 200
# rather than a 502 that never reached a location. Nothing answers as `backend`, whose 502 the
# stream check below needs.

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
    add_header X-Seen-Actor $http_x_fl_actor always;
STUB
  for name in "${!SECURITY_HEADERS[@]}"; do printf '    add_header %s "upstream" always;\n' "$name"; done
  printf '%s\n' '    location / { return 200 "stub\n"; }' '}'
} > "${SCRATCH}/zz-upstream-stub.conf"
# Empty, and written below the redaction cases to drive a reload nginx refuses.
: > "${SCRATCH}/zz-reload-probe.conf"

# Each `*.conf` of `nginx/local/` mounted by name beside the stub, which a read-only directory
# mount would refuse. The empty tmpfs under them hides the image's own `default.conf`, as the
# stacks' directory mount does.
LOCAL_MOUNTS=( --tmpfs /etc/nginx/conf.d )
for conf in "${REPO_ROOT}"/nginx/local/*.conf; do
  [[ -f "$conf" ]] || continue
  LOCAL_MOUNTS+=( -v "/${conf}:/etc/nginx/conf.d/${conf##*/}:ro" )
done
(( ${#LOCAL_MOUNTS[@]} > 2 )) || refuse "nginx/local/ holds no *.conf, so there is no edge to serve."

# The edge's image, `command` and `tmpfs` off the model Compose renders for the local stack, as
# `scripts/gate/verify.sh`'s compose step renders it: the Control API the deploy reloads through
# exists only as that command starts that release.
EDGE_PY="$(any_python || true)"
if [[ -z "$EDGE_PY" ]] || ! python_at_floor "$EDGE_PY"; then
  refuse "no python at the checkers' floor, so the edge's command could not be read off its model."
fi
mkdir -p "${SCRATCH}/model/fl_backend" "${SCRATCH}/model/fl_frontend"
cp docker-compose.yml docker-compose.local.yml "${SCRATCH}/model/"
: > "${SCRATCH}/model/fl_backend/.env"
: > "${SCRATCH}/model/fl_frontend/.env"
quietly docker compose -f "${SCRATCH}/model/docker-compose.yml" -f "${SCRATCH}/model/docker-compose.local.yml" \
  config --format json --no-env-resolution --output "${SCRATCH}/model/local.json" \
  || refuse "compose could not render the local stack's model, so the edge's command is unknown."
EDGE_MODEL_READ='
import json
import sys

nginx = json.loads(open(sys.argv[1], "rb").read())["services"]["nginx"]
print("image", nginx.get("image") or "", sep="\t")
for argument in nginx.get("command") or []:
    print("command", argument, sep="\t")
tmpfs = nginx.get("tmpfs") or []
for entry in [tmpfs] if isinstance(tmpfs, str) else tmpfs:
    print("tmpfs", entry, sep="\t")
'
EDGE_IMAGE=""
EDGE_COMMAND=()
EDGE_TMPFS=()
mapfile -t EDGE_MODEL < <("$EDGE_PY" -c "$EDGE_MODEL_READ" "${SCRATCH}/model/local.json" \
  || echo "unread")
for model_line in "${EDGE_MODEL[@]}"; do
  model_line="${model_line%$'\r'}"
  case "$model_line" in
    image$'\t'*) EDGE_IMAGE="${model_line#*$'\t'}" ;;
    command$'\t'*) EDGE_COMMAND+=( "${model_line#*$'\t'}" ) ;;
    tmpfs$'\t'*) EDGE_TMPFS+=( --tmpfs "${model_line#*$'\t'}" ) ;;
    *) refuse "the local stack's model could not be read: ${model_line}" ;;
  esac
done
EDGE_SOCKET=""
for _i in "${!EDGE_COMMAND[@]}"; do
  if [[ "${EDGE_COMMAND[_i]}" == "-l" && "${EDGE_COMMAND[_i + 1]:-}" == unix:* ]]; then
    EDGE_SOCKET="${EDGE_COMMAND[_i + 1]#unix:}"
  fi
done
# A finding rather than a refusal: the command is the checkout's, and the deploy cannot reload an
# edge started without it.
[[ -n "$EDGE_SOCKET" ]] \
  || die "the edge's command in docker-compose.yml opens no Control API socket (-l unix:...), which the deploy reloads through."
[[ -n "$EDGE_IMAGE" ]] || refuse "the local stack's model names no image for nginx, so there is no release to serve."
if verbose; then info "the model starts ${EDGE_IMAGE} with: ${EDGE_COMMAND[*]} ${EDGE_TMPFS[*]}"; fi

# The leading slash on each `-v` subject is `scripts/gate/verify.sh`'s nginx step's MSYS exclusion.
MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" \
  -p 127.0.0.1:0:80 \
  --add-host frontend:127.0.0.1 --add-host backend:127.0.0.1 \
  "${LOCAL_MOUNTS[@]}" \
  "${EDGE_TMPFS[@]}" \
  -v "/${REPO_ROOT}/nginx/shared:/etc/nginx/shared:ro" \
  -v "/${SCRATCH}/zz-upstream-stub.conf:/etc/nginx/conf.d/zz-upstream-stub.conf:ro" \
  -v "/${SCRATCH}/zz-reload-probe.conf:/etc/nginx/conf.d/zz-reload-probe.conf:ro" \
  -v "/${SCRATCH}/log:/var/log/frankfurtleague/nginx" \
  "$EDGE_IMAGE" "${EDGE_COMMAND[@]}" >/dev/null \
  || refuse "could not start the pinned nginx for the edge test."

# `docker port`, never a fixed number: a developer's own stack shares this host, and a collision
# would read as a redaction failure rather than as a port already taken.
ADDR="$(docker port "$CONTAINER" 80/tcp | head -n 1)" \
  || refuse "the edge test's nginx published no port."
[[ -n "$ADDR" ]] || refuse "the edge test's nginx published no port."
BASE="http://${ADDR%$'\r'}"

# nginx accepts a connection before the worker serves, so retrying on connect is what separates
# "not up yet" from "refuses this request". It carries no marker, so the grading below ignores it.
_up=0
for _ in $(seq 1 50); do
  if curl -fs -o /dev/null --max-time 2 -H "Host: localhost" "${BASE}/healthprobe" 2>/dev/null; then
    _up=1; break
  fi
  sleep 0.2
done
(( _up )) || refuse "the edge test's nginx never answered on ${BASE}."

# --- the table ---------------------------------------------------------------------------------

#   LEAK|<url>         neither sentinel may appear on the access line
#   LEAK-REF|<referer> as LEAK, with the URL on a Referer header
#   KEEP|<url>|<text>  <text> MUST appear; the controls below carry why

CASES=(
  # The plain case: the library's own verification path, the token in the query.
  "LEAK|${BASE}/api/auth/magic-link/verify?callbackURL=%2F&token=${TOK}"

  # Spellings the raw URI does not begin with, which $request_uri carries and $uri does not. A
  # trailing slash on AUTH_URL produces the first of them for real.
  "LEAK|${BASE}//api/auth/magic-link/verify?token=${TOK}"
  "LEAK|${BASE}/api//auth/magic-link/verify?token=${TOK}"
  "LEAK|${BASE}/%61pi/auth/magic-link/verify?token=${TOK}"
  "LEAK|${BASE}/api/./auth/magic-link/verify?token=${TOK}"
  "LEAK|${BASE}/api/auth/magic-link/verify%3Ftoken=${TOK}"

  # Case, and the trailing slash a prefix written without one still has to cover.
  "LEAK|${BASE}/API/AUTH/MAGIC-LINK/VERIFY?token=${TOK}"
  "LEAK|${BASE}/Api/Auth/Magic-Link/Verify?token=${TOK}"
  "LEAK|${BASE}/api/auth/magic-link/verify/?token=${TOK}"

  # The parameter guard standing alone, on paths the verification prefix never covers -- the mailed
  # landing among them, which is the URL this application actually sends.
  "LEAK|${BASE}/signin/bestaetigen?token=${TOK}"
  # The referee's own landing. The map matches the parameter wherever it sits, so this case is a pin
  # against narrowing it to a path list rather than a fix for anything.
  "LEAK|${BASE}/bestaetigung/schiedsrichter?token=${TOK}"
  # The pupil's own landing, a pin for the referee case's reason.
  "LEAK|${BASE}/bestaetigung/spieler?token=${TOK}"
  # The contact person's own landing, a pin for the referee case's reason.
  "LEAK|${BASE}/bestaetigung/kontakt?token=${TOK}"
  # The pupil's registration landing, a pin for the referee case's reason: the invite link a whole
  # team is handed arrives here, so it is a mailed landing like the four above it.
  "LEAK|${BASE}/registrierung?token=${TOK}"
  "LEAK|${BASE}/api/auth/sign-in/magic-link?token=${TOK}"
  "LEAK|${BASE}/signin?token=${TOK}"
  "LEAK|${BASE}/signin?foo=1&token=${TOK}"
  "LEAK|${BASE}/signin?foo=1&EMAIL=${EM}"

  # A parameter reached past a SECOND literal `?`, which a callbackURL carrying its own query puts
  # there. A separator class of `&` alone walks past it.
  "LEAK|${BASE}/signin?callbackURL=/x?token=${TOK}"
  "LEAK|${BASE}/teams?a=1&callbackURL=/x?email=${EM}"

  # A raw URI with no literal `?` anywhere. $request_uri is never decoded, so the arm that keeps the
  # path has nothing to anchor on and only the backstop reaches these.
  "LEAK|${BASE}/signin%3Ftoken=${TOK}"
  "LEAK|${BASE}/teams%3Femail=${EM}"
  "LEAK|${BASE}/teams%3Ftoken%3D${TOK}"

  # The token VALUE holding each delimiter a class-bounded expression fails open on. Nothing here
  # inspects the value; these exist so that stays true on purpose rather than by luck.
  "LEAK|${BASE}/signin?token=a/b${TOK}"
  "LEAK|${BASE}/signin?token=a%3Fb${TOK}"
  "LEAK|${BASE}/signin?token=a%20b${TOK}"
  "LEAK|${BASE}/signin?token=a%09b${TOK}"
  "LEAK|${BASE}/signin?token=a%22b${TOK}"
  "LEAK|${BASE}/signin?token=a,b${TOK}"
  "LEAK|${BASE}/api/auth/magic-link/verify?token=a%20b${TOK}&email=${EM}"

  # The referer, which Referrer-Policy: strict-origin-when-cross-origin fills with the whole URL on
  # a same-origin navigation. It needs no misspelling at all to carry a credential.
  "LEAK-REF|http://localhost/api/auth/magic-link/verify?token=${TOK}&email=${EM}"
  "LEAK-REF|http://localhost/api/auth/magic-link/verify%3Ftoken=${TOK}"
  "LEAK-REF|http://localhost/x%3Ftoken%3D${TOK}"
  "LEAK-REF|http://localhost/x?a=1&token=${TOK}"
  "LEAK-REF|http://localhost/x/token=${TOK}"
  "LEAK-REF|http://localhost/signin?token=a%20b${TOK}"

  # Controls. Each is a query an operator reads off this line, and a redaction wide enough to eat
  # them is a different defect rather than a fix.
  "KEEP|${BASE}/signin?error=Verification|error=Verification"
  "KEEP|${BASE}/api/bewerbung/kuerzel?q=ABC|q=ABC"
  "KEEP|${BASE}/teams?saison_id=abc&shorthand=FCB|shorthand=FCB"
  "KEEP|${BASE}/admin/spiele?saison_id=abc|saison_id=abc"

  # A control over the CLIENT: it fails when `--path-as-is` stops taking effect, and every
  # spelling above is then graded on a path nginx never received.
  "KEEP|${BASE}/teams/./x?saison_id=abc|/teams/./x"
)

# `user_agent`: the one field `nginx/shared/http.conf :: log_format fl_json` carries unredacted and no
# map reads, so no case is graded on a neighbour's line.
MARKER="fl-redaction"

# One curl, one `docker logs`: on Windows a spawn costs ~0.1s and a `docker logs` ~0.3s
# (2026-09-02). `--next` gives each transfer its own options, so --path-as-is and a Referer bind
# per request.
REQUESTS=()
_n=0
for case_line in "${CASES[@]}"; do
  # Split on a bar, never whitespace: `_lib.sh` sets IFS to newline and tab, and several subjects
  # carry a comma or a space. Expansion, not a helper: an MSYS fork costs more than the request.
  verb="${case_line%%|*}"
  rest="${case_line#*|}"
  subject="${rest%%|*}"

  _n=$(( _n + 1 ))
  if (( _n > 1 )); then REQUESTS+=( --next ); fi
  REQUESTS+=( -s -o /dev/null --path-as-is --max-time 5 -H "Host: localhost" -A "${MARKER}/${_n}" )
  case "$verb" in
    LEAK|KEEP)  REQUESTS+=( "$subject" ) ;;
    LEAK-REF)   REQUESTS+=( -H "Referer: ${subject}" "${BASE}/teams" ) ;;
    *)          die "nginx/edge_test.sh: unknown verb '${verb}' in its own table." ;;
  esac
done

CURL_RC=0
curl "${REQUESTS[@]}" || CURL_RC=$?

ACCESS_LOG="${SCRATCH}/log/access.log"

# The bind mount carries a line to this host after curl already has the response, so one read races
# the last case. Re-reading costs nothing once the file is complete.

# Marked lines only: the warm-up loop's own requests are logged here too.
LOGGED_LINES=()
declare -A LINE_OF=()
MARKED=0
for _ in $(seq 1 50); do
  LINE_OF=()
  MARKED=0
  # `|| true` on the grep alone: an empty file is a finding below rather than an error here.
  mapfile -t LOGGED_LINES < <({ grep '^{' "$ACCESS_LOG" 2>/dev/null || true; })
  for logged_line in "${LOGGED_LINES[@]}"; do
    _ua="${logged_line##*\"user_agent\":\"}"
    _ua="${_ua%%\"*}"
    case "$_ua" in "${MARKER}/"*) ;; *) continue ;; esac
    LINE_OF["$_ua"]="$logged_line"
    MARKED=$(( MARKED + 1 ))
  done
  if (( MARKED >= ${#CASES[@]} )); then break; fi
  sleep 0.2
done

# `refuse`, not `die`: nothing was judged, and a 1 here would read as a leak nobody observed.
if (( MARKED != ${#CASES[@]} )); then
  refuse "the edge logged ${MARKED} marked access lines for ${#CASES[@]} cases into ${ACCESS_LOG},
curl having exited ${CURL_RC}, so the stream this grades on is not the table. No case above was
judged."
fi

FAILURES=0
_n=0

for case_line in "${CASES[@]}"; do
  _n=$(( _n + 1 ))
  verb="${case_line%%|*}"
  rest="${case_line#*|}"
  subject="${rest%%|*}"
  expected="${rest#*|}"
  logged="${LINE_OF["${MARKER}/${_n}"]:-}"
  _before=$FAILURES

  if [[ -z "$logged" ]]; then
    fail "${verb} ${subject}"
    detail "nginx wrote no access line for this case"
    FAILURES=$(( FAILURES + 1 ))
    continue
  fi

  case "$verb" in
    LEAK|LEAK-REF)
      if [[ "$logged" == *"$TOK"* || "$logged" == *"$EM"* ]]; then
        fail "${verb} ${subject}"
        detail "$logged"
        FAILURES=$(( FAILURES + 1 ))
      fi
      ;;
    KEEP)
      if [[ "$logged" != *"$expected"* ]]; then
        fail "KEEP ${subject}"
        detail "expected ${expected} on the access line, nginx wrote: ${logged}"
        FAILURES=$(( FAILURES + 1 ))
      fi
      ;;
  esac

  # Every line carries the edge's two ids in the envelope's shape, the span the trace's first
  # sixteen hex (docs/logging/spec.md L12): a `map` capture that failed would leave `span_id`
  # empty and pass every LEAK case above.
  if [[ ! "$logged" =~ \"trace_id\":\"([0-9a-f]{32})\",\"span_id\":\"([0-9a-f]{16})\", ]]; then
    fail "IDS ${subject}"
    detail "expected trace_id (32 hex) and span_id (16 hex) on the access line, nginx wrote: ${logged}"
    FAILURES=$(( FAILURES + 1 ))
  elif [[ "${BASH_REMATCH[1]:0:16}" != "${BASH_REMATCH[2]}" ]]; then
    fail "IDS ${subject}"
    detail "expected span_id to be trace_id's first sixteen hex, nginx wrote: ${logged}"
    FAILURES=$(( FAILURES + 1 ))
  fi

  # A passing case only: a failing one already carries its line under its own verdict, and the
  # evidence behind a pass is what the captured run cannot give back afterwards.

  # Prefixed, or the verb naming the case class reads as the verdict: `LEAK <url>` beside an access
  # line is the shape somebody scanning this output for a leak stops at.
  if verbose && (( FAILURES == _before )); then
    info "passed: ${verb} ${subject}"
    detail "$logged"
  fi
done

# --- the container's own streams ---------------------------------------------------------------

# No line in the container's own streams may name a visitor
# (`docs/ops/spec.md :: I352`). nginx writes error lines for the requests it refuses or
# fails itself, and the table above sends none.
STREAM_MARKER="fl-stream"
STREAM=( -s -o /dev/null --max-time 5 -H "Host: localhost" -A "${STREAM_MARKER}/413"
  -X POST --data-binary @- "${BASE}/api/bewerbung" )
STREAM+=( --next -s -o /dev/null --max-time 5 -H "Host: localhost" -A "${STREAM_MARKER}/502"
  "${BASE}/api/v0/system/is_live" )
# The catch-all's 421: a block with no access_log of its own would fall back to the image's stdout.
STREAM+=( --next -s -o /dev/null --max-time 5 -H "Host: unrecognised.invalid"
  -A "${STREAM_MARKER}/421" "${BASE}/" )
STREAM+=( --next -s -o /dev/null --max-time 5 -H "Host: localhost" -A "${STREAM_MARKER}/400"
  -H "X-Oversized: $(printf '%020000d' 0)" "${BASE}/" )
STREAM+=( --next -s -o /dev/null --max-time 5 -H "Host: localhost" -A "${STREAM_MARKER}/asset"
  "${BASE}/_next/static/chunk.js" )
# Past `signin`'s burst, so the zone refuses with 429.
for _ in 1 2 3 4 5 6; do
  STREAM+=( --next -s -o /dev/null --max-time 5 -H "Host: localhost" -A "${STREAM_MARKER}/429"
    -X POST "${BASE}/signin" )
done
# The 413's body on stdin: a file path handed to this curl would meet the MSYS rewriting above.
STREAM_RC=0
head -c 100000 /dev/zero | tr '\0' a | curl "${STREAM[@]}" || STREAM_RC=$?

# The address nginx recorded for this client, which every line below is searched for.
CLIENT_ADDR="${LINE_OF["${MARKER}/1"]#*\"client\":\"}"
CLIENT_ADDR="${CLIENT_ADDR%%\"*}"
[[ -n "$CLIENT_ADDR" ]] || refuse "the first case's access line carries no client address, so the
container's streams have nothing to be searched for."

ERROR_LOG="${SCRATCH}/log/error.log"
# The error line nginx writes for the 413 and for the 502 above, in that order.
EXPECTED_ERRORS=(
  "client intended to send too large body"
  "while connecting to upstream"
)
# The same race as the access log's above: the line reaches this host after the response.
for _ in $(seq 1 50); do
  _found=0
  for expected in "${EXPECTED_ERRORS[@]}"; do
    if grep -qF "$expected" "$ERROR_LOG" 2>/dev/null; then _found=$(( _found + 1 )); fi
  done
  if (( _found == ${#EXPECTED_ERRORS[@]} )); then break; fi
  sleep 0.2
done

for expected in "${EXPECTED_ERRORS[@]}"; do
  _lines="$(grep -F "$expected" "$ERROR_LOG" 2>/dev/null || true)"
  if [[ "$_lines" != *"client: ${CLIENT_ADDR}"* ]]; then
    fail "ERROR-FILE ${expected}"
    detail "no line naming client ${CLIENT_ADDR} in ${ERROR_LOG}, curl having exited ${STREAM_RC}"
    FAILURES=$(( FAILURES + 1 ))
  fi
done

docker logs "$CONTAINER" > "${SCRATCH}/stdout" 2> "${SCRATCH}/stderr" \
  || refuse "could not read the edge test's nginx streams back from Docker."
for stream in stdout stderr; do
  while IFS= read -r logged_line; do
    fail "STREAM ${stream}"
    detail "$logged_line"
    FAILURES=$(( FAILURES + 1 ))
  done < <({ grep -F -e "client: " -e "$CLIENT_ADDR" "${SCRATCH}/${stream}" || true; })
done

if (( FAILURES > 0 )); then
  die "${FAILURES} finding(s) over ${#CASES[@]} redaction cases and the container's own streams.
Each line above is what nginx WROTE."
fi

# --- the security headers, as served (`docs/ops/spec.md` I2) -------------------------------------

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
grade_security_headers() { # $1 what the request was, the headers already read
  local name
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
# Set for a location whose `proxy_pass` names the backend: nothing answers as `backend` here, so
# what it hands upstream is not read.
declare -A TO_BACKEND=()
while IFS= read -r location_line; do
  if [[ "$location_line" =~ ^[[:space:]]*proxy_pass[[:space:]]+http://backend: ]]; then
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
    # A regex or named location answers no path this can derive, and probing around it would call
    # the file covered while one of its locations went unasked.
    *) refuse "nginx/shared/site.conf declares 'location ${location_args}', whose path this probe cannot derive." ;;
  esac
done < "${REPO_ROOT}/nginx/shared/site.conf"
(( ${#HEADER_PATHS[@]} > 0 )) || refuse "nginx/shared/site.conf yielded no location to probe."

# The two headers a visitor may not choose (`docs/logging/spec.md` L7 and L10), sent on every
# request below: nginx forwards every request header no `proxy_set_header` names, so a location
# dropping the inherited set hands both to Next as they arrived.
CLIENT_TRACE="0af7651916cd43dd8448eb211c80319c"
CLIENT_ACTOR="fl-edge-actor-probe"
# One curl for every path, each response's headers to a file of its own, and the counting in bash:
# on Windows a spawn costs ~0.1s, which a grep per header would pay a hundred times.
HEADER_REQUESTS=()
for _i in "${!HEADER_PATHS[@]}"; do
  if (( _i > 0 )); then HEADER_REQUESTS+=( --next ); fi
  HEADER_REQUESTS+=( -s -o /dev/null -D "${SCRATCH}/headers-${_i}" --max-time 5 -H "Host: localhost"
    -H "traceparent: 00-${CLIENT_TRACE}-b7ad6b7169203331-01" -H "X-FL-Actor: ${CLIENT_ACTOR}"
    "${BASE}${HEADER_PATHS[_i]}" )
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
  if [[ -n "${SENT_VALUE[x-seen-actor]:-}" ]]; then
    fail "UPSTREAM ${HEADER_PATHS[_i]}"
    detail "expected no X-FL-Actor at Next, Next received '${SENT_VALUE[x-seen-actor]}'"
    HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
  fi
done

# --- the Control API the deploy reloads through ----------------------------------------------------

# Asked as `scripts/ops/deploy.sh :: edge_control` asks it, and its dump decoded by the deploy's own
# `EDGE_LOADED_SUMS`, read off the script rather than restated.
EDGE_LOADED_SUMS="$(sed -n "/^EDGE_LOADED_SUMS='\$/,/^'\$/p" scripts/ops/deploy.sh | sed '1d;$d')"
[[ -n "$EDGE_LOADED_SUMS" ]] || refuse "scripts/ops/deploy.sh assigns no EDGE_LOADED_SUMS block to decode the dump with."
CONTROL_URL="http://localhost/1/control/config"
CONTROL_FAILURES=0
control() { # $1 the reload's expected status; answers the status in CONTROL_STATUS, the body in CONTROL_BODY
  local reply="" rc=0
  reply="$(MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" curl -sS --max-time 30 --unix-socket "$EDGE_SOCKET" -X PATCH -w '\n%{http_code}' "$CONTROL_URL" 2>&1)" || rc=$?
  reply="${reply//$'\r'/}"
  CONTROL_STATUS="${reply##*$'\n'}"
  CONTROL_BODY="${reply%$'\n'*}"
  if (( rc )) || [[ "$CONTROL_STATUS" != "$1" ]]; then
    fail "CONTROL PATCH, expecting $1"
    detail "curl exited ${rc}, the API answered '${CONTROL_STATUS}': ${CONTROL_BODY}"
    CONTROL_FAILURES=$(( CONTROL_FAILURES + 1 ))
  elif verbose; then
    info "the reload answered ${CONTROL_STATUS}: ${CONTROL_BODY}"
  fi
}

# Applied: 200, and the dump then holds exactly the checkout's files under the two directories.
control 200
CONTROL_RC=0
CONTROL_DUMP="$(MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" curl -sS --fail --max-time 30 --unix-socket "$EDGE_SOCKET" "$CONTROL_URL")" || CONTROL_RC=$?
CONTROL_LISTED="$(printf '%s' "$CONTROL_DUMP" | "$EDGE_PY" -c "$EDGE_LOADED_SUMS")" || CONTROL_RC=$?
declare -A LOADED=() CHECKED_OUT=()
while IFS=' ' read -r loaded_sum loaded_path; do
  loaded_path="${loaded_path%$'\r'}"
  case "$loaded_path" in
    # The stub and the reload probe are this test's own, and no checkout's.
    /etc/nginx/conf.d/zz-upstream-stub.conf|/etc/nginx/conf.d/zz-reload-probe.conf) ;;
    /etc/nginx/conf.d/*|/etc/nginx/shared/*) LOADED["$loaded_path"]="$loaded_sum" ;;
  esac
done <<< "$CONTROL_LISTED"
for conf in nginx/local/*.conf nginx/shared/*; do
  [[ -f "$conf" ]] || continue
  checked_out_sum="$(sha256sum -- "$conf")"
  case "$conf" in
    nginx/local/*) CHECKED_OUT["/etc/nginx/conf.d/${conf##*/}"]="${checked_out_sum%% *}" ;;
    *) CHECKED_OUT["/etc/nginx/shared/${conf##*/}"]="${checked_out_sum%% *}" ;;
  esac
done
CONTROL_DIFFER=()
for loaded_path in "${!CHECKED_OUT[@]}"; do
  [[ "${LOADED[$loaded_path]:-}" == "${CHECKED_OUT[$loaded_path]}" ]] || CONTROL_DIFFER+=( "$loaded_path" )
done
for loaded_path in "${!LOADED[@]}"; do
  [[ -n "${CHECKED_OUT[$loaded_path]:-}" ]] || CONTROL_DIFFER+=( "$loaded_path" )
done
if (( CONTROL_RC || ${#CONTROL_DIFFER[@]} || ${#LOADED[@]} == 0 )); then
  fail "CONTROL GET"
  detail "the dump (exit ${CONTROL_RC}) does not hold the checkout's files as they stand: ${CONTROL_DIFFER[*]:-none loaded}"
  CONTROL_FAILURES=$(( CONTROL_FAILURES + 1 ))
elif verbose; then
  info "the dump holds the checkout's ${#CHECKED_OUT[@]} files, byte for byte"
  printf '%s\n' "${CONTROL_LISTED//$'\r'/}" | detail
fi

# Refused: 422 carrying nginx's own line, and the configuration it had still serving.
printf 'fl_edge_probe_unknown_directive on;\n' > "${SCRATCH}/zz-reload-probe.conf"
control 422
if [[ "$CONTROL_STATUS" == 422 && "$CONTROL_BODY" != *fl_edge_probe_unknown_directive* ]]; then
  fail "CONTROL PATCH, refused"
  detail "the 422 does not name the directive nginx refused: ${CONTROL_BODY}"
  CONTROL_FAILURES=$(( CONTROL_FAILURES + 1 ))
fi
: > "${SCRATCH}/zz-reload-probe.conf"
control 200

# The worker's user may not reach the socket, and the directory holding it is root's alone
# (`docker-compose.yml :: nginx`'s tmpfs mode).
CONTROL_MODES="$(MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" stat -c '%a %U %n' "${EDGE_SOCKET%/*}" "$EDGE_SOCKET" 2>&1 || true)"
CONTROL_MODES="${CONTROL_MODES//$'\r'/}"
if [[ "$CONTROL_MODES" != "700 root ${EDGE_SOCKET%/*}"$'\n'* ]]; then
  fail "CONTROL directory mode"
  detail "expected ${EDGE_SOCKET%/*} at 700, owned by root: ${CONTROL_MODES}"
  CONTROL_FAILURES=$(( CONTROL_FAILURES + 1 ))
elif verbose; then
  printf '%s\n' "$CONTROL_MODES" | detail
fi
CONTROL_WORKER="$(MSYS_NO_PATHCONV=1 docker exec -u nginx "$CONTAINER" curl -sS --max-time 5 --unix-socket "$EDGE_SOCKET" "$CONTROL_URL" 2>&1)" && {
  fail "CONTROL as nginx"
  detail "the worker's user reached the Control API at ${EDGE_SOCKET}"
  CONTROL_FAILURES=$(( CONTROL_FAILURES + 1 ))
}
if verbose; then detail "as nginx: ${CONTROL_WORKER//$'\r'/}"; fi

# --- the block production alone serves -----------------------------------------------------------

# `nginx/prod/` mounted as production mounts it, behind a certificate made for this run: the www
# redirect is the one block outside `nginx/shared/site.conf` that includes the header set.
mkdir -p "${SCRATCH}/certs" "${SCRATCH}/log-prod"
# Relative output paths, for `scripts/gate/verify.sh`'s nginx step's reason: a Windows openssl
# cannot open an MSYS-style absolute path.
MSYS2_ARG_CONV_EXCL="/CN" quietly openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" \
  -keyout "${SCRATCH_NAME}/certs/key.pem" -out "${SCRATCH_NAME}/certs/cert.pem" \
  || refuse "could not generate a throwaway certificate for nginx/prod/."
MSYS_NO_PATHCONV=1 docker run -d --name "$PROD_CONTAINER" \
  -p 127.0.0.1:0:443 \
  --add-host frontend:127.0.0.1 --add-host backend:127.0.0.1 \
  -v "/${REPO_ROOT}/nginx/prod:/etc/nginx/conf.d:ro" \
  -v "/${REPO_ROOT}/nginx/shared:/etc/nginx/shared:ro" \
  -v "/${SCRATCH}/certs:/etc/nginx/certs:ro" \
  -v "/${SCRATCH}/log-prod:/var/log/frankfurtleague/nginx" \
  "$EDGE_IMAGE" >/dev/null \
  || refuse "could not start the pinned nginx over nginx/prod/."
PROD_ADDR="$(docker port "$PROD_CONTAINER" 443/tcp | head -n 1)" \
  || refuse "the nginx/prod/ edge published no port."
PROD_ADDR="${PROD_ADDR%$'\r'}"
[[ -n "$PROD_ADDR" ]] || refuse "the nginx/prod/ edge published no port."
# The name resolved to the published port, so the handshake's SNI and the Host header are the
# redirect's own, as a visitor's are.
WWW=( --resolve "www.frankfurtleague.de:${PROD_ADDR##*:}:127.0.0.1" "https://www.frankfurtleague.de:${PROD_ADDR##*:}/probe" )
_up=0
for _ in $(seq 1 50); do
  if curl -sk -o /dev/null --max-time 2 "${WWW[@]}" 2>/dev/null; then _up=1; break; fi
  sleep 0.2
done
(( _up )) || refuse "the nginx/prod/ edge never answered on ${PROD_ADDR}."
WWW_STATUS="$(curl -sk -o /dev/null -D "${SCRATCH}/headers-www" -w '%{http_code}' --max-time 5 "${WWW[@]}" || true)"
read_headers "${SCRATCH}/headers-www"
if [[ "$WWW_STATUS" != 301 || "${SENT_VALUE[location]:-}" != "https://frankfurtleague.de/probe" ]]; then
  fail "REDIRECT www.frankfurtleague.de"
  detail "expected 301 to https://frankfurtleague.de/probe, nginx answered ${WWW_STATUS} to '${SENT_VALUE[location]:-}'"
  HEADER_FAILURES=$(( HEADER_FAILURES + 1 ))
fi
grade_security_headers "www.frankfurtleague.de"

if (( HEADER_FAILURES + CONTROL_FAILURES > 0 )); then
  die "${HEADER_FAILURES} header and ${CONTROL_FAILURES} Control API cases failed. Each is what nginx SENT or
ANSWERED, or what reached Next through it."
fi

ok "${#CASES[@]} redaction cases clean, no visitor in the container's own streams,
${#HEADER_PATHS[@]} paths and the www redirect each sending the security headers once as written,
${UPSTREAM_READ} of those paths handing Next the edge's own traceparent and no X-FL-Actor, and the
Control API applying a reload, refusing a bad one, dumping the checkout and closed to the worker"
