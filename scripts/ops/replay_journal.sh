#!/usr/bin/env bash
#
# SCRIPTS · after a restore from a snapshot, list every journal line written since it, and replay the choices they name.
#
# The backend's container reads the day files `scripts/ops/export_journal.sh` keeps, from the snapshot's day on, and
# matches each line against the restored database under the journal's key, so no key is typed and no address is
# printed (`docs/ops/runbooks.md` §13). It exits 1 while anything is left to do, so a run exiting 0 closes the restore.
#
#   ./scripts/ops/replay_journal.sh <moment>           list every line written after the snapshot taken at <moment>, ISO 8601 with its offset
#   ./scripts/ops/replay_journal.sh <moment> --apply   also write every choice those lines name again; erasures stay the page's
#   ./scripts/ops/replay_journal.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

COMPOSE="docker-compose.yml"

# `scripts/ops/export_journal.sh :: LOG_DIR`, where the day files are.
LOG_DIR="/var/log/frankfurtleague"

# The backend module that judges the lines, run where its settings and the restored database's credentials are.
REPLAY_MODULE="app.api.identitaet.wiederherstellung"

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

replay() { # $1 the snapshot's moment, $2 `--apply` or nothing
  local moment="$1" first rc=0
  local -a apply=()
  if [[ -n "${2:-}" ]]; then apply=("$2"); fi
  first="$(date -u -d "$moment" +%F)" || refuse "${moment} is no moment date can read: give the snapshot's as ISO 8601 with its offset."

  # Read in full before the container is asked, so a refusal above stops the run before anything is judged.
  day_files "$first" > "${JOURNAL_LINES}"
  docker compose -f "$COMPOSE" exec -T backend python -m "$REPLAY_MODULE" --since "$moment" "${apply[@]}" < "${JOURNAL_LINES}" || rc=$?

  # The module's own exit, the contract's: 1 is lines left above, 2 a database it could not read.
  case "$rc" in
    0) ok "the restored database holds nothing a journal line after ${moment} asks for" ;;
    1) die "lines are left above: replay the choices with --apply, run each erasure again on the page Löschung auf Anfrage, and run this again" ;;
    2) refuse "the backend could not read the restored database, so no line was judged" ;;
    *) on_error "$rc" "${LINENO}" "python -m ${REPLAY_MODULE}" ;;
  esac
}

moment=""
apply_flag=""
for arg in "$@"; do
  case "$arg" in
    --help|-h) usage ;;
    --apply)   apply_flag="--apply" ;;
    -*)        refuse "Unknown option: ${arg}. Try --help." ;;
    *)         [[ -z "$moment" ]] || refuse "One moment only: the snapshot's. Try --help."; moment="$arg" ;;
  esac
done
[[ -n "$moment" ]] || refuse "Name the moment the restored snapshot was taken, ISO 8601 with its offset. Try --help."

require_platform linux
JOURNAL_LINES="$(mktemp)"
# Reclaimed however the run ends: it holds journal lines.
trap 'rm -f -- "$JOURNAL_LINES" || true' EXIT
replay "$moment" "$apply_flag"
