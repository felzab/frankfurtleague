"""
TESTS · the made-up seed's own decisions: the one server it writes to, and every landing state it builds

`scripts/tests/test_made_up_seed_script.py` drives the shell script that runs the seed in a container; what the seed itself
decides is judged here, beside the backend it imports.

Invariants:
- The seed writes only to `LOCAL_SERVER`, and refuses any other server, exit 2, before any client exists, quoting nothing
  of the settings it read.
- Settings it cannot load are a refusal, 2, and its own 1 opens the line the script reads that 1 by, which the script
  holds to: every other 1, Python's own or Compose's, the script reads as a crash.
- An insert the replica set never acknowledged, a bulk write answered with write-concern errors alone, is a database
  that could not be written, 2, never a crash.
- Every state of the landing builds a league whose every document its record model reads, with no database, and that no
  write of the app's refuses: each rule below is the app's own refusal, so a rule the app tightens tightens this one.
"""

import os
import re
import secrets
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Final

import pytest

from app.api.aufstellungen.services import aufstellung_marks, find_undated_refusal
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_activation_refusal, find_saison_span_refusal, has_started, unplayed_spiel_nrs
from app.api.spielberichte.services import find_cancelled_refusal, find_not_played_refusal
from app.api.spiele.schemas import FLSpiel
from app.api.spiele.services import find_ergebnis_before_start_refusal, find_spiel_date_refusal
from app.api.spieltage.services import DatedNeighbour, find_spieltag_order_refusal, find_spieltag_span_refusal
from app.api.teams.services import find_austritt_refusal
from app.core import clock
from app.core.config import MONGODB_URI_FILE, SECRET_FILES
from app.core.db import new_client
from app.core.exceptions import WriteRefusal
from tests.boot import BACKEND_ROOT, Withheld
from tests.database import a_clean_database
from tests.made_up_seed import AS_WRITTEN, INSERT_REFUSED, LANDING_STATES, UNJUDGED, MadeUpLeague, Season, is_local_server, write
from tests.worker import worker_database

LIBRARY: Final = BACKEND_ROOT.parent / "scripts" / "lib" / "_lib.sh"

# Each a server, or a way of naming one, that is not the local stack's own; named, never the URI itself, since a case's
# name is printed by every run.
ELSEWHERE: Final = {
    "managed-cluster": "mongodb+srv://seed-user:not-a-password@cluster0.seed-guard.invalid/?retryWrites=true",
    "another-host": "mongodb://db.seed-guard.invalid:27017/",
    "with-a-login": "mongodb://seed-user:not-a-password@mongo:27017/",
    "another-port": "mongodb://mongo:27018/",
    "beside-another-host": "mongodb://mongo:27017,db.seed-guard.invalid:27017/?replicaSet=rs0",
    # The local host, from which the driver would follow its replica set's own list of members.
    "joining-its-set": "mongodb://mongo:27017",
}

# What each of `ELSEWHERE`'s URIs carries that no other text of a run would.
QUOTED: Final = ("seed-guard", "seed-user", "not-a-password", "27018")

REFUSAL: Final = (
    "The made-up seed writes only to the local or the end-to-end stack's own mongo service, at port 27017 with directConnection=true."
)


def test_the_local_stack_s_server_is_the_seed_s() -> None:
    # As `docker-compose.local.yml :: local_mongodb_uri` names it to the backend.
    assert is_local_server("mongodb://mongo:27017/?directConnection=true")


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


# An interpreter's start and the seed's imports take a few seconds, and every case here ends before any client exists;
# this is far past them, so only a seed that hangs reaches it.
SEED_BOUND_S: Final = 60.0


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
        cwd=directory,
        env=environment,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=SEED_BOUND_S,
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


def test_settings_that_cannot_load_are_a_refusal(tmp_path: Path) -> None:
    """Settings that cannot be built are a configuration it could not load: nothing was judged, before any client exists."""

    done = run_seed(tmp_path, {"SECRETS_DIR": str(tmp_path), "PYTHONPATH": str(BACKEND_ROOT)})

    assert (done.returncode, done.stdout) == (UNJUDGED, ""), done.stdout + done.stderr
    # One line, the settings' own refusal as the backend's boot logs it, naming the files missing from the empty directory.
    assert re.fullmatch(r"The settings could not be loaded: [^\n]*Invalid secret files: [^\n]+\n", done.stderr), done.stderr


UNACKNOWLEDGED_DATABASE: Final = worker_database("fl_made_up_seed_unacknowledged")


@pytest.mark.db
async def test_an_insert_the_set_never_acknowledged_is_a_database_that_could_not_be_written(
    mongo_replica_set_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
    # Empty, so the seed has nothing to empty first: its first write is the first insert. The clean database's TTL check
    # stays off, since the seed's documents are dated on the real clock and the case judges the exit code alone.
    async with a_clean_database(mongo_replica_set_url, UNACKNOWLEDGED_DATABASE, constraints=False):
        # Two acknowledging members asked of a set of one: the server writes each insert and answers it with a write-concern
        # error alone, as a majority write the set never acknowledged answers.
        unacknowledged = new_client(mongo_replica_set_url, w=2)
        try:
            code = await write(unacknowledged, UNACKNOWLEDGED_DATABASE, LANDING_STATES[AS_WRITTEN](clock.now()))
        finally:
            await unacknowledged.close()

    assert (code, capsys.readouterr().err) == (UNJUDGED, "The database could not be written (BulkWriteError).\n")


def test_the_refused_insert_s_line_is_the_one_the_script_reads_a_finding_by() -> None:
    """A wording the script's pattern stops matching turns every insert to correct into a crash."""

    assert class_of(1, INSERT_REFUSED.format(reason="E11000 duplicate key error") + "\n") == "1", INSERT_REFUSED
    # A 1 without that line is Compose's or Python's own.
    assert class_of(1, "Traceback (most recent call last):\n") == "3"


def class_of(status: int, output: str) -> str:
    """The class the scripts' library gives the seed's `status` beside `output`, read by bash itself.

    Bash matches the pattern as a POSIX extended expression, which Python's `re` reads otherwise: `\\d` matches a digit
    there and a `d` here.
    """
    bash = shutil.which("bash")
    assert bash is not None, "no bash on PATH, which every script under scripts/ needs"
    read = 'source "$1"; class=0; exit_class made-up-seed "$2" "$3" || class=$?; printf "%s" "$class"'
    ran = subprocess.run(
        [bash, "-c", read, "bash", LIBRARY.as_posix(), str(status), output],
        cwd=BACKEND_ROOT,
        capture_output=True,
        encoding="utf-8",
        timeout=SEED_BOUND_S,
        check=False,
    )
    assert ran.returncode == 0, ran.stdout + ran.stderr
    return ran.stdout


def drawn(spiel: dict[str, Any]) -> FLSpiel:
    """`spiel` as the draw leaves it: no goals, no shoot-out and no event."""

    sides = {side: None if spiel[side] is None else {**spiel[side], "tore": None} for side in ("team1", "team2")}
    return FLSpiel.model_validate({**spiel, **sides, "ergebnis": None, "elfmeterschiessen": None, "sonderereignis": None})


def refused_writes(league: MadeUpLeague) -> list[str]:
    """Every document of `league` a write of the app's refuses, each named by the refusal's code and the document."""

    found: list[str] = []

    def judge(refusal: WriteRefusal | None, what: str) -> None:
        if refusal is not None:
            found.append(f"{refusal.error_code}: {what}")

    # The rollover is the one write of a status, and it activates a season as it retires the one running: once a season
    # is `past`, one is `active` (`app/api/saisons/admin_router.py :: activate_saison`).
    statuses = [season.saison["status"] for season in league.played] + [league.planned["status"]]
    if "past" in statuses and "active" not in statuses:
        found.append(f"a past season beside none active: {statuses}")

    outgoing: Season | None = None
    for season in league.played:
        saison = season.saison
        label = f"season {saison['_id']}"
        if saison["status"] != "future":
            # Each season as its own rollover judged it, its predecessor the season it retired.
            judge(
                find_activation_refusal(
                    target_status="future",
                    target_spiele=len(season.spiele),
                    undated_spieltage=sum(1 for row in season.spieltage if row["start"] is None),
                    outgoing_unplayed=[] if outgoing is None else unplayed_spiel_nrs(FLSpiel.model_validate(row) for row in outgoing.spiele),
                ),
                label,
            )
        outgoing = season
        dated = [row for row in season.spieltage if row["start"] is not None]
        judge(
            find_saison_span_refusal(
                start_date=saison["start_date"],
                end_date=saison["end_date"],
                rules=FLSaisonRules.model_validate(saison["rules"]),
                spieltag_spans=[(row["start"], row["end"]) for row in dated],
            ),
            label,
        )
        for row in dated:
            phase = sorted((other for other in dated if other["saison_phase"] == row["saison_phase"]), key=lambda other: other["position"])
            before = [other for other in phase if other["position"] < row["position"]]
            after = [other for other in phase if other["position"] > row["position"]]
            what = f"{label}, matchday {row['position']} of {row['saison_phase']}"
            judge(
                find_spieltag_span_refusal(
                    start=row["start"],
                    end=row["end"],
                    saison_start=saison["start_date"],
                    saison_end=saison["end_date"],
                    spiel_dates=[spiel["date"] for spiel in season.spiele if spiel["spieltag_id"] == row["_id"] and spiel["date"] is not None],
                ),
                what,
            )
            # Judged as a first dating, which a matchday's every neighbour bounds.
            judge(
                find_spieltag_order_refusal(
                    start=row["start"],
                    stored_start=None,
                    previous=DatedNeighbour(position=before[-1]["position"], start=before[-1]["start"]) if before else None,
                    following=DatedNeighbour(position=after[0]["position"], start=after[0]["start"]) if after else None,
                ),
                what,
            )
        spans = {row["_id"]: row for row in season.spieltage}
        started = has_started(start_date=saison["start_date"], today=league.today)
        for spiel in season.spiele:
            what = f"{label}, match {spiel['spiel_nr']}"
            span = spans[spiel["spieltag_id"]]
            judge(find_spiel_date_refusal(date=spiel["date"], spieltag_start=span["start"], spieltag_end=span["end"]), what)
            judge(find_ergebnis_before_start_refusal(drawn(spiel), FLSpiel.model_validate(spiel), started=started), what)
        for row in season.rows:
            if row["austritt"] is not None:
                judge(find_austritt_refusal(start_date=saison["start_date"], started=started), f"{label}, {row['name']}'s exit")

    fixtures = {spiel["_id"]: spiel for season in league.played for spiel in season.spiele}
    for report in league.spielberichte:
        spiel = fixtures[report["spiel_id"]]
        what = f"the report on match {spiel['spiel_nr']} of season {spiel['saison_id']}"
        judge(find_not_played_refusal(date=spiel["date"], time=spiel["time"], now=league.now), what)
        judge(find_cancelled_refusal(sonderereignis=spiel["sonderereignis"]), what)
    for aufstellung in league.aufstellungen:
        spiel = fixtures[aufstellung["spiel_id"]]
        marks = aufstellung_marks(date=spiel["date"], time=spiel["time"], stored=True, now=league.now)
        judge(find_undated_refusal(marks), f"a line-up for match {spiel['spiel_nr']} of season {spiel['saison_id']}")

    return found


@pytest.mark.parametrize("state", LANDING_STATES)
def test_every_landing_state_is_a_league_the_app_s_writes_reach(state: str) -> None:
    # Today, as the seed reads it: every date the league holds is relative to the day it runs.
    league = LANDING_STATES[state](clock.now())
    # Each document is read through its record model as it is gathered, so one the model refuses raises here.
    league.documents()

    assert refused_writes(league) == []
