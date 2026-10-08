#!/usr/bin/env bash
# OPS · the running edge: what its logs CONTAIN, which headers it sends, and which it hands upstream.
#
# `nginx -t` parses, seeing no log line and no response, so a redaction failing open and a location
# dropping a header both pass it. This serves the checkout's own files, never a copy — a copy proves
# the copy — and grades what nginx wrote, sent and answered: `nginx/local/` for every location and
# the Control API the deploy reloads through, started as `docker-compose.yml` starts it, and
# `nginx/prod/` behind a throwaway certificate for the block production alone serves. It answers
# nothing about which locations the edge makes reachable (`docs/ops/spec.md` I13).
#
# Invariants:
# - `docs/logging/spec.md` L11, and the edge's half of L12, the span every line carries.
# - `docs/logging/spec.md` L7 and L10, on every location proxying to the frontend.
# - `docs/ops/spec.md` I2, each security header sent once, as written, on every location's response.
# - `docs/ops/spec.md` I352, no visitor named in the container's own streams.
# - `docs/ops/spec.md` I507, and §1.3's server-action pair.
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
    add_header X-Seen-Next-Action $http_next_action always;
STUB
  for name in "${!SECURITY_HEADERS[@]}"; do printf '    add_header %s "upstream" always;\n' "$name"; done
  # Setting no header, so it forwards every one the edge sent as the edge sent it, to the listener
  # the empty `Next-Action` case starts.
  printf '%s\n' '    location = /next-action-relay { proxy_pass http://127.0.0.1:3001; }'
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

# The edge's image, `command` and `tmpfs` off the model Compose renders for the local stack, by the
# gate's own `scripts/lib/_lib.sh :: render_compose_model`: the Control API the deploy reloads through
# exists only as that command starts that release.
EDGE_PY="$(any_python || true)"
if [[ -z "$EDGE_PY" ]] || ! python_at_floor "$EDGE_PY"; then
  refuse "no python at the checkers' floor, so the edge's command could not be read off its model."
fi
stage_compose_models "${SCRATCH}/model"
render_compose_model "${SCRATCH}/model" local \
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
for key, flag in (("cap_drop", "--cap-drop"), ("cap_add", "--cap-add"), ("security_opt", "--security-opt")):
    for entry in nginx.get(key) or []:
        print("privilege", flag, entry, sep="\t")
'
EDGE_IMAGE=""
EDGE_COMMAND=()
EDGE_TMPFS=()
# The capabilities and options the model starts nginx with, on both edges below: a master refused a
# capability it needs never starts (`docs/ops/spec.md :: I507`).
EDGE_PRIVILEGES=()
mapfile -t EDGE_MODEL < <("$EDGE_PY" -c "$EDGE_MODEL_READ" "${SCRATCH}/model/local.json" \
  || echo "unread")
for model_line in "${EDGE_MODEL[@]}"; do
  model_line="${model_line%$'\r'}"
  case "$model_line" in
    image$'\t'*) EDGE_IMAGE="${model_line#*$'\t'}" ;;
    command$'\t'*) EDGE_COMMAND+=( "${model_line#*$'\t'}" ) ;;
    tmpfs$'\t'*) EDGE_TMPFS+=( --tmpfs "${model_line#*$'\t'}" ) ;;
    privilege$'\t'*)
      model_line="${model_line#*$'\t'}"
      EDGE_PRIVILEGES+=( "${model_line%%$'\t'*}" "${model_line#*$'\t'}" ) ;;
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
  "${EDGE_PRIVILEGES[@]}" \
  -v "/${REPO_ROOT}/nginx/shared:/etc/nginx/shared:ro" \
  -v "/${SCRATCH}/zz-upstream-stub.conf:/etc/nginx/conf.d/zz-upstream-stub.conf:ro" \
  -v "/${SCRATCH}/zz-reload-probe.conf:/etc/nginx/conf.d/zz-reload-probe.conf:ro" \
  -v "/${SCRATCH}/relay-record.sh:/relay-record.sh:ro" \
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
  # The pages a mailed link lands on, each served by `location /`: pins against narrowing the map,
  # which matches the parameter wherever it sits, to a path list.
  "LEAK|${BASE}/bestaetigung/schiedsrichter?token=${TOK}"
  "LEAK|${BASE}/bestaetigung/spieler?token=${TOK}"
  "LEAK|${BASE}/bestaetigung/kontakt?token=${TOK}"
  "LEAK|${BASE}/registrierung?token=${TOK}"
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

  # The referer, which Referrer-Policy: strict-origin-when-cross-origin fills with the whole URL on
  # a same-origin navigation. It needs no misspelling at all to carry a credential.
  "LEAK-REF|http://localhost/x%3Ftoken%3D${TOK}"
  "LEAK-REF|http://localhost/x?a=1&token=${TOK}"
  "LEAK-REF|http://localhost/x/token=${TOK}"
  "LEAK-REF|http://localhost/signin?token=a%20b${TOK}"

  # Controls. Each is a query an operator reads off this line, and a redaction wide enough to eat
  # them is a different defect rather than a fix.
  "KEEP|${BASE}/signin?error=Verification|error=Verification"
  "KEEP|${BASE}/api/bewerbung/kuerzel?q=ABC|q=ABC"
  "KEEP|${BASE}/teams?saison_id=abc&shorthand=FCB|shorthand=FCB"
  "KEEP|${BASE}/bereich/admin/spiele?saison_id=abc|saison_id=abc"

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
    # Reached through `error_page` alone, never a path: the server-action pair below asks it with a
    # request the edge refuses.
    @*) ;;
    # A regex location answers no path this can derive, and probing around it would call the file
    # covered while one of its locations went unasked.
    *) refuse "nginx/shared/site.conf declares 'location ${location_args}', whose path this probe cannot derive." ;;
  esac
done < "${REPO_ROOT}/nginx/shared/site.conf"
(( ${#HEADER_PATHS[@]} > 0 )) || refuse "nginx/shared/site.conf yielded no location to probe."

# The two headers a visitor may not choose (`docs/logging/spec.md` L7 and L10), sent on every
# request below: nginx forwards every request header no `proxy_set_header` names, so a location
# dropping the inherited set hands both to Next as they arrived.
CLIENT_TRACE="0af7651916cd43dd8448eb211c80319c"
CLIENT_ACTOR="fl-edge-actor-probe"
# On a GET, which no zone meters, so every location answers.
CLIENT_ACTION="fl-edge-action-probe"
# One curl for every path, each response's headers to a file of its own, and the counting in bash:
# on Windows a spawn costs ~0.1s, which a grep per header would pay a hundred times.
HEADER_REQUESTS=()
for _i in "${!HEADER_PATHS[@]}"; do
  if (( _i > 0 )); then HEADER_REQUESTS+=( --next ); fi
  HEADER_REQUESTS+=( -s -o /dev/null -D "${SCRATCH}/headers-${_i}" --max-time 5 -H "Host: localhost"
    -H "traceparent: 00-${CLIENT_TRACE}-b7ad6b7169203331-01" -H "X-FL-Actor: ${CLIENT_ACTOR}"
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
  if [[ -n "${SENT_VALUE[x-seen-actor]:-}" ]]; then
    fail "UPSTREAM ${HEADER_PATHS[_i]}"
    detail "expected no X-FL-Actor at Next, Next received '${SENT_VALUE[x-seen-actor]}'"
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
action_request() { # $1 a label, the rest curl options naming one transfer
  local label="$1"; shift
  ACTION_LABELS+=( "$label" )
  if (( ${#ACTION_REQUESTS[@]} > 0 )); then ACTION_REQUESTS+=( --next ); fi
  ACTION_REQUESTS+=( -s -o /dev/null -w '%{http_code}\n' --max-time 5 -H "Host: localhost" "$@" )
}
ACTION_LABELS=()
ACTION_REQUESTS=()
# Twenty saves at once, under the burst of thirty.
for _ in $(seq 1 20); do
  action_request rhythm -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" \
    --data '[]' "${BASE}/bereich/admin/spiele"
done
# Thirty more inside the same seconds: the burst and the second or two of refill are spent.
for _ in $(seq 1 30); do
  action_request flood -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" \
    --data '[]' "${BASE}/"
done
# The key spent, so each of these answers 429 only if the map takes it for an action.
action_request multipart -X POST -F "probe=1" "${BASE}/"
action_request urlencoded -X POST --data "probe=1" "${BASE}/"
action_request admin-prefix -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' "${BASE}/api/admin/probe"
action_request static-prefix -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' "${BASE}/_next/static/chunk.js"
# An id opening with a colon, which a key joined on `:` would read as no id at all.
action_request colon-id -X POST -H "Next-Action: :${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' "${BASE}/"
# The refusal itself, kept whole: what Next's action client reads as the press's error. Not through
# `action_request`, whose `-o /dev/null` curl would pair with this transfer in place of the file.
ACTION_LABELS+=( refusal )
ACTION_REQUESTS+=( --next -s -D "${SCRATCH}/refusal.headers" -o "${SCRATCH}/refusal.body" -w '%{http_code}\n' --max-time 5
  -H "Host: localhost" -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' "${BASE}/" )
# Asked as a browser asks, `gzip_types` naming text/plain: `--compressed` decodes whatever body comes back.
ACTION_LABELS+=( refusal-gzip )
ACTION_REQUESTS+=( --next -s --compressed -H "Accept-Encoding: gzip" -D "${SCRATCH}/refusal-gzip.headers" -o "${SCRATCH}/refusal-gzip.body"
  -w '%{http_code}\n' --max-time 5
  -H "Host: localhost" -X POST -H "Next-Action: ${ACTION_ID}" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' "${BASE}/" )
# And each of these answers 200 only if the map leaves it out, an empty `Next-Action` among them.
action_request empty-id -X POST -H "Next-Action;" -H "Content-Type: text/plain;charset=UTF-8" --data '[]' "${BASE}/"
action_request json-post -X POST -H "Content-Type: application/json" --data '{}' "${BASE}/"
action_request page-load "${BASE}/"
action_request asset-load "${BASE}/_next/static/chunk.js"

mapfile -t ACTION_STATUSES < <(curl "${ACTION_REQUESTS[@]}" || true)
expect_action() { # $1 label, $2 the status every transfer of it must answer, or "some:<status>"
  local label="$1" wanted="$2" _j _status found=0 all=1
  for _j in "${!ACTION_LABELS[@]}"; do
    [[ "${ACTION_LABELS[_j]}" == "$label" ]] || continue
    _status="${ACTION_STATUSES[_j]:-none}"; _status="${_status%$'\r'}"
    if [[ "$_status" == "${wanted#some:}" ]]; then found=1; else all=0; fi
  done
  if [[ "$wanted" == some:* ]] && (( found )); then return 0; fi
  if [[ "$wanted" != some:* ]] && (( all )); then return 0; fi
  fail "ACTION ${label}"
  detail "expected ${wanted/some:/at least one } from every '${label}' transfer, nginx answered: $(
    for _j in "${!ACTION_LABELS[@]}"; do [[ "${ACTION_LABELS[_j]}" == "$label" ]] && printf '%s ' "${ACTION_STATUSES[_j]%$'\r'}"; done)"
  ACTION_FAILURES=$(( ACTION_FAILURES + 1 ))
}
expect_action rhythm 200
expect_action flood some:429
expect_action multipart 429
expect_action urlencoded 429
expect_action admin-prefix 429
expect_action static-prefix 429
expect_action colon-id 429
expect_action refusal 429
expect_action refusal-gzip 429

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
grade_refusal refusal
# nginx's gzip filter leaves a 429 plain, compressing a 200, 403 or 404 alone (observed 2026-10-04); asked
# anyway, so an encoding a later configuration adds is held to the same type and decoded bytes.
grade_refusal refusal-gzip
expect_action empty-id 200
expect_action json-post 200
expect_action page-load 200
expect_action asset-load 200

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
  "${EDGE_PRIVILEGES[@]}" \
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

if (( HEADER_FAILURES + ACTION_FAILURES + CONTROL_FAILURES > 0 )); then
  die "${HEADER_FAILURES} header, ${ACTION_FAILURES} server-action and ${CONTROL_FAILURES} Control API cases failed.
Each is what nginx SENT or ANSWERED, or what reached Next through it."
fi

ok "${#CASES[@]} redaction cases clean, no visitor in the container's own streams,
${#HEADER_PATHS[@]} paths and the www redirect each sending the security headers once as written,
${UPSTREAM_READ} of those paths handing Next the edge's own traceparent and no X-FL-Actor, an empty
Next-Action handed to no one, server
actions metered on their own pair and nothing else metered by it, refused in plain text an action reads, and the Control API applying a reload, refusing a bad one, dumping the checkout and closed to the worker"
