"""SCRIPTS · what `scripts/ops/replay_journal.sh` hands the backend's container after a restore, and what it answers.

The day files a restore reads are `scripts/ops/export_journal.sh`'s, and the judging is the backend's
(`fl_backend/tests/api/test_journal_replay.py`); this pins the hand-over between them. `replay` and
`day_files` are lifted and run behind a stand-in `docker`, so no case reaches a container.

Invariants:
  Every case runs in a fixture directory of its own, never `/var/log/frankfurtleague`.
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, lift_assignment, lift_function, new_root, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
REPLAY: Final = SCRIPTS / "ops" / "replay_journal.sh"
EXPORT: Final = SCRIPTS / "ops" / "export_journal.sh"

SNAPSHOT: Final = "2026-10-15T03:00:00+00:00"
RESTORED: Final = "2026-10-15T09:40:00Z"
# An export pass an hour after the restore ended, as runbooks §13 has the operator run one.
PASSED: Final = datetime.fromisoformat(RESTORED).timestamp() + 3600

# The module's closing line, which a 1 carries when it is lines left rather than no listing at all.
LEFT: Final = "\\nLeft: 0 erasures to run, 1 lines to replay, 0 records to review, 0 replays that failed.\\n"

# `exec` records its argv and its stdin, and answers what the case asks the module to have printed and answered.
STUB: Final = """#!/usr/bin/env bash
set -u
if [[ "${1:-}" == "compose" && " $* " == *" exec "* ]]; then
  printf '%s\\n' "$@" > "${FL_REPLAY_ARGV}"
  cat > "${FL_REPLAY_STDIN}"
  printf '%b' "${FL_REPLAY_OUT:-}"
  exit "${FL_REPLAY_RC:-0}"
fi
exit 1
"""


def _pass_stamp(script: Path) -> str:
    found = re.fullmatch(r'PASS_STAMP="\$\{LOG_DIR\}/([^"/]+)"', lift_assignment(script, "PASS_STAMP"))
    assert found is not None, f"{script.name} :: PASS_STAMP is no longer a file in the log directory"
    return found.group(1)


class _Fixture:
    def __init__(self) -> None:
        self.root = new_root("fl-replay-journal-")
        self.logs = self.root / "logs"
        self.logs.mkdir()
        self.argv = self.root / "argv.txt"
        self.stdin = self.root / "stdin.txt"
        self.passed(PASSED)

    def passed(self, moment: float | None) -> None:
        """The export's stamp of its last pass at `moment`, or none at all."""
        stamp = self.logs / _pass_stamp(REPLAY)
        if moment is None:
            stamp.unlink(missing_ok=True)
            return
        stamp.write_bytes(b"")
        os.utime(stamp, (moment, moment))

    def day(self, day: str, *lines: str) -> None:
        (self.logs / f"{day}-erasure-journal.log").write_bytes("".join(f"{entry}\n" for entry in lines).encode())

    def handed(self) -> list[str] | None:
        return self.stdin.read_bytes().decode().splitlines() if self.stdin.exists() else None

    def called_with(self) -> list[str] | None:
        return self.argv.read_bytes().decode().splitlines() if self.argv.exists() else None


def _run(
    fixture: _Fixture, *arguments: str, module_rc: int = 0, printed: str = "", moments: tuple[str, str] = (SNAPSHOT, RESTORED)
) -> tuple[int, str]:
    """`_lib.sh`, the lifted replay and a stand-in `docker`."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    stubs = fixture.root / "stubs"
    stubs.mkdir(exist_ok=True)
    os.chmod(write_shell(stubs / "docker", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    environment |= {
        "FL_REPLAY_ARGV": str(fixture.argv),
        "FL_REPLAY_STDIN": str(fixture.stdin),
        "FL_REPLAY_RC": str(module_rc),
        "FL_REPLAY_OUT": printed,
    }
    lines = (
        "#!/usr/bin/env bash",
        f'source "{LIB.as_posix()}"',
        lift_assignment(REPLAY, "COMPOSE"),
        lift_assignment(REPLAY, "REPLAY_MODULE"),
        lift_assignment(REPLAY, "INSTANT"),
        f'LOG_DIR="{fixture.logs.as_posix()}"',
        lift_assignment(REPLAY, "PASS_STAMP"),
        f'JOURNAL_LINES="{(fixture.root / "lines.txt").as_posix()}"',
        f'REPLAY_OUTPUT="{(fixture.root / "output.txt").as_posix()}"',
        lift_function(REPLAY, "day_files"),
        lift_function(REPLAY, "an_instant"),
        lift_function(REPLAY, "replay"),
        f'replay "{moments[0]}" "{moments[1]}" {" ".join(arguments)}',
        "",
    )
    done = run_shell(BASH, write_shell(fixture.root / "parent.sh", "\n".join(lines)), env=environment, cwd=fixture.root)
    return done.returncode, done.stdout + done.stderr


def test_the_module_handed_the_lines_is_the_backend_s_replay() -> None:
    """A renamed module otherwise answers every restore with a crash inside the container, after the snapshot's window has begun to close."""
    found = lift_assignment(REPLAY, "REPLAY_MODULE").removeprefix('REPLAY_MODULE="').removesuffix('"')
    module = REPO_ROOT / "fl_backend" / Path(*found.split(".")).with_suffix(".py")

    assert module.read_text(encoding="utf-8").rstrip().endswith('if __name__ == "__main__":\n    raise SystemExit(_main())')


def test_the_stamp_read_is_the_one_the_export_writes() -> None:
    """Read anywhere else, the guard below refuses every restore, or passes one no pass has read since."""
    assert lift_assignment(REPLAY, "LOG_DIR") == lift_assignment(EXPORT, "LOG_DIR")
    assert _pass_stamp(REPLAY) == _pass_stamp(EXPORT)


@pytest.mark.parametrize(
    "moment",
    [
        pytest.param(None, id="no pass ever stamped"),
        pytest.param(datetime.fromisoformat(RESTORED).timestamp(), id="the last pass at the restore's end"),
    ],
)
def test_a_journal_no_pass_has_read_since_the_restore_ended_is_refused_before_the_container_is_asked(moment: float | None) -> None:
    """A line of the last hour before the restore's end can be in the stream alone, and a missed erasure is silent."""
    fixture = _Fixture()
    fixture.day("2026-10-15")
    fixture.passed(moment)

    code, output = _run(fixture)

    assert code == 2, output
    assert "No export pass has read the backend's stream since the restore ended" in output
    assert "sudo systemctl start frankfurtleague-journal.service" in output
    assert fixture.called_with() is None


def test_the_day_files_from_the_snapshot_s_day_on_are_handed_in_oldest_first() -> None:
    """The day before the snapshot holds only lines its restore already holds the writes of."""
    fixture = _Fixture()
    fixture.day("2026-10-14", "before")
    fixture.day("2026-10-16", "the day after")
    fixture.day("2026-10-15", "the snapshot's day")

    code, output = _run(fixture)

    assert code == 0, output
    assert fixture.handed() == ["the snapshot's day", "the day after"]
    assert fixture.called_with() == [
        "compose",
        "-f",
        "docker-compose.yml",
        "exec",
        "-T",
        "backend",
        "python",
        "-m",
        "app.api.identitaet.wiederherstellung",
        "--since",
        SNAPSHOT,
        "--until",
        RESTORED,
    ]


def test_the_choices_are_written_only_when_asked() -> None:
    fixture = _Fixture()
    fixture.day("2026-10-15")

    code, output = _run(fixture, "--apply")

    assert code == 0, output
    assert (fixture.called_with() or [])[-1] == "--apply"


def test_a_snapshot_s_day_with_no_file_is_refused_before_the_container_is_asked() -> None:
    """The export writes a file for every day the logs hold, so a missing one means lines nobody exported, which an empty answer would hide."""
    fixture = _Fixture()
    fixture.day("2026-10-16", "the day after")

    code, output = _run(fixture)

    assert code == 2, output
    assert "frankfurtleague-journal.service" in output
    assert fixture.called_with() is None


@pytest.mark.parametrize(
    ("moments", "named"),
    [
        pytest.param(("2026-10-15T03:00:00", RESTORED), "the snapshot's, names no offset", id="a snapshot naming no offset"),
        pytest.param((SNAPSHOT, "2026-10-15 09:40"), "the restore's end, names no offset", id="a restore's end naming no offset"),
        pytest.param((SNAPSHOT, "2026-10-15T05:00:00+02:00"), "is no later than the snapshot", id="a restore's end before the snapshot"),
    ],
)
def test_a_window_the_module_would_read_otherwise_is_refused_before_the_container_is_asked(moments: tuple[str, str], named: str) -> None:
    """Read without an offset, a moment is whatever the reading clock makes it, and this host's and the container's need not agree."""
    fixture = _Fixture()
    fixture.day("2026-10-15")

    code, output = _run(fixture, moments=moments)

    assert code == 2, output
    assert named in output
    assert fixture.called_with() is None


@pytest.mark.parametrize(
    ("module_rc", "printed", "expected"),
    [(0, "", 0), (1, LEFT, 1), (1, "", 3), (2, "", 2), (3, "", 3)],
    ids=("done", "left", "no listing", "refused", "crashed"),
)
def test_the_module_s_answer_keeps_the_exit_contract(module_rc: int, printed: str, expected: int) -> None:
    """1 is lines left, counted on the module's closing line.

    A 1 without that line is Compose answering for a service not running, a crash (3) as the module's own is; 2 is a run
    the module refused.
    """
    fixture = _Fixture()
    fixture.day("2026-10-15")

    code, output = _run(fixture, module_rc=module_rc, printed=printed)

    assert code == expected, output
