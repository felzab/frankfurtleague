#!/usr/bin/env bash
#
# SCRIPTS · copy the erasure journal's lines out of the backend's logs into one host file per day.
#
# A restore runs again every requested erasure its snapshot predates, read off these lines, and the
# stream they are written to outlives neither a recreate nor its own size cap: the day files outlive
# both, for the thirty days `docs/ops/runbooks.md` §7 ages the directory by. The hourly timer that
# section installs runs it, and it writes no database.
#
#   ./scripts/ops/export_journal.sh            union every day the backend's logs still hold into its day file
#   ./scripts/ops/export_journal.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

COMPOSE="docker-compose.yml"

# `scripts/ops/deploy.sh :: LOG_DIR`'s directory: the deploy's copies are read from it, and the day
# files land beside them under the one age bound runbooks §7 sets.
LOG_DIR="/var/log/frankfurtleague"

# The token opening every journal line, `fl_backend/app/api/identitaet/crud.py :: ERASURE_JOURNAL_EVENT`,
# held to it by `scripts/tests/test_export_journal.py`: a line it misses is an erasure no restore runs again.
JOURNAL_TOKEN="loeschung-journal"

# The days a pass writes, today the last. At most runbooks §7's age bound, held to it by
# `scripts/tests/test_export_journal.py`: a day file that bound removed would otherwise be written
# afresh from a source still holding its lines.
JOURNAL_DAYS="30"

for arg in "$@"; do
  case "$arg" in
    --help|-h) usage ;;
    *)         refuse "Unknown option: ${arg}. Try --help." ;;
  esac
done

# Unions each day's lines into that day's file with what it already holds, so a line the size cap
# rotated away since the last pass stays. Days are UTC, as each line's `timestamp` is.
export_days() { # $1 the last day to write, today, as YYYY-MM-DD
  local last="$1" first copy held day target merged newest live_rc=0 read_rc=0
  local -a copies=() piped=()
  first="$(date -u -d "${last} $(( JOURNAL_DAYS - 1 )) days ago" +%F)"
  [[ -d "$LOG_DIR" && -w "$LOG_DIR" ]] || refuse "${LOG_DIR} is missing or not writable by $(id -un), so no journal line was copied.
The deploy creates it; docs/ops/runbooks.md §7 says how to create it by hand."

  # Inside the directory, so each day file moves into place by a rename, and reclaimed however the run
  # ends: it holds journal lines. A global, since the trap fires after this function has returned.
  JOURNAL_WORK="$(mktemp -d "${LOG_DIR}/.journal-export.XXXXXX")"
  # `|| true`: a failure here would replace the run's own exit code with the reclaim's.
  trap 'rm -rf -- "$JOURNAL_WORK" || true' EXIT

  # A recreate discards the stream, so each copy a deploy took since the first day began is read too,
  # its rollback's `-failed` pair included.
  while IFS= read -r -d '' copy; do copies+=("$copy"); done \
    < <(find "$LOG_DIR" -maxdepth 1 -type f -name '*-backend*.log' -newermt "${first} 00:00:00 UTC" -print0)

  # Everything before a line's own `{` is a copy's prefix. Every day the logs hold gets its file, an
  # empty one where no journal line falls on it; the day names that file, so its shape is checked.
  { docker compose -f "$COMPOSE" logs --no-color --no-log-prefix --since "${first}T00:00:00Z" backend 2>/dev/null \
      | awk -v token="$JOURNAL_TOKEN" -v first="$first" -v last="$last" -v work="$JOURNAL_WORK" '
          { sub(/^[^{]*/, "") }
          index($0, "{\"timestamp\": \"") != 1 { next }
          { day = substr($0, 16, 10) }
          day !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/ || day < first || day > last { next }
          !(day in held) { held[day]; printf "" > (work "/" day) }
          index($0, token) { print > (work "/" day) }
        ' - "${copies[@]}"
    piped=("${PIPESTATUS[@]}"); } || :
  live_rc="${piped[0]}"
  read_rc="${piped[1]}"
  (( read_rc == 0 )) || refuse "the logs could not be read (awk exit ${read_rc}), so no day file was written."

  for held in "$JOURNAL_WORK"/*; do
    [[ -f "$held" ]] || continue
    day="${held##*/}"
    target="${LOG_DIR}/${day}-erasure-journal.log"
    merged="${held}.merged"
    if [[ -f "$target" ]]; then
      LC_ALL=C sort -u -- "$held" "$target" > "$merged"
      # Left untouched when nothing is new, so its date stays its newest line's.
      if cmp -s -- "$merged" "$target"; then continue; fi
    else
      LC_ALL=C sort -u -- "$held" > "$merged"
    fi
    # Dated to its newest line, which sorts last: the age bound then counts from the erasure rather
    # than from the pass that first read it, however late that was.
    newest="$(tail -n 1 -- "$merged")"
    if [[ -n "$newest" ]]; then
      newest="${newest#\{\"timestamp\": \"}"
      touch -d "${newest%%\"*}" -- "$merged"
    fi
    mv -f -- "$merged" "$target"
  done

  # After the writes, so a stream that could not be read costs only its own lines: the copies and the
  # day files are unioned whatever it answered.
  (( live_rc == 0 )) || refuse "the backend's stream could not be read (docker compose logs exit ${live_rc}), so only the
deploy copies' lines reached the day files. The next pass that reads the stream copies every line it
still holds, of every day a pass writes, unless its size cap rotates one away first."
}

require_platform linux
export_days "$(date -u +%F)"
ok "the erasure journal's lines are in ${LOG_DIR}"
