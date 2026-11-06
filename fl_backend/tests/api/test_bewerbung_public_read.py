import asyncio
import functools
from collections.abc import Iterator, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo import MongoClient

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests.app_client import app_client
from tests.config import BASE_AUTH, build_test_config
from tests.database import a_clean_database_sync
from tests.documents import rules_document, saison_document, saison_team_document, team_document
from tests.worker import worker_database

from .conftest import config_for, unwritten

# The database `build_test_config` names -- the one an app built from that config resolves its
# collections from, and the home of the corpus every case sharing `seeded_url` reads.
CORPUS_DATABASE = build_test_config().db_base_name

# `seeded_with`'s own, for `tests/api/conftest.py :: config_for`'s reason: it clears where it seeds.
WINDOW_DATABASE = worker_database("fl_bewerbung_window_test")

PREFIX = f"/api/v{API_VERSION}/bewerbungen"

# Injected through `get_germany_now`, so the window judgement is not made against the wall clock.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same club every run.
OPEN_OID = ObjectId("6890a1b2c3d4e5f607950001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607950002")

# Neither alphabetical nor reverse-alphabetical by `_id`, so a sort key swapped for the id fails.
CLUBS = (
    ("Zetteltal", "ZEX", OPEN_OID),
    ("Adlerhorst", "ADX", ObjectId("6890a1b2c3d4e5f607950003")),
    ("Mittelbach", "MIX", ObjectId("6890a1b2c3d4e5f607950004")),
)

# The season taking applications today, the one whose window has passed, and the one carrying none.
# A club that has left, which the picker may not offer; its row still holds the season it left.
RETIRED_CLUB = ("Verlassen", "VEX", RETIRED_OID)
AUSTRITT: Mapping[str, Any] = {"type": "rueckzug", "reason": "keine Mannschaft", "date": "2026-03-15"}

OPEN_SAISON = "2026"
SHUT_SAISON = "2025"
WINDOWLESS_SAISON = "2024"
# A span holding today, paused: it sorts ahead of the answer, so a read ignoring the pause picks it.
PAUSED_SAISON = "2030"

# Named because two corpora seed it: a case building its own season still has to be the one the
# form read serves, and a span drifting from `seeded_url`'s would make it the one it refuses.
RUNNING_WINDOW: Mapping[str, Any] = {"open": True, "start": "2026-03-01", "end": "2026-04-30"}

# The two near-misses, each ruled out by ONE term of the open-window query and by nothing else.
# Each sorts AHEAD of the answer, so a query dropping that term picks it rather than `2026`.
NOT_YET_OPEN_SAISON = "2028"
ALREADY_CLOSED_SAISON = "2029"

# Spelled here rather than taken from `tests/documents.py :: ADDRESS`: the picker's suite searches its
# body for this street and postcode (`tests/api/test_bewerbung_public_picker.py`).
ADDRESS: Mapping[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}

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


# Searched for in the picker's body too, which imports them with `website_host`: a copy spelled
# there drifts from the seed and then searches for nothing (`tests/api/test_bewerbung_public_picker.py`).
DESCRIPTION = "Eine Schule mit langer Tradition."
SCHULFORM = "gymnasium_g9"


def website_host(name: str) -> str:
    return f"{name.lower()}.example.de"


def _club(name: str, shorthand: str, team_id: ObjectId, *, inactive_since: str | None = None) -> dict[str, Any]:
    return team_document(
        team_id,
        name,
        shorthand,
        description=DESCRIPTION,
        website_url=f"https://{website_host(name)}",
        schulform=SCHULFORM,
        address=dict(ADDRESS),
        inactive_since=inactive_since,
    )


def seed_the_public_corpus(mongo_url: str) -> Iterator[str]:
    """Every way a window can stand, the clubs, and one season's assigned colours, in `CORPUS_DATABASE`.

    A generator, not a fixture: `test_bewerbung_public_picker.py` seeds it too.
    """

    client = MongoClient(mongo_url)
    try:
        database = a_clean_database_sync(client, mongo_url, CORPUS_DATABASE)

        database[Collection.SAISONS].insert_many(
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
        database[Collection.TEAMS].insert_many(
            [_club(name, shorthand, team_id) for name, shorthand, team_id in CLUBS] + [_club(*RETIRED_CLUB, inactive_since="2025-08-01")]
        )
        database[Collection.SAISON_TEAMS].insert_many(
            [
                _junction(OPEN_SAISON, *CLUBS[0], trikot_farbe="rot"),
                _junction(OPEN_SAISON, *CLUBS[1], trikot_farbe="blau"),
                # No colour assigned: `distinct` yields the null this row holds, and the answer must
                # not carry it.
                _junction(OPEN_SAISON, *CLUBS[2], trikot_farbe=None),
                # A club that LEFT the season, still holding its colour: the assignment stands until
                # an administrator clears it, which is the set the admin sees too.
                _junction(OPEN_SAISON, *RETIRED_CLUB, trikot_farbe="gruen", austritt=dict(AUSTRITT)),
                # Another season's assignment, so an answer dropping the season term serves it too.
                _junction(SHUT_SAISON, *CLUBS[0], trikot_farbe=OTHER_SEASON_FARBE),
            ]
        )

        with unwritten(mongo_url, CORPUS_DATABASE):
            yield mongo_url
    finally:
        client.close()


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_url(mongo_url: str) -> Iterator[str]:
    yield from seed_the_public_corpus(mongo_url)


def seeded_with(mongo_url: str, saisons: list[dict[str, Any]]) -> str:
    """The database name holding exactly the seasons handed in, for a case that decides which one the landing offers.

    `seeded_url` cannot serve those: a boundary season would sort behind its fixed answer and never
    be the one returned.
    """

    name = WINDOW_DATABASE
    client = MongoClient(mongo_url)
    try:
        database = a_clean_database_sync(client, mongo_url, name, constraints=True)
        database[Collection.SAISONS].insert_many(saisons)

        # The name rather than the url handed in: what a caller pairs with `answered` is the database
        # this seeded, and a pairing it has to assemble is one it can get wrong.
        return name
    finally:
        client.close()


@functools.cache
def _served(database_name: str) -> FastAPI:
    """One app per database for every case reading it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(config_for(database_name))


def answered(uri: str, path: str, headers: Mapping[str, str] = BASE_AUTH, *, database_name: str = CORPUS_DATABASE) -> Response:
    async def _answered() -> Response:
        async with app_client(uri, app=_served(database_name), now=NOW) as http:
            return await http.get(path, headers=dict(headers))

    return asyncio.run(_answered())


def open_window(uri: str, *, database_name: str = CORPUS_DATABASE) -> Any:
    """The window the landing offers today, `None` where it offers none: the one public read of the open-window query."""

    response = answered(uri, f"/api/v{API_VERSION}/saisons/landing", database_name=database_name)
    assert response.status_code == 200

    return response.json()["bewerbung_window"]


pytestmark = pytest.mark.db


class TestTheFormRead:
    """The one read of the form's page: a state it must show, and what a season not taking applications must not tell."""

    def test_a_running_window_serves_the_clubs_and_the_colours(self, seeded_url: str):
        body = answered(seeded_url, f"{PREFIX}/form/{OPEN_SAISON}").json()

        assert body["window"]["running"] is True
        assert [row["name"] for row in body["schulen"]] == sorted(name for name, _, _ in CLUBS)
        assert body["taken"] == OPEN_SAISON_FARBEN

    @pytest.mark.parametrize(
        "saison_id",
        [pytest.param(PAUSED_SAISON, id="a paused window"), pytest.param(SHUT_SAISON, id="a window that has passed")],
    )
    def test_a_form_not_running_serves_its_dates_and_nothing_else(self, seeded_url: str, saison_id: str):
        body = answered(seeded_url, f"{PREFIX}/form/{saison_id}").json()

        assert body["window"]["running"] is False
        assert (body["schulen"], body["taken"]) == ([], [])

    def test_a_season_recording_no_window_is_served_as_that(self, seeded_url: str):
        assert answered(seeded_url, f"{PREFIX}/form/{WINDOWLESS_SAISON}").json()["window"] is None


class TestTheWindowReads:
    """What this tier learns about a `future` season the rule otherwise withholds: the window, and that it is there."""

    def test_the_open_window_is_the_season_whose_span_holds_today(self, seeded_url: str):
        """Two near-misses sort ahead of the answer, so a read judging less than the whole predicate picks one of them instead.

        The predicate's boundary days are `tests/api/test_saison_windows.py`'s, at the default tier: this case holds
        only that the landing applies it.
        """

        assert open_window(seeded_url)["saison_id"] == OPEN_SAISON

    def test_the_body_for_a_season_recording_no_window_carries_no_field_of_the_season(self, seeded_url: str):
        """Existence is the whole of the narrowing, so the undecoded body is searched."""

        response = answered(seeded_url, f"{PREFIX}/form/{WINDOWLESS_SAISON}")

        assert response.json() == {"saison_id": WINDOWLESS_SAISON, "window": None, "schulen": [], "taken": []}
        stored = _saison(WINDOWLESS_SAISON, bewerbung=None)
        for withheld in (stored["status"], stored["start_date"], stored["rules"]["tiebreak_order"]):
            assert withheld not in response.text

    def test_the_window_carries_no_other_field_of_the_season(self, seeded_url: str):
        """The allow-list, asserted as an exact membership: a subset relation would survive a field added to it."""

        body = answered(seeded_url, f"{PREFIX}/form/{OPEN_SAISON}").json()

        assert set(body) == {"saison_id", "window", "schulen", "taken"}
        assert set(body["window"]) == {"start", "end", "running", "saison_ended"}


class TestTheColoursTaken:
    """What the Wunschfarbe picker closes. The ASSIGNMENTS on `saison_teams`, never another applicant's wish."""

    def test_another_season_s_assignment_is_not_among_them(self, seeded_url: str):
        """Seeded on a second season, so a read dropping the season term would serve it here."""

        assert OTHER_SEASON_FARBE not in answered(seeded_url, f"{PREFIX}/form/{OPEN_SAISON}").json()["taken"]

    @pytest.mark.parametrize(
        "saison_id",
        [
            # Non-vacuous: this season HAS an assignment, so an ungated read would serve it.
            pytest.param(SHUT_SAISON, id="a window whose span has passed"),
            pytest.param(NOT_YET_OPEN_SAISON, id="a span not yet begun"),
            pytest.param(ALREADY_CLOSED_SAISON, id="a span already over"),
            pytest.param(WINDOWLESS_SAISON, id="a season carrying no window"),
        ],
    )
    def test_a_season_not_taking_applications_tells_nothing(self, seeded_url: str, saison_id: str):
        """Gated on whether the season takes applications, so a closed one says neither its clubs nor its colours."""

        body = answered(seeded_url, f"{PREFIX}/form/{saison_id}").json()

        assert (body["schulen"], body["taken"]) == ([], [])

    @pytest.mark.parametrize("status", [pytest.param("active", id="the running season"), pytest.param("past", id="a finished season")])
    def test_a_season_this_tier_may_read_tells_nothing_all_the_same(self, mongo_url: str, status: str):
        """Gated on whether the season takes applications, never on the rule."""

        database = seeded_with(mongo_url, [_saison(OPEN_SAISON, bewerbung=None, status=status)])

        assert answered(mongo_url, f"{PREFIX}/form/{OPEN_SAISON}", database_name=database).json()["taken"] == []


class TestASeasonThatHasEndedTakesNoApplication:
    """A `past` season whose stored window still runs: its dates say open, and the season is over for good."""

    def test_the_landing_passes_over_it(self, mongo_url: str):
        """It sorts AHEAD of the running season, so a query without the status term finds it rather than `2026`."""

        database = seeded_with(
            mongo_url, [_saison("2027", bewerbung=dict(RUNNING_WINDOW), status="past"), _saison(OPEN_SAISON, bewerbung=dict(RUNNING_WINDOW))]
        )

        assert open_window(mongo_url, database_name=database)["saison_id"] == OPEN_SAISON

    def test_its_own_form_read_serves_the_window_as_not_running_and_tells_nothing(self, mongo_url: str):
        database = seeded_with(mongo_url, [_saison(OPEN_SAISON, bewerbung=dict(RUNNING_WINDOW), status="past")])

        body = answered(mongo_url, f"{PREFIX}/form/{OPEN_SAISON}", database_name=database).json()

        assert body["window"]["running"] is False
        assert body["taken"] == []

    @pytest.mark.parametrize(
        ("status", "ended"),
        [
            pytest.param("past", True, id="an ended season"),
            pytest.param("active", False, id="the running season"),
            pytest.param("future", False, id="a planned season"),
        ],
    )
    def test_its_own_window_read_serves_that_it_has_ended_and_no_other_season_s_does(self, mongo_url: str, status: str, ended: bool):
        """Both sides: a field answering one value fails a case, and `active` answers as `future` does."""

        database = seeded_with(mongo_url, [_saison(OPEN_SAISON, bewerbung=dict(RUNNING_WINDOW), status=status)])

        assert answered(mongo_url, f"{PREFIX}/form/{OPEN_SAISON}", database_name=database).json()["window"]["saison_ended"] is ended
