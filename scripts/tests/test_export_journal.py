"""SCRIPTS · what `scripts/ops/export_journal.sh` copies into the erasure journal's day files.

A restore runs again every requested erasure its snapshot predates, read off these files
(`docs/ops/runbooks.md` §13), so a line the export misses is an erasure that silently comes back.
`scripts/ops/export_journal.sh :: export_days` is lifted and run behind a stand-in `docker`; every
journal line is written by the backend's own formatter, so the token and the envelope the export
selects on are the backend's.

Invariants:
  Every case runs in a fixture directory of its own, never `/var/log/frankfurtleague`.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Final

from conftest import BASH, REPO_ROOT, base_env, declared, lift_assignment, lift_function, new_root, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
EXPORT: Final = SCRIPTS / "ops" / "export_journal.sh"
CRUD: Final = REPO_ROOT / "fl_backend" / "app" / "api" / "identitaet" / "crud.py"

YESTERDAY: Final = "2026-10-15"
TODAY: Final = "2026-10-16"

# `logs` hands back the case's stream, or fails as the case asks; every argv is recorded.
STUB: Final = """#!/usr/bin/env bash
set -u
if [[ "${1:-}" == "compose" && " $* " == *" logs "* ]]; then
  printf '%s\\n' "$@" > "${FL_JOURNAL_ARGV}"
  if [[ -n "${FL_JOURNAL_LIVE_RC:-}" ]]; then exit "${FL_JOURNAL_LIVE_RC}"; fi
  if [[ -n "${FL_JOURNAL_LIVE:-}" ]]; then cat "${FL_JOURNAL_LIVE}"; fi
  exit 0
fi
exit 1
"""

# Each argument `<epoch>:<message>`, one line per argument, through the backend's own formatter.
FORMAT: Final = """
import logging, sys
from app.api.identitaet.crud import ERASURE_JOURNAL_EVENT
from app.core.logging import JSONFormatter
for spec in sys.argv[1:]:
    created, message = spec.split(":", 1)
    message = message.replace("JOURNAL", ERASURE_JOURNAL_EVENT)
    record = logging.LogRecord("frankfurtleague.loeschung", logging.INFO, "crud.py", 1, message, None, None)
    record.created = float(created)
    print(JSONFormatter().format(record))
"""


def _epoch(moment: str) -> float:
    return datetime.fromisoformat(moment).replace(tzinfo=UTC).timestamp()


# Each `(UTC moment, message)`, `JOURNAL` standing for the token.
SPECS: Final = {
    "yesterday": (f"{YESTERDAY}T12:00:00", "JOURNAL aaa"),
    "today": (f"{TODAY}T09:00:00", "JOURNAL bbb"),
    "before": ("2026-10-14T23:59:59", "JOURNAL ccc"),
    "not the journal": (f"{YESTERDAY}T12:00:01", "A request answered"),
    "yesterday later": (f"{YESTERDAY}T18:00:00", "JOURNAL ddd"),
}


@cache
def _lines() -> dict[str, str]:
    """The backend's own lines, formatted once for the module rather than at its collection."""
    formatted = subprocess.run(
        [sys.executable, "-c", FORMAT, *(f"{_epoch(moment)}:{message}" for moment, message in SPECS.values())],
        cwd=REPO_ROOT / "fl_backend",
        capture_output=True,
        check=True,
        env=base_env(),
        encoding="utf-8",
    )
    return dict(zip(SPECS, formatted.stdout.splitlines(), strict=True))


def line(name: str) -> str:
    return _lines()[name]


def _copied(line: str, moment: str) -> str:
    """A line as `scripts/ops/deploy.sh :: copy_streams` writes it: compose's prefix, then Docker's own stamp."""
    return f"backend-1  | {moment}.000000000Z {line}"


class _Fixture:
    def __init__(self) -> None:
        self.root = new_root("fl-export-journal-")
        self.logs = self.root / "logs"
        self.logs.mkdir()
        self.checkout = self.root / "checkout"
        self.checkout.mkdir()
        self.argv = self.root / "argv.txt"
        self.live = self.root / "live.txt"
        self.live.write_bytes(b"")

    def write(self, name: str, *lines: str) -> Path:
        path = self.logs / name
        path.write_bytes("".join(f"{entry}\n" for entry in lines).encode())
        return path

    def stream(self, *lines: str) -> None:
        self.live.write_bytes("".join(f"{entry}\n" for entry in lines).encode())

    def day(self, day: str) -> list[str] | None:
        path = self.logs / f"{day}-erasure-journal.log"
        return path.read_bytes().decode().splitlines() if path.exists() else None


def _run(fixture: _Fixture, *, log_dir: Path | None = None, **overrides: str) -> tuple[int, str]:
    """`_lib.sh`, the lifted export and a stand-in `docker`, over yesterday and today."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    stubs = fixture.root / "stubs"
    stubs.mkdir(exist_ok=True)
    os.chmod(write_shell(stubs / "docker", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    environment["FL_JOURNAL_ARGV"] = str(fixture.argv)
    environment["FL_JOURNAL_LIVE"] = str(fixture.live)
    environment.update(overrides)
    lines = (
        "#!/usr/bin/env bash",
        f'source "{LIB.as_posix()}"',
        f'cd "{fixture.checkout.as_posix()}"',
        lift_assignment(EXPORT, "COMPOSE"),
        lift_assignment(EXPORT, "JOURNAL_TOKEN"),
        f'LOG_DIR="{(log_dir or fixture.logs).as_posix()}"',
        lift_function(EXPORT, "export_days"),
        f"export_days {YESTERDAY} {TODAY}",
        "",
    )
    done = run_shell(BASH, write_shell(fixture.root / "parent.sh", "\n".join(lines)), env=environment, cwd=fixture.checkout)
    return done.returncode, done.stdout + done.stderr


def test_the_token_selected_on_is_the_one_the_backend_writes() -> None:
    """A renamed constant otherwise leaves every later erasure out of the files a restore replays."""
    assert lift_assignment(EXPORT, "JOURNAL_TOKEN") == f'JOURNAL_TOKEN="{declared(CRUD, "ERASURE_JOURNAL_EVENT")}"'


def test_each_journal_line_of_the_stream_lands_in_the_file_of_its_own_day_and_nothing_else_does() -> None:
    fixture = _Fixture()
    fixture.stream(line("before"), line("yesterday"), line("not the journal"), line("today"))

    code, output = _run(fixture)

    assert code == 0, output
    assert fixture.day(YESTERDAY) == [line("yesterday")], output
    assert fixture.day(TODAY) == [line("today")], output
    assert fixture.day("2026-10-14") is None, output


def test_the_stream_is_asked_from_the_first_days_midnight_and_without_a_prefix() -> None:
    fixture = _Fixture()

    code, output = _run(fixture)

    assert code == 0, output
    argv = fixture.argv.read_bytes().decode().splitlines()
    assert argv[argv.index("--since") + 1] == f"{YESTERDAY}T00:00:00Z", argv
    assert "--no-log-prefix" in argv and argv[-1] == "backend", argv


def test_every_backend_copy_a_deploy_left_is_read_with_its_prefix_stripped() -> None:
    """A recreate discards the stream, so a line written before a deploy survives only in its copy."""
    fixture = _Fixture()
    fixture.write("2026-10-16T101500-backend.log", _copied(line("yesterday"), f"{YESTERDAY}T12:00:00"))
    fixture.write("2026-10-16T101500-backend-failed.log", _copied(line("today"), f"{TODAY}T09:00:00"))
    fixture.write("2026-10-16T101500-frontend.log", _copied(line("yesterday later"), f"{YESTERDAY}T18:00:00"))

    code, output = _run(fixture)

    assert code == 0, output
    assert fixture.day(YESTERDAY) == [line("yesterday")], output
    assert fixture.day(TODAY) == [line("today")], output


def test_a_copy_written_before_the_first_day_is_not_read() -> None:
    fixture = _Fixture()
    stale = fixture.write("2026-10-14T080000-backend.log", _copied(line("yesterday"), f"{YESTERDAY}T12:00:00"))
    before = _epoch("2026-10-14T08:00:00")
    os.utime(stale, (before, before))

    code, output = _run(fixture)

    assert code == 0, output
    assert fixture.day(YESTERDAY) == [], output


def test_a_line_no_source_holds_any_more_stays_in_its_file_beside_the_new_ones() -> None:
    """The size cap can rotate a line out of the stream between two passes, and the file keeps it."""
    fixture = _Fixture()
    fixture.write(f"{YESTERDAY}-erasure-journal.log", line("yesterday later"), line("yesterday"))
    fixture.stream(line("yesterday"))

    code, output = _run(fixture)

    assert code == 0, output
    assert fixture.day(YESTERDAY) == [line("yesterday"), line("yesterday later")], output


def test_a_day_with_no_erasure_still_gets_its_file_which_is_how_a_pass_is_seen_to_have_run() -> None:
    fixture = _Fixture()

    code, output = _run(fixture)

    assert code == 0, output
    assert fixture.day(YESTERDAY) == [] and fixture.day(TODAY) == [], output


def test_a_pass_adding_nothing_leaves_the_file_untouched() -> None:
    """The age bound reads a file's mtime, so it counts from the last line the day gained."""
    fixture = _Fixture()
    held = fixture.write(f"{YESTERDAY}-erasure-journal.log", line("yesterday"))
    fixture.stream(line("yesterday"))
    before = time.time() - 3600
    os.utime(held, (before, before))

    code, output = _run(fixture)

    assert code == 0, output
    assert held.stat().st_mtime == before, output


def test_a_stream_that_cannot_be_read_still_lets_the_copies_through_and_refuses() -> None:
    """2, which systemd records as the unit failing: the stream's own lines wait for the next pass."""
    fixture = _Fixture()
    fixture.write("2026-10-16T101500-backend.log", _copied(line("yesterday"), f"{YESTERDAY}T12:00:00"))

    code, output = _run(fixture, FL_JOURNAL_LIVE_RC="1")

    assert code == 2, output
    assert "could not be read (docker compose logs exit 1)" in output, output
    assert fixture.day(YESTERDAY) == [line("yesterday")], output


def test_a_missing_directory_refuses_before_anything_is_written() -> None:
    fixture = _Fixture()

    code, output = _run(fixture, log_dir=fixture.root / "absent")

    assert code == 2, output
    assert "is missing or not writable" in output, output
    assert not (fixture.root / "absent").exists(), output
