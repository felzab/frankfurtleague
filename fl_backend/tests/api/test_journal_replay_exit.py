"""
API · the journal replay outside a database: the refusals it answers 2 for, naming no value, and the page it names

Run as `scripts/ops/replay_journal.sh` runs it, a process of its own, so what is pinned is the exit the wrapper reads
(`app/api/identitaet/wiederherstellung.py :: _main`); the judging is `tests/api/test_journal_replay.py`'s.
"""

import re
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest

from app.api.identitaet.wiederherstellung import LOESCHUNG_SEITE
from tests.core.test_config import an_environment

BACKEND_ROOT: Final = Path(__file__).resolve().parents[2]
# The erasure page's sidemenu entry, which the listing sends an operator to: the container the replay runs in
# holds no frontend source to read the label from.
LOESCHUNG_EINTRAG: Final = (BACKEND_ROOT.parent / "fl_frontend" / "src" / "features" / "admin" / "constants.ts", "LOESCHUNG_EINTRAG")
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


def test_the_replay_names_the_loeschung_page_as_the_sidemenu_does():
    """A label the sidemenu does not show sends the operator after a restore looking for a page that is not there."""

    module, name = LOESCHUNG_EINTRAG
    source = module.read_bytes().decode("utf-8")
    found = re.search(rf'^export const {name} = \{{\n  id: "[a-z]+",\n  label: "(?P<label>[^"]+)",$', source, re.MULTILINE)

    assert found is not None, f"{module.name} does not open {name} with its id and its label"
    assert found["label"] == LOESCHUNG_SEITE, f"the replay names „{LOESCHUNG_SEITE}“, where the sidemenu shows „{found['label']}“"
