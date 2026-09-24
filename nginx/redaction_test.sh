#!/usr/bin/env bash
# OPS · what the edge's access line CONTAINS, driven against the pinned nginx.
#
# `nginx -t` is a parse: it cannot see a log line, so a redaction that fails open passes every
# gate. Every way this one can is a row in the table below, grouped by the shape it turns on.
#
# It serves `nginx/local.conf` ITSELF, never a copy — a copy proves the copy — and grades each case
# on the access line nginx wrote rather than on anything this file models.
#
# Enforces `docs/logging/spec.md` L11, what the access line CONTAINS, and the edge's half of L12,
# the span every line carries; and `docs/ops/spec.md` I352, that the container's own
# streams name no visitor. Not that sheet's I13, which asks which locations the edge makes
# reachable.
#
# local.conf rather than prod.conf because prod.conf terminates TLS and needs a certificate to serve
# a request at all, while its maps, `log_format` and logging directives are identical between the
# pair.
#
#   ./nginx/redaction_test.sh --verbose   print the access line every case was graded on
#   ./nginx/redaction_test.sh --help

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

# Distinctive enough that a substring test over the whole access line is the assertion.
TOK="Rk9VUlRJTUVTQlJPS0VO"
EM="admin.probe@frankfurtleague.de"

CONTAINER="fl-redaction-$$"
# Under the repo root because MSYS rewrites a POSIX-looking path (`scripts/README.md`), and named
# for this run because two runs sharing a path would delete each other's stub.
SCRATCH="${REPO_ROOT}/.tmp-redaction-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$SCRATCH" || true
}
trap cleanup EXIT

rm -rf "$SCRATCH"
# `log/` is what the edge's access_log path resolves to once mounted below, and it must exist
# before the run: Docker would otherwise create it root-owned, which the cleanup cannot remove.
mkdir -p "${SCRATCH}/log"

# The stub answers as `frontend` from inside the same nginx, so each case is graded on a real 200
# rather than a 502 that never reached a location. Nothing answers as `backend`, whose 502 the
# stream check below needs.
cat > "${SCRATCH}/zz-upstream-stub.conf" <<'STUB'
server {
    listen 3000;
    server_name _;
    # Off, so the stub's own lines stay out of the stream being asserted.
    access_log off;
    location / { return 200 "stub\n"; }
}
STUB

# The pinned tag, for `scripts/gate/verify.sh`'s nginx step's reason; the leading slash on each `-v`
# subject is the same MSYS exclusion that step uses.
MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER" \
  -p 127.0.0.1:0:80 \
  --add-host frontend:127.0.0.1 --add-host backend:127.0.0.1 \
  -v "/${REPO_ROOT}/nginx/local.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "/${SCRATCH}/zz-upstream-stub.conf:/etc/nginx/conf.d/zz-upstream-stub.conf:ro" \
  -v "/${SCRATCH}/log:/var/log/frankfurtleague/nginx" \
  nginx:1.31-alpine >/dev/null \
  || refuse "could not start the pinned nginx for the redaction test."

# `docker port`, never a fixed number: a developer's own stack shares this host, and a collision
# would read as a redaction failure rather than as a port already taken.
ADDR="$(docker port "$CONTAINER" 80/tcp | head -n 1)" \
  || refuse "the redaction test's nginx published no port."
[[ -n "$ADDR" ]] || refuse "the redaction test's nginx published no port."
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
(( _up )) || refuse "the redaction test's nginx never answered on ${BASE}."

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

# `user_agent`: the one field `nginx/local.conf :: log_format fl_json` carries unredacted and no
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
    *)          die "nginx/redaction_test.sh: unknown verb '${verb}' in its own table." ;;
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
  || refuse "could not read the redaction test's nginx streams back from Docker."
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

ok "${#CASES[@]} redaction cases clean, and no visitor in the container's own streams"
