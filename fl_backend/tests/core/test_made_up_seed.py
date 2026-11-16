"""
TESTS · the made-up seed's own decisions: the one server it writes to, and every landing state it builds

`scripts/tests/test_made_up_seed_script.py` drives the shell script that runs the seed in a container; what the seed itself
decides is judged here, beside the backend it imports.

Invariants:
- The seed writes only to `LOCAL_SERVER`, and refuses any other server, exit 2, before any client exists, quoting nothing
  of the settings it read.
- Every state of the landing builds a league whose every document its record model reads, with no database, and none
  holds an exit before its season's start or a report on a fixture without a result.
"""

import os
import re
import secrets
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest

from app.core import clock
from app.core.config import MONGODB_URI_FILE, SECRET_FILES
from tests.boot import BACKEND_ROOT, Withheld
from tests.made_up_seed import CRASHED, LANDING_STATES, MadeUpLeague, is_local_server

# Each a server, or a way of naming one, that is not the local stack's own; named, never the URI itself, since a case's
# name is printed by every run.
ELSEWHERE: Final = {
    "managed-cluster": "mongodb+srv://seed-user:not-a-password@cluster0.seed-guard.invalid/?retryWrites=true",
    "another-host": "mongodb://db.seed-guard.invalid:27017/",
    "with-a-login": "mongodb://seed-user:not-a-password@mongo:27017/",
    "another-port": "mongodb://mongo:27018/",
    "beside-another-host": "mongodb://mongo:27017,db.seed-guard.invalid:27017/?replicaSet=rs0",
}

# What each of `ELSEWHERE`'s URIs carries that no other text of a run would.
QUOTED: Final = ("seed-guard", "seed-user", "not-a-password", "27018")

REFUSAL: Final = "The made-up seed writes only to the local or the end-to-end stack's own mongo service, at port 27017."


@pytest.mark.parametrize(
    "uri",
    [
        # As `docker-compose.local.yml :: local_mongodb_uri` names it to the backend.
        "mongodb://mongo:27017/?directConnection=true",
        "mongodb://mongo:27017",
    ],
)
def test_the_local_stack_s_server_is_the_seed_s(uri: str) -> None:
    assert is_local_server(uri)


@pytest.mark.parametrize("uri", ELSEWHERE.values(), ids=ELSEWHERE.keys())
def test_any_other_server_is_not(uri: str) -> None:
    assert not is_local_server(uri)


def seeded(directory: Path, uri: str) -> subprocess.CompletedProcess[str]:
    """`python -m tests.made_up_seed` run to its exit with `uri` as its database's settings, inheriting nothing else."""

    settings = directory / "run-secrets"
    settings.mkdir()
    for name in SECRET_FILES:
        # Bytes: a text-mode write would end each file in a carriage return on Windows.
        (settings / name).write_bytes((uri if name == MONGODB_URI_FILE else secrets.token_hex(32)).encode())
    return run_seed(directory, {"SECRETS_DIR": str(settings), "DB_BASE_NAME": "fl_made_up", "PYTHONPATH": str(BACKEND_ROOT)})


def run_seed(directory: Path, settings: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """`python -m tests.made_up_seed` run to its exit over `settings` alone.

    A process of its own, as the container runs it, so the seed's own read of the settings is what it judges. Run from
    `directory`, so no package's dotenv file is read beside the case's settings.
    """

    environment = Withheld(settings)
    # Windows' sockets cannot load their providers without it, so `asyncio` fails at its import (WinError 10106).
    if "SYSTEMROOT" in os.environ:
        environment["SYSTEMROOT"] = os.environ["SYSTEMROOT"]
    return subprocess.run(
        (sys.executable, "-m", "tests.made_up_seed"),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        env=environment,
        cwd=directory,
        check=False,
    )


@pytest.mark.parametrize("uri", ELSEWHERE.values(), ids=ELSEWHERE.keys())
def test_the_seed_refuses_any_other_server_before_any_client_exists(uri: str, tmp_path: Path) -> None:
    done = seeded(tmp_path, uri)
    said = done.stdout + done.stderr
    # Asked first: every later assertion's message is the output itself.
    assert not any(part in said for part in QUOTED), "the refusal quotes the settings it read"
    assert done.returncode == 2, said
    assert REFUSAL in done.stderr, said
    assert "emptied" not in said and "seeded" not in said, said


def test_an_import_that_fails_answers_crashed(tmp_path: Path) -> None:
    """The script sends the operator to correct the seed on a 1, so the seed failing in itself answers 3."""

    # A package the seed imports, shadowed by one that cannot be imported: an install broken under it.
    (tmp_path / "pydantic").mkdir()
    (tmp_path / "pydantic" / "__init__.py").write_bytes(b'raise ImportError("a broken install")\n')

    done = run_seed(tmp_path, {"PYTHONPATH": os.pathsep.join((str(tmp_path), str(BACKEND_ROOT)))})

    assert (done.returncode, done.stderr.startswith("The made-up seed crashed (ImportError at ")) == (CRASHED, True), done.stdout + done.stderr


def test_a_run_that_fails_answers_crashed_and_names_no_value(tmp_path: Path) -> None:
    """Settings that cannot be built fail inside the run, before any client exists, and their refusal can carry a value."""

    done = run_seed(tmp_path, {"SECRETS_DIR": str(tmp_path), "PYTHONPATH": str(BACKEND_ROOT)})

    assert (done.returncode, done.stdout) == (CRASHED, ""), done.stdout + done.stderr
    # The whole output, one line naming the type and where it was raised: nothing the refusal said reaches it.
    assert re.fullmatch(r"The made-up seed crashed \(EnvironmentValidationError at \S+\.py:\d+\)\.\n", done.stderr), done.stderr


@pytest.mark.parametrize("state", LANDING_STATES)
def test_every_landing_state_builds_and_reads_back(state: str) -> None:
    # Today, as the seed reads it: every date the league holds is relative to the day it runs.
    league = MadeUpLeague(now=clock.now())
    LANDING_STATES[state](league)
    # Each document is read through its record model as it is gathered, so one the model refuses raises here.
    league.documents()


@pytest.mark.parametrize("state", LANDING_STATES)
def test_no_landing_state_holds_what_the_app_refuses_to_write(state: str) -> None:
    league = MadeUpLeague(now=clock.now())
    LANDING_STATES[state](league)
    running = league.running
    # An exit is recorded only once its season has started, whatever day it is dated.
    if running.saison["start_date"] > league.today:
        assert not [row["name"] for row in running.rows if row["austritt"] is not None]
    # A report is adopted from a fixture with a result.
    reported = {report["spiel_id"] for report in league.spielberichte}
    assert not [row["spiel_nr"] for row in running.spiele if row["_id"] in reported and row["ergebnis"] is None]
