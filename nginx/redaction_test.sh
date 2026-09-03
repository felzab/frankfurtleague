#!/usr/bin/env bash
# OPS · what the edge's access line CONTAINS, driven against the pinned nginx.
#
# `nginx -t` is a parse: it cannot see a log line, so a redaction that fails open passes every
# gate. Every way this one can is a row in the table below, grouped by the shape it turns on.
#
# It serves `nginx/local.conf` ITSELF, never a copy — a copy proves the copy — and grades each case
# on the access line nginx wrote rather than on anything this file models.
#
# Enforces `docs/logging/spec.md` invariant L11, whose subject is what the access line CONTAINS. Not
# `docs/ops/spec.md` I13, which is about which locations the edge makes reachable — a different
# question this file answers nothing about.
#
# local.conf rather than prod.conf because prod.conf terminates TLS and needs a certificate to serve
# a request at all, while the three map blocks and the `log_format` are identical between the pair.

_here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/_lib.sh
source "${_here}/scripts/lib/_lib.sh"

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
mkdir -p "$SCRATCH"

# The stub answers as `frontend` and `backend` from inside the same nginx, so each case is graded
# on a real 200 rather than on a 502 that never reached a location.
cat > "${SCRATCH}/zz-upstream-stub.conf" <<'STUB'
server {
    listen 3000;
    listen 8000;
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
  # The plain case: @auth/core's callback, credentials in the query.
  "LEAK|${BASE}/api/auth/callback/resend?callbackUrl=%2F&token=${TOK}&email=${EM}"

  # Spellings the raw URI does not begin with, which $request_uri carries and $uri does not. A
  # trailing slash on AUTH_URL produces the first of them for real.
  "LEAK|${BASE}//api/auth/callback/resend?token=${TOK}"
  "LEAK|${BASE}/api//auth/callback/resend?token=${TOK}"
  "LEAK|${BASE}/%61pi/auth/callback/resend?token=${TOK}"
  "LEAK|${BASE}/api/./auth/callback/resend?token=${TOK}"
  "LEAK|${BASE}/api/auth/callback/resend%3Ftoken=${TOK}"

  # Case, and the callback path with no trailing slash, which a prefix written with one walks past.
  "LEAK|${BASE}/API/AUTH/CALLBACK/resend?token=${TOK}"
  "LEAK|${BASE}/Api/Auth/Callback/resend?token=${TOK}"
  "LEAK|${BASE}/api/auth/callback?token=${TOK}"
  "LEAK|${BASE}/api/auth/callback/?token=${TOK}"

  # The parameter guard standing alone, on paths the callback prefix never covers.
  "LEAK|${BASE}/api/auth/signin/resend?token=${TOK}"
  "LEAK|${BASE}/signin?token=${TOK}"
  "LEAK|${BASE}/signin?foo=1&token=${TOK}"
  "LEAK|${BASE}/signin?foo=1&EMAIL=${EM}"

  # A parameter reached past a SECOND literal `?`, which a callbackUrl carrying its own query puts
  # there. A separator class of `&` alone walks past it.
  "LEAK|${BASE}/signin?callbackUrl=/x?token=${TOK}"
  "LEAK|${BASE}/teams?a=1&callbackUrl=/x?email=${EM}"

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
  "LEAK|${BASE}/api/auth/callback/resend?token=a%20b${TOK}&email=${EM}"

  # The referer, which Referrer-Policy: strict-origin-when-cross-origin fills with the whole URL on
  # a same-origin navigation. It needs no misspelling at all to carry a credential.
  "LEAK-REF|http://localhost/api/auth/callback/resend?token=${TOK}&email=${EM}"
  "LEAK-REF|http://localhost/api/auth/callback/resend%3Ftoken=${TOK}"
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

# The image symlinks the access log to stdout, so one read holds every case. `|| true` on the grep
# alone: an empty stream is a finding below.
LOGGED_LINES=()
mapfile -t LOGGED_LINES < <(docker logs "$CONTAINER" 2>/dev/null | { grep '^{' || true; })

declare -A LINE_OF=()
MARKED=0
for logged_line in "${LOGGED_LINES[@]}"; do
  _ua="${logged_line##*\"user_agent\":\"}"
  _ua="${_ua%%\"*}"
  case "$_ua" in "${MARKER}/"*) ;; *) continue ;; esac
  LINE_OF["$_ua"]="$logged_line"
  MARKED=$(( MARKED + 1 ))
done

# `refuse`, not `die`: nothing was judged, and a 1 here would read as a leak nobody observed.
if (( MARKED != ${#CASES[@]} )); then
  refuse "the edge logged ${MARKED} marked access lines for ${#CASES[@]} cases, curl having
exited ${CURL_RC}, so the stream this grades on is not the table. No case above was judged."
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
done

if (( FAILURES > 0 )); then
  die "${FAILURES} of ${#CASES[@]} redaction cases failed. Each line above is what nginx WROTE."
fi

ok "${#CASES[@]} redaction cases, no credential on an access line"
