"""
API · the journal replay's refusals: a window or settings it cannot judge by answer 2 and name no value

Run as `scripts/ops/replay_journal.sh` runs it, a process of its own, so what is pinned is the exit the wrapper reads
(`app/api/identitaet/wiederherstellung.py :: _main`); the judging is `tests/api/test_journal_replay.py`'s.
"""

import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest

from tests.core.test_config import an_environment

BACKEND_ROOT: Final = Path(__file__).resolve().parents[2]
SINCE: Final = "2026-10-15T03:00:00+00:00"
UNTIL: Final = "2026-10-15T09:40:00+00:00"


def _replayed(*arguments: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, "-m", "app.api.identitaet.wiederherstellung", *arguments], input=b"", capture_output=True, timeout=120, check=False
    )


def test_settings_it_cannot_read_are_refused_naming_the_files_alone(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """A secret the container cannot read answers 2, the wrapper's refusal, never 1, which the wrapper reads as lines left."""
    an_environment(monkeypatch, tmp_path)
    nowhere = tmp_path / "nowhere"
    monkeypatch.setenv("SECRETS_DIR", str(nowhere))
    monkeypatch.setenv("PYTHONPATH", str(BACKEND_ROOT))

    done = _replayed("--since", SINCE, "--until", UNTIL)

    assert done.returncode == 2, done.stderr
    assert (
        done.stdout.decode().splitlines()[-1]
        == f"The settings could not be read, so no line was judged: Unreadable secret files: {nowhere} (ENOENT)"
    )
    assert done.stderr == b""


@pytest.mark.parametrize(
    ("arguments", "named"),
    [
        pytest.param(("--since", "2026-10-15T03:00:00", "--until", UNTIL), "--since names no offset", id="a moment naming no offset"),
        pytest.param(("--since", UNTIL, "--until", SINCE), "--until is no later than --since", id="a window ending before it starts"),
    ],
)
def test_a_window_it_cannot_read_as_one_is_refused_before_the_settings(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, arguments: tuple[str, ...], named: str
):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PYTHONPATH", str(BACKEND_ROOT))

    done = _replayed(*arguments)

    assert done.returncode == 2
    assert named in done.stderr.decode()
