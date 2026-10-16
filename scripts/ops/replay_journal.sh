#!/usr/bin/env bash
#
# SCRIPTS · after a restore from a snapshot, list every journal line written between the snapshot and the restore's
# end, and replay what they name.
#
# The backend's container reads the day files `scripts/ops/export_journal.sh` keeps, from the snapshot's day on, and
# matches each line against the restored database under the journal's key, so no key is typed and no address is
# printed (`docs/ops/runbooks.md` §13). It exits 1 while anything is left to do, so a run exiting 0 closes the restore.
#
#   ./scripts/ops/replay_journal.sh <snapshot> <restored>           list every line written after the snapshot taken at
#                                                                    <snapshot> and no later than the restore's end at
#                                                                    <restored>, each ISO 8601 with its offset
#   ./scripts/ops/replay_journal.sh <snapshot> <restored> --apply   also write again what those lines name; an erasure
#                                                                    whose address is held anywhere stays the page's
#   ./scripts/ops/replay_journal.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

COMPOSE="docker-compose.yml"

# `scripts/ops/export_journal.sh :: LOG_DIR`, where the day files are.
LOG_DIR="/var/log/frankfurtleague"

# The backend module that judges the lines, run where its settings and the restored database's credentials are.
REPLAY_MODULE="app.api.identitaet.wiederherstellung"

# An ISO 8601 instant naming its offset, as the module reads one: without it, which instant it is depends on the clock
# reading it, and this host's and the container's need not agree.
INSTANT='^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$'

# Every day file from the snapshot's day on, oldest first. The export writes one for every day the logs hold,
# so a snapshot's day without one is an export that has not run since.
day_files() { # $1 the snapshot's UTC day, as YYYY-MM-DD
  local first="$1" file day
  [[ -f "${LOG_DIR}/${first}-erasure-journal.log" ]] || refuse "${LOG_DIR} holds no day file for ${first}, the snapshot's day.
Run the export first: sudo systemctl start frankfurtleague-journal.service (docs/ops/runbooks.md §13)."
  for file in "$LOG_DIR"/*-erasure-journal.log; do
    day="${file##*/}"
    day="${day%-erasure-journal.log}"
    if [[ ! "$day" < "$first" ]]; then cat -- "$file"; fi
  done
}

# Refuses a moment the module would not read as the same instant this host does.
an_instant() { # $1 the moment, $2 whose it is
  [[ "$1" =~ $INSTANT ]] || refuse "${1}, ${2}, names no offset: give it as ISO 8601 with one, as 2026-10-15T03:00:00Z or +02:00."
}

replay() { # $1 the snapshot's moment, $2 the restore's end, $3 `--apply` or nothing
  local since="$1" until="$2" first since_s until_s rc
  local -a apply=() statuses=()
  if [[ -n "${3:-}" ]]; then apply=("$3"); fi
  an_instant "$since" "the snapshot's"
  an_instant "$until" "the restore's end"
  since_s="$(date -u -d "$since" +%s)" || refuse "${since}, the snapshot's, is no moment date can read: give it as ISO 8601 with its offset."
  until_s="$(date -u -d "$until" +%s)" || refuse "${until}, the restore's end, is no moment date can read: give it as ISO 8601 with its offset."
  (( until_s > since_s )) || refuse "The restore's end ${until} is no later than the snapshot ${since}, so no line falls between them."
  first="$(date -u -d "$since" +%F)"

  # Read in full before the container is asked, so a refusal above stops the run before anything is judged.
  day_files "$first" > "${JOURNAL_LINES}"
  docker compose -f "$COMPOSE" exec -T backend python -m "$REPLAY_MODULE" --since "$since" --until "$until" "${apply[@]}" \
    < "${JOURNAL_LINES}" | tee -- "${REPLAY_OUTPUT}" || statuses=("${PIPESTATUS[@]}")
  rc="${statuses[0]:-0}"
  (( ${statuses[1]:-0} == 0 )) || on_error "${statuses[1]}" "${LINENO}" "tee -- ${REPLAY_OUTPUT}"

  # The module's own exit, the contract's: 1 is lines left above, which its closing `Left:` line counts. A 1 without
  # it is no listing: Compose answering for a service not running, or an interpreter stopping before the module ran.
  case "$rc" in
    0) ok "the restored database holds nothing a journal line between ${since} and ${until} asks for" ;;
    1)
      grep -q '^Left: ' -- "${REPLAY_OUTPUT}" || on_error "$rc" "${LINENO}" "python -m ${REPLAY_MODULE}, which ended without its closing Left: line"
      die "lines are left above: replay them with --apply, run each erasure held anywhere again on the page Löschung auf Anfrage, and run this again" ;;
    2) refuse "the backend judged no line: its arguments, its settings or the restored database were refused, as it says above" ;;
    *) on_error "$rc" "${LINENO}" "python -m ${REPLAY_MODULE}" ;;
  esac
}

since=""
until=""
apply_flag=""
for arg in "$@"; do
  case "$arg" in
    --help|-h) usage ;;
    --apply)   apply_flag="--apply" ;;
    -*)        refuse "Unknown option: ${arg}. Try --help." ;;
    *)
      if [[ -z "$since" ]]; then since="$arg"
      elif [[ -z "$until" ]]; then until="$arg"
      else refuse "Two moments only: the snapshot's and the restore's end. Try --help."
      fi ;;
  esac
done
[[ -n "$until" ]] || refuse "Name the moment the restored snapshot was taken and the moment the restore completed, each ISO 8601 with its offset. Try --help."

require_platform linux
JOURNAL_LINES="$(mktemp)"
REPLAY_OUTPUT="$(mktemp)"
# Reclaimed however the run ends: the one holds journal lines, the other what the module said of them.
trap 'rm -f -- "$JOURNAL_LINES" "$REPLAY_OUTPUT" || true' EXIT
replay "$since" "$until" "$apply_flag"
