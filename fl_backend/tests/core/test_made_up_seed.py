"""
TESTS · the made-up seed's own decisions: the one server it writes to, and every landing state it builds

What the seed itself decides is judged here, beside the backend it imports.

Invariants:
- The seed writes only to `LOCAL_SERVER`, and refuses any other server, exit 2, before any client exists, quoting nothing
  of the settings it read.
- Settings it cannot load are a refusal, 2.
- Every state of the landing builds a league whose every document its record model reads, with no database, and that no
  write of the app's refuses: each rule below is the app's own refusal, so a rule the app tightens tightens this one.
"""

import re
import secrets
import subprocess
import sys
from pathlib import Path
from typing import Any, Final

import pytest

from app.api.aufstellungen.services import aufstellung_marks, find_undated_refusal
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_activation_refusal, find_saison_span_refusal, has_started
from app.api.spielberichte.services import find_cancelled_refusal, find_not_played_refusal
from app.api.spiele.schemas import FLSpiel, is_unplayed
from app.api.spiele.services import find_ergebnis_before_start_refusal, find_spiel_date_refusal
from app.api.spieltage.services import find_spieltag_order_refusal, find_spieltag_span_refusal
from app.api.teams.services import find_austritt_refusal
from app.core import clock
from app.core.config import MONGODB_URI_FILE, SECRET_FILES
from app.core.exceptions import APIError
from tests.boot import BACKEND_ROOT, environment, secrets_folder
from tests.made_up_seed import LANDING_STATES, UNJUDGED, MadeUpLeague, Season, is_local_server

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

# What `ELSEWHERE`'s managed cluster carries that no other text of a run would.
QUOTED: Final = ("seed-guard", "seed-user", "not-a-password")

REFUSAL: Final = (
    "The made-up seed writes only to the local or the end-to-end stack's own mongo service, at port 27017 with directConnection=true."
)

# An interpreter's start and the seed's imports take a few seconds, and every case here ends before any client exists;
# this is far past them, so only a seed that hangs reaches it.
SEED_BOUND_S: Final = 60.0


def test_the_local_stack_s_server_is_the_seed_s() -> None:
    # As `docker-compose.local.yml :: local_mongodb_uri` names it to the backend.
    assert is_local_server("mongodb://mongo:27017/?directConnection=true")


@pytest.mark.parametrize("uri", ELSEWHERE.values(), ids=ELSEWHERE.keys())
def test_any_other_server_is_not(uri: str) -> None:
    assert not is_local_server(uri)


def run_seed(directory: Path, secrets_dir: Path, variables: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """`python -m tests.made_up_seed` run to its exit over `secrets_dir` and `variables` alone.

    A process of its own, as the container runs it, so the seed's own read of the settings is what it judges. Run from
    `directory`, so no package's dotenv file is read beside the case's settings.
    """

    return subprocess.run(
        (sys.executable, "-m", "tests.made_up_seed"),
        cwd=directory,
        env=environment(secrets_dir, {"PYTHONPATH": str(BACKEND_ROOT), **variables}),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=SEED_BOUND_S,
        check=False,
    )


def test_the_seed_refuses_any_other_server_before_any_client_exists(tmp_path: Path) -> None:
    """One process for the wiring: which servers are another's, `test_any_other_server_is_not` judges in this one."""

    files = {name: ELSEWHERE["managed-cluster"] if name == MONGODB_URI_FILE else secrets.token_hex(32) for name in SECRET_FILES}
    done = run_seed(tmp_path, secrets_folder(tmp_path, files), {"DB_BASE_NAME": "fl_made_up"})
    said = done.stdout + done.stderr
    # Asked first: every later assertion's message is the output itself.
    assert not any(part in said for part in QUOTED), "the refusal quotes the settings it read"
    assert done.returncode == 2, said
    assert REFUSAL in done.stderr, said
    assert "emptied" not in said and "seeded" not in said, said


def test_settings_that_cannot_load_are_a_refusal(tmp_path: Path) -> None:
    """Settings that cannot be built are a configuration it could not load: nothing was judged, before any client exists."""

    done = run_seed(tmp_path, tmp_path, {})

    assert (done.returncode, done.stdout) == (UNJUDGED, ""), done.stdout + done.stderr
    # One line, the settings' own refusal as the backend's boot logs it, naming the files missing from the empty directory.
    assert re.fullmatch(r"The settings could not be loaded: [^\n]*Invalid secret files: [^\n]+\n", done.stderr), done.stderr


def drawn(spiel: dict[str, Any]) -> FLSpiel:
    """`spiel` as the draw leaves it: no goals, no shoot-out and no event."""

    sides = {side: None if spiel[side] is None else {**spiel[side], "tore": None} for side in ("team1", "team2")}
    return FLSpiel.model_validate({**spiel, **sides, "ergebnis": None, "elfmeterschiessen": None, "sonderereignis": None})


def refused_writes(league: MadeUpLeague) -> list[str]:
    """Every document of `league` a write of the app's refuses, each named by the refusal's code and the document."""

    found: list[str] = []

    def judge(refusal: APIError | None, what: str) -> None:
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
                    target_drawn=bool(season.spiele),
                    spieltage_undated=any(row["start"] is None for row in season.spieltage),
                    outgoing_unplayed=outgoing is not None
                    and any(is_unplayed(ergebnis=row["ergebnis"], sonderereignis=row["sonderereignis"]) for row in outgoing.spiele),
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
                    previous_start=before[-1]["start"] if before else None,
                    following_start=after[0]["start"] if after else None,
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
