"""SCRIPTS · what `scripts/ops/replay_journal.sh` hands the backend's container after a restore, and what it answers.

The day files a restore reads are `scripts/ops/export_journal.sh`'s, and the judging is the backend's
(`fl_backend/tests/api/test_journal_replay.py`); this pins the hand-over between them. `replay` and
`day_files` are lifted and run behind a stand-in `docker`, so no case reaches a container.

Invariants:
  Every case runs in a fixture directory of its own, never `/var/log/frankfurtleague`.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, lift_assignment, lift_function, new_root, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
REPLAY: Final = SCRIPTS / "ops" / "replay_journal.sh"

SNAPSHOT: Final = "2026-10-15T03:00:00+00:00"

# `exec` records its argv and its stdin, and answers what the case asks the module to have answered.
STUB: Final = """#!/usr/bin/env bash
set -u
if [[ "${1:-}" == "compose" && " $* " == *" exec "* ]]; then
  printf '%s\\n' "$@" > "${FL_REPLAY_ARGV}"
  cat > "${FL_REPLAY_STDIN}"
  exit "${FL_REPLAY_RC:-0}"
fi
exit 1
"""


class _Fixture:
    def __init__(self) -> None:
        self.root = new_root("fl-replay-journal-")
        self.logs = self.root / "logs"
        self.logs.mkdir()
        self.argv = self.root / "argv.txt"
        self.stdin = self.root / "stdin.txt"

    def day(self, day: str, *lines: str) -> None:
        (self.logs / f"{day}-erasure-journal.log").write_bytes("".join(f"{entry}\n" for entry in lines).encode())

    def handed(self) -> list[str] | None:
        return self.stdin.read_bytes().decode().splitlines() if self.stdin.exists() else None

    def called_with(self) -> list[str] | None:
        return self.argv.read_bytes().decode().splitlines() if self.argv.exists() else None


def _run(fixture: _Fixture, *arguments: str, module_rc: int = 0) -> tuple[int, str]:
    """`_lib.sh`, the lifted replay and a stand-in `docker`."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    stubs = fixture.root / "stubs"
    stubs.mkdir(exist_ok=True)
    os.chmod(write_shell(stubs / "docker", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    environment |= {"FL_REPLAY_ARGV": str(fixture.argv), "FL_REPLAY_STDIN": str(fixture.stdin), "FL_REPLAY_RC": str(module_rc)}
    lines = (
        "#!/usr/bin/env bash",
        f'source "{LIB.as_posix()}"',
        lift_assignment(REPLAY, "COMPOSE"),
        lift_assignment(REPLAY, "REPLAY_MODULE"),
        f'LOG_DIR="{fixture.logs.as_posix()}"',
        f'JOURNAL_LINES="{(fixture.root / "lines.txt").as_posix()}"',
        lift_function(REPLAY, "day_files"),
        lift_function(REPLAY, "replay"),
        f'replay "{SNAPSHOT}" {" ".join(arguments)}',
        "",
    )
    done = run_shell(BASH, write_shell(fixture.root / "parent.sh", "\n".join(lines)), env=environment, cwd=fixture.root)
    return done.returncode, done.stdout + done.stderr


def test_the_module_handed_the_lines_is_the_backend_s_replay() -> None:
    """A renamed module otherwise answers every restore with a crash inside the container, after the snapshot's window has begun to close."""
    found = lift_assignment(REPLAY, "REPLAY_MODULE").removeprefix('REPLAY_MODULE="').removesuffix('"')
    module = REPO_ROOT / "fl_backend" / Path(*found.split(".")).with_suffix(".py")

    assert module.read_text(encoding="utf-8").rstrip().endswith('if __name__ == "__main__":\n    raise SystemExit(_main())')


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


@pytest.mark.parametrize(("module_rc", "expected"), [(0, 0), (1, 1), (2, 2), (3, 3)], ids=("done", "left", "refused", "crashed"))
def test_the_module_s_answer_keeps_the_exit_contract(module_rc: int, expected: int) -> None:
    """1 is lines left to do, which a caller tells apart from the database the module could not read (2) and from a crash (3)."""
    fixture = _Fixture()
    fixture.day("2026-10-15")

    code, output = _run(fixture, module_rc=module_rc)

    assert code == expected, output
