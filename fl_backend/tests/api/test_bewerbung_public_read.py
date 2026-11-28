from collections.abc import AsyncIterator, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx2 import Response
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from tests.app_client import app_client, app_under_test
from tests.config import BASE_AUTH, build_test_config
from tests.database import a_clean_database, held_corpus
from tests.documents import rules_document, saison_document, saison_team_document, team_document
from tests.worker import worker_database

# The database `build_test_config` names -- the one an app built from that config resolves its
# collections from, and the home of the corpus every case sharing `seeded_url` reads.
CORPUS_DATABASE = build_test_config().db_base_name

# A database of its own for `served_with`, which clears where it seeds: nothing may clear the shared corpus under its cases.
WINDOW_DATABASE = worker_database("fl_bewerbung_window_test")

PREFIX = "/api/bewerbungen"
LANDING = "/api/saisons/landing"

# Injected through `get_germany_now`, so the window judgement is not made against the wall clock.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same club every run.
OPEN_OID = ObjectId("6890a1b2c3d4e5f607950001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607950002")

# Neither alphabetical nor reverse-alphabetical by `_id`, so a sort key swapped for the id fails.
TEAMS = (
    ("Zetteltal", "ZEX", OPEN_OID),
    ("Adlerhorst", "ADX", ObjectId("6890a1b2c3d4e5f607950003")),
    ("Mittelbach", "MIX", ObjectId("6890a1b2c3d4e5f607950004")),
    # An umlaut, which sorts past „Z“ by bytes and beside its own letter in a German list.
    ("Öhlerhof", "OHX", ObjectId("6890a1b2c3d4e5f607950006")),
)

# The season taking applications today, the one whose window has passed, and the one carrying none.
# A club that has left, which the picker may not offer; its row still holds the season it left.
RETIRED_TEAM = ("Verlassen", "VEX", RETIRED_OID)
AUSTRITT: Mapping[str, Any] = {"type": "rueckzug", "reason": "keine Mannschaft", "date": "2026-03-15"}

OPEN_SAISON = "2026"
SHUT_SAISON = "2025"
WINDOWLESS_SAISON = "2024"
# A span holding today, paused: it sorts ahead of the answer, so a read ignoring the pause picks it.
PAUSED_SAISON = "2030"

# Named because two corpora seed it: a case building its own season still has to be the one the
# form read serves, and a span drifting from `seeded_url`'s would make it the one it refuses.
RUNNING_WINDOW: Mapping[str, Any] = {"open": True, "start": "2026-03-01", "end": "2026-04-30"}

# The two near-misses, each ruled out by one end of its span and by nothing else.
# Each sorts AHEAD of the answer, so a judgement dropping that end picks it rather than `2026`.
NOT_YET_OPEN_SAISON = "2028"
ALREADY_CLOSED_SAISON = "2029"

# The colours `OPEN_SAISON` has assigned, in the palette's order rather than the junction's, and the
# one another season holds -- which the answer for `OPEN_SAISON` may not carry.
OPEN_SAISON_FARBEN = ["rot", "gruen", "blau"]
OTHER_SEASON_FARBE = "magenta"


# `future` by default: the rule withholds one from this tier, which is why the
# window has a read of its own. Overridden only where a case asks what the status does: `past`
# alone, which ends the window.
def _saison(saison_id: str, *, bewerbung: Any, status: str = "future") -> dict[str, Any]:
    return saison_document(saison_id, status, rules=rules_document(allowed_stufen=["Q1", "Q2"]), bewerbung=bewerbung)


def _junction(
    saison_id: str, name: str, shorthand: str, team_id: ObjectId, *, trikot_farbe: str | None, austritt: Any = None
) -> dict[str, Any]:
    """One `saison_teams` row -- the colour an administrator ASSIGNED, which is what the form read answers off."""

    return saison_team_document(saison_id, team_id, name, shorthand, austritt=austritt, trikot_farbe=trikot_farbe)


DESCRIPTION = "Eine Schule mit langer Tradition."
SCHULFORM = "gymnasium_g9"


def website_host(name: str) -> str:
    return f"{name.lower()}.example.net"


def _team(name: str, shorthand: str, team_id: ObjectId, *, inactive_since: str | None = None) -> dict[str, Any]:
    return team_document(
        team_id,
        name,
        shorthand,
        description=DESCRIPTION,
        website_url=f"https://{website_host(name)}",
        schulform=SCHULFORM,
        inactive_since=inactive_since,
    )


# Module-scoped: every case below reads this corpus and none writes it, which `held_corpus` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
async def seeded_url(mongo_replica_set_url: str) -> AsyncIterator[str]:
    """Every way a window can stand, the clubs, and one season's assigned colours, in `CORPUS_DATABASE`."""

    async def seed(database: AsyncDatabase) -> None:
        await database[Collection.SAISONS].insert_many(
            [
                _saison(OPEN_SAISON, bewerbung=dict(RUNNING_WINDOW)),
                _saison(SHUT_SAISON, bewerbung={"open": True, "start": "2025-03-01", "end": "2025-04-30"}),
                # A span that has not begun: the opening date is what rules it out.
                _saison(NOT_YET_OPEN_SAISON, bewerbung={"open": True, "start": "2026-09-01", "end": "2026-10-31"}),
                # A span already over: the closing date is what rules it out.
                _saison(ALREADY_CLOSED_SAISON, bewerbung={"open": True, "start": "2026-01-01", "end": "2026-02-28"}),
                _saison(PAUSED_SAISON, bewerbung={**RUNNING_WINDOW, "open": False}),
                # No key at all, as every season stored before the field existed carries none.
                _saison(WINDOWLESS_SAISON, bewerbung=None),
            ]
        )
        await database[Collection.TEAMS].insert_many(
            [_team(name, shorthand, team_id) for name, shorthand, team_id in TEAMS] + [_team(*RETIRED_TEAM, inactive_since="2025-08-01")]
        )
        await database[Collection.SAISON_TEAMS].insert_many(
            [
                _junction(OPEN_SAISON, *TEAMS[0], trikot_farbe="rot"),
                _junction(OPEN_SAISON, *TEAMS[1], trikot_farbe="blau"),
                # No colour assigned: `distinct` yields the null this row holds, and the answer must
                # not carry it.
                _junction(OPEN_SAISON, *TEAMS[2], trikot_farbe=None),
                # A club that LEFT the season, still holding its colour: the assignment stands until
                # an administrator clears it, which is the set the admin sees too.
                _junction(OPEN_SAISON, *RETIRED_TEAM, trikot_farbe="gruen", austritt=dict(AUSTRITT)),
                # Another season's assignment, so an answer dropping the season term serves it too.
                _junction(SHUT_SAISON, *TEAMS[0], trikot_farbe=OTHER_SEASON_FARBE),
            ]
        )

    async with held_corpus(mongo_replica_set_url, CORPUS_DATABASE, seed):
        yield mongo_replica_set_url


async def answered(uri: str, path: str, *, database_name: str = CORPUS_DATABASE) -> Response:
    async with app_client(uri, app=app_under_test(database_name), now=NOW) as http:
        return await http.get(path, headers=dict(BASE_AUTH))


async def served_with(mongo_replica_set_url: str, saisons: list[dict[str, Any]], path: str) -> Response:
    """`path` served over a database holding exactly the seasons handed in, for a case that decides which one the landing offers.

    `seeded_url` cannot serve those: a boundary season would sort behind its fixed answer and never
    be the one returned. Served inside the clean database, so its checks judge what the read left.
    """

    async with a_clean_database(mongo_replica_set_url, WINDOW_DATABASE, constraints=True) as (_, database):
        await database[Collection.SAISONS].insert_many(saisons)

        return await answered(mongo_replica_set_url, path, database_name=WINDOW_DATABASE)


def window_of(landing: Response) -> Any:
    """The window the landing offers today, `None` where it offers none: the one public read of the open-window query."""

    assert landing.status_code == 200

    return landing.json()["bewerbung_window"]


pytestmark = pytest.mark.db


class TestTheFormRead:
    """The one read of the form's page: a state it must show, and what a season not taking applications must not tell."""

    async def test_a_running_window_serves_the_teams_and_the_colours(self, seeded_url: str):
        body = (await answered(seeded_url, f"{PREFIX}/saisons/{OPEN_SAISON}/form")).json()

        assert body["window"]["state"] == "running"
        assert [row["name"] for row in body["schulen"]] == ["Adlerhorst", "Mittelbach", "Öhlerhof", "Zetteltal"]
        assert body["taken"] == OPEN_SAISON_FARBEN

    @pytest.mark.parametrize(
        "saison_id",
        [pytest.param(PAUSED_SAISON, id="a paused window"), pytest.param(SHUT_SAISON, id="a window that has passed")],
    )
    async def test_a_form_not_running_serves_its_state_and_nothing_else(self, seeded_url: str, saison_id: str):
        body = (await answered(seeded_url, f"{PREFIX}/saisons/{saison_id}/form")).json()

        assert body["window"]["state"] == "closed"
        assert (body["schulen"], body["taken"]) == ([], [])


class TestTheWindowReads:
    """What this tier learns about a `future` season the rule otherwise withholds: the window, and that it is there."""

    async def test_the_open_window_is_the_season_whose_span_holds_today(self, seeded_url: str):
        """Two near-misses sort ahead of the answer, so a read judging less than the whole predicate picks one of them instead.

        The predicate's boundary days are `tests/api/test_saison_windows.py`'s, at the default tier: this case holds
        only that the landing applies it.
        """

        assert window_of(await answered(seeded_url, LANDING))["saison_id"] == OPEN_SAISON

    async def test_of_two_windows_open_today_the_landing_offers_the_newer_seasons(self, mongo_replica_set_url: str):
        """An administrator can leave two windows open, and the landing's offer is where a school starts its application.

        Stored older first, so a read keeping the stored order, or sorting the other way, sends schools to the earlier season.
        """

        running = {"open": True, "start": "2026-03-01", "end": "2026-05-31"}
        landing = await served_with(
            mongo_replica_set_url, [_saison("2027", bewerbung=dict(running)), _saison("2028", bewerbung=dict(running))], LANDING
        )

        assert window_of(landing)["saison_id"] == "2028"

    async def test_the_landing_names_the_day_the_next_window_opens(self, mongo_replica_set_url: str):
        """The later window sorts ahead of the sooner, and the pause and the ended season behind both open sooner still."""

        later = {"open": True, "start": "2026-09-01", "end": "2026-10-31"}
        sooner = {"open": True, "start": "2026-06-01", "end": "2026-07-31"}
        earliest = {"open": True, "start": "2026-05-01", "end": "2026-05-31"}
        response = await served_with(
            mongo_replica_set_url,
            [
                _saison("2029", bewerbung=later),
                _saison("2028", bewerbung=sooner),
                _saison("2027", bewerbung={**earliest, "open": False}),
                _saison("2026", bewerbung=earliest, status="past"),
            ],
            LANDING,
        )

        assert response.json()["bewerbung_opens_on"] == sooner["start"]

    async def test_a_window_whose_span_has_not_begun_is_served_upcoming(self, seeded_url: str):
        """The form's page names the opening day of an `upcoming` window, so one served as closed tells a school nothing of when it opens."""

        response = await answered(seeded_url, f"{PREFIX}/saisons/{NOT_YET_OPEN_SAISON}/form")

        assert response.status_code == 200
        assert response.json()["window"]["state"] == "upcoming"

    async def test_the_body_for_a_season_recording_no_window_carries_no_field_of_the_season(self, seeded_url: str):
        """Existence is the whole of the narrowing, so the undecoded body is searched."""

        response = await answered(seeded_url, f"{PREFIX}/saisons/{WINDOWLESS_SAISON}/form")

        assert response.json() == {"window": None, "schulen": [], "taken": []}
        stored = _saison(WINDOWLESS_SAISON, bewerbung=None)
        for withheld in (stored["status"], stored["start_date"], stored["rules"]["tiebreak_order"]):
            assert withheld not in response.text


class TestTheColoursTaken:
    """What the Wunschfarbe picker closes. The ASSIGNMENTS on `saison_teams`, never another applicant's wish."""

    async def test_a_season_whose_window_has_not_begun_tells_nothing(self, seeded_url: str):
        """Gated on whether the season takes applications, so a closed one says neither its clubs nor its colours."""

        body = (await answered(seeded_url, f"{PREFIX}/saisons/{NOT_YET_OPEN_SAISON}/form")).json()

        assert (body["schulen"], body["taken"]) == ([], [])


class TestASeasonThatHasEndedTakesNoApplication:
    """A `past` season whose stored window still runs: its dates say open, and the season is over for good."""

    async def test_the_landing_passes_over_it(self, mongo_replica_set_url: str):
        """It sorts AHEAD of the running season, so a query without the status term finds it rather than `2026`."""

        landing = await served_with(
            mongo_replica_set_url,
            [_saison("2027", bewerbung=dict(RUNNING_WINDOW), status="past"), _saison(OPEN_SAISON, bewerbung=dict(RUNNING_WINDOW))],
            LANDING,
        )

        assert window_of(landing)["saison_id"] == OPEN_SAISON

    @pytest.mark.parametrize(
        ("status", "state"),
        [
            pytest.param("past", "ended", id="an ended season"),
            pytest.param("active", "running", id="the running season"),
        ],
    )
    async def test_its_own_window_read_serves_that_it_has_ended_and_no_other_season_s_does(
        self, mongo_replica_set_url: str, status: str, state: str
    ):
        """Both sides: a field answering one value fails a case."""

        form = await served_with(
            mongo_replica_set_url, [_saison(OPEN_SAISON, bewerbung=dict(RUNNING_WINDOW), status=status)], f"{PREFIX}/saisons/{OPEN_SAISON}/form"
        )

        assert form.json()["window"]["state"] == state
