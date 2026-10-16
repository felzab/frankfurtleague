#!/usr/bin/env bash
#
# SCRIPTS · copy the erasure journal's lines out of the backend's logs into one host file per day.
#
# A restore runs again every requested erasure its snapshot predates, read off these lines, and the
# stream they are written to outlives neither a recreate nor its own size cap: the day files outlive
# both, for the thirty days `docs/ops/runbooks.md` §7 ages the directory by. The hourly timer that
# section installs runs it, and it writes no database.
#
#   ./scripts/ops/export_journal.sh            union yesterday's and today's journal lines into their day files
#   ./scripts/ops/export_journal.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

COMPOSE="docker-compose.yml"

# `scripts/ops/deploy.sh :: LOG_DIR`'s directory: the deploy's copies are read from it, and the day
# files land beside them under the one age bound runbooks §7 sets.
LOG_DIR="/var/log/frankfurtleague"

# The token opening every journal line, `fl_backend/app/api/identitaet/crud.py :: ERASURE_JOURNAL_EVENT`,
# held to it by `scripts/tests/test_export_journal.py`: a line it misses is an erasure no restore runs again.
JOURNAL_TOKEN="loeschung-journal"

for arg in "$@"; do
  case "$arg" in
    --help|-h) usage ;;
    *)         refuse "Unknown option: ${arg}. Try --help." ;;
  esac
done

# Unions each day's lines into that day's file with what it already holds, so a line the size cap
# rotated away since the last pass stays. Days are UTC, as each line's `timestamp` is.
export_days() { # $@ the UTC days, YYYY-MM-DD, oldest first
  local since="$1" day target partial live copy live_rc=0
  local -a copies=() sources=()
  [[ -d "$LOG_DIR" && -w "$LOG_DIR" ]] || refuse "${LOG_DIR} is missing or not writable by $(id -un), so no journal line was copied.
The deploy creates it; docs/ops/runbooks.md §7 says how to create it by hand."

  # One read of the live stream for every day: without a prefix, so its lines and a copy's compare
  # once the copy's prefix is stripped below.
  live="$(mktemp "${LOG_DIR}/.journal-live.XXXXXX")"
  docker compose -f "$COMPOSE" logs --no-color --no-log-prefix --since "${since}T00:00:00Z" backend > "$live" 2>/dev/null || live_rc=$?

  # A recreate discards the stream, so each copy a deploy took since the first day began is read too,
  # its rollback's `-failed` pair included.
  while IFS= read -r -d '' copy; do copies+=("$copy"); done \
    < <(find "$LOG_DIR" -maxdepth 1 -type f -name '*-backend*.log' -newermt "${since} 00:00:00 UTC" -print0)

  for day in "$@"; do
    target="${LOG_DIR}/${day}-erasure-journal.log"
    partial="${target}.partial"
    sources=("$live" "${copies[@]}")
    if [[ -f "$target" ]]; then sources=("$target" "${sources[@]}"); fi
    # Everything before a line's own `{` is a copy's prefix, so the stored line is the backend's.
    awk -v token="$JOURNAL_TOKEN" -v opening="{\"timestamp\": \"${day}T" \
      'index($0, token) { sub(/^[^{]*/, ""); if (index($0, opening) == 1) print }' "${sources[@]}" \
      | LC_ALL=C sort -u > "$partial"
    # Left untouched when nothing is new, so the age bound counts from the last line it gained.
    if [[ -f "$target" ]] && cmp -s "$partial" "$target"; then
      rm -f -- "$partial"
    else
      mv -f -- "$partial" "$target"
    fi
  done
  rm -f -- "$live"

  # After the writes, so a stream that could not be read costs only its own lines: the copies and the
  # day files are unioned whatever it answered.
  (( live_rc == 0 )) || refuse "the backend's stream could not be read (docker compose logs exit ${live_rc}), so only the
deploy copies' lines reached the day files. A line the stream alone holds is copied by the next pass
that reads it, unless its size cap rotates it away first."
}

require_platform linux
export_days "$(date -u -d yesterday +%F)" "$(date -u +%F)"
ok "the erasure journal's lines are in ${LOG_DIR}"
