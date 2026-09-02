import asyncio
from datetime import datetime
from typing import Any, Iterator, Mapping
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient, Response
from pymongo import AsyncMongoClient, MongoClient

from app.api.saisons.cache import invalidate_saison_cache
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.dependencies import get_germany_now
from app.main import create_app
from tests.config import TEST_BASE_URL, build_test_config
from tests.database import a_clean_database_sync
from tests.worker import worker_database

from .conftest import config_for, unwritten

BASE_AUTH = {"Authorization": "Bearer test-key-base"}

CONTAINER_SELECTION_MS = 30_000

# The database `build_test_config` names -- the one an app built from that config resolves its
# collections from, and the home of the corpus every case sharing `seeded_url` reads.
CORPUS_DATABASE = build_test_config().db_base_name

# `seeded_with`'s own, because it clears where it seeds: given the database above, the first case
# building a season list of its own would leave every later one reading a corpus nobody seeded.
WINDOW_DATABASE = worker_database("fl_bewerbung_window_test")

PREFIX = f"/api/v{API_VERSION}/bewerbungen"

# Injected through `get_germany_now`, so the window judgement is not made against the wall clock.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-04-01"

# Fixed rather than generated, so a failure names the same club every run.
OPEN_OID = ObjectId("6890a1b2c3d4e5f607950001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607950002")

# Neither alphabetical nor reverse-alphabetical by `_id`, so a sort key swapped for the id fails.
CLUBS = (
    ("Zetteltal", "ZE", OPEN_OID),
    ("Adlerhorst", "AD", ObjectId("6890a1b2c3d4e5f607950003")),
    ("Mittelbach", "MI", ObjectId("6890a1b2c3d4e5f607950004")),
)

# The season taking applications today, the one whose window has passed, and the one carrying none.
OPEN_SAISON = "2026"
SHUT_SAISON = "2025"
WINDOWLESS_SAISON = "2024"

# Named because two corpora seed it: a case building its own season still has to be the one the
# colour read serves, and a span drifting from `seeded_url`'s would make it the one it refuses.
RUNNING_WINDOW: Mapping[str, Any] = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}

# The three near-misses, each ruled out by ONE term of the open-window query and by nothing else.
# Each sorts AHEAD of the answer, so a query dropping that term picks it rather than `2026`.
FLAG_OFF_SAISON = "2027"
NOT_YET_OPEN_SAISON = "2028"
ALREADY_CLOSED_SAISON = "2029"

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


def _saison(saison_id: str, *, bewerbung: Any, status: str = "future") -> dict[str, Any]:
    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        # `future` by default: `docs/backend/spec.md :: I47` withholds one from this tier, which is
        # why the window has a read of its own. Overridden only where a case asks what the status
        # does, which for these reads is nothing -- they judge the window.
        "status": status,
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 18,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["Q1", "Q2"],
        },
        "bewerbung": bewerbung,
    }


def _junction(
    saison_id: str, name: str, shorthand: str, team_id: ObjectId, *, trikot_farbe: str | None, austritt: Any = None
) -> dict[str, Any]:
    """One `saison_teams` row -- the colour an administrator ASSIGNED, which is what the colour read answers off."""

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "gruppe": "A",
        "austritt": austritt,
        "trikot_farbe": trikot_farbe,
        "name": name,
        "shorthand": shorthand,
    }


def _club(name: str, shorthand: str, team_id: ObjectId, *, inactive_since: str | None = None) -> dict[str, Any]:
    return {
        "_id": team_id,
        "name": name,
        "shorthand": shorthand,
        "description": "Eine Schule mit langer Tradition.",
        "full_name": f"{name}-Schule",
        "website_url": f"https://{name.lower()}.example.de",
        "schulform": "gymnasium_g9",
        "address": dict(ADDRESS),
        "inactive_since": inactive_since,
    }


@pytest.fixture(autouse=True)
def _uncached_saisons() -> None:
    """Process-global and keyed by season id alone, so an entry another test -- or another database -- left would answer here."""

    invalidate_saison_cache()


def seed_the_public_corpus(mongo_url: str) -> Iterator[str]:
    """Six seasons spanning every way a window can stand, four clubs, and the colours one season has assigned, in `CORPUS_DATABASE`.

    A generator, not the fixture: `test_bewerbung_public_picker.py` seeds this corpus too.
    """

    client = MongoClient(mongo_url)
    try:
        database = a_clean_database_sync(client, mongo_url, CORPUS_DATABASE)

        database[Collection.SAISONS].insert_many(
            [
                _saison(OPEN_SAISON, bewerbung=dict(RUNNING_WINDOW)),
                _saison(SHUT_SAISON, bewerbung={"offen": True, "von": "2025-03-01", "bis": "2025-04-30"}),
                # A span holding today, and the flag off: the one term that rules it out.
                _saison(FLAG_OFF_SAISON, bewerbung={"offen": False, "von": "2026-03-01", "bis": "2026-04-30"}),
                # The flag on, and a span that has not begun: the opening date is what rules it out.
                _saison(NOT_YET_OPEN_SAISON, bewerbung={"offen": True, "von": "2026-09-01", "bis": "2026-10-31"}),
                # The flag on, and a span already over: the closing date is what rules it out.
                _saison(ALREADY_CLOSED_SAISON, bewerbung={"offen": True, "von": "2026-01-01", "bis": "2026-02-28"}),
                # No key at all, as every season stored before the field existed carries none.
                _saison(WINDOWLESS_SAISON, bewerbung=None),
            ]
        )
        database[Collection.TEAMS].insert_many(
            [_club(name, shorthand, team_id) for name, shorthand, team_id in CLUBS]
            + [_club("Verlassen", "VE", RETIRED_OID, inactive_since="2025-08-01")]
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
                _junction(
                    OPEN_SAISON,
                    "Verlassen",
                    "VE",
                    RETIRED_OID,
                    trikot_farbe="gruen",
                    austritt={"type": "rueckzug", "grund": "keine Mannschaft", "datum": "2026-03-15"},
                ),
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
    """A corpus of exactly the seasons handed in, in `WINDOW_DATABASE`, for a case that decides which one `/fenster` picks.

    `seeded_url` cannot serve those: a boundary season would sort behind its fixed answer and never
    be the one returned.
    """

    client = MongoClient(mongo_url)
    try:
        database = a_clean_database_sync(client, mongo_url, WINDOW_DATABASE)
        database[Collection.SAISONS].insert_many(saisons)

        return mongo_url
    finally:
        client.close()


def answered(uri: str, path: str, headers: Mapping[str, str] = BASE_AUTH, *, database_name: str = CORPUS_DATABASE) -> Response:
    """One request per client, the request and the close on ONE loop.

    Both halves for the reason `fl_backend/tests/api/test_malformed_ids.py :: answered` gives, no
    lifespan included.
    """

    async def _answered() -> Response:
        app = create_app(config_for(database_name))
        app.state.db_client = AsyncMongoClient(host=uri, serverSelectionTimeoutMS=CONTAINER_SELECTION_MS)
        app.dependency_overrides[get_germany_now] = lambda: NOW

        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                return await http.get(path, headers=dict(headers))
        finally:
            await app.state.db_client.close()

    return asyncio.run(_answered())


pytestmark = pytest.mark.db


class TestTheWindowReads:
    """The one thing this tier learns about a `future` season, which `docs/backend/spec.md :: I47` otherwise withholds whole."""

    def test_the_open_window_is_the_season_whose_span_holds_today(self, seeded_url: str):
        """Two near-misses sort ahead of the answer, so a query dropping either term picks one of them instead."""

        response = answered(seeded_url, f"{PREFIX}/fenster")

        assert response.status_code == 200
        assert response.json()["saison_id"] == OPEN_SAISON
        assert response.json()["laeuft"] is True

    @pytest.mark.parametrize(
        "saison_id",
        [
            pytest.param(FLAG_OFF_SAISON, id="a span holding today with the flag off"),
            pytest.param(NOT_YET_OPEN_SAISON, id="the flag on and a span not yet begun"),
            pytest.param(ALREADY_CLOSED_SAISON, id="the flag on and a span already over"),
        ],
    )
    def test_a_near_miss_is_served_as_not_running(self, seeded_url: str, saison_id: str):
        """Each is ruled out by one term alone, so the three together pin every half of the judgement."""

        response = answered(seeded_url, f"{PREFIX}/fenster/{saison_id}")

        assert response.status_code == 200
        assert response.json()["laeuft"] is False

    def test_a_season_read_that_would_404_still_serves_its_window(self, seeded_url: str):
        """The finding this endpoint exists for: `GET /saisons/{saison_id}` answers 404 for a `future` season."""

        assert answered(seeded_url, f"/api/v{API_VERSION}/saisons/{OPEN_SAISON}").status_code == 404

        assert answered(seeded_url, f"{PREFIX}/fenster/{OPEN_SAISON}").status_code == 200

    def test_a_closed_window_is_served_rather_than_hidden(self, seeded_url: str):
        """A page that renders "die Bewerbungsfrist ist abgelaufen" needs the dates; a 404 would say only "no such season"."""

        response = answered(seeded_url, f"{PREFIX}/fenster/{SHUT_SAISON}")

        assert response.status_code == 200
        assert response.json()["laeuft"] is False
        assert response.json()["offen"] is True
        assert response.json()["von"] == "2025-03-01"

    @pytest.mark.parametrize(
        "path",
        [
            pytest.param(f"{PREFIX}/fenster/{WINDOWLESS_SAISON}", id="a season carrying no window"),
            pytest.param(f"{PREFIX}/fenster/1999", id="a season no document names"),
        ],
    )
    def test_a_season_with_no_window_is_a_404(self, seeded_url: str, path: str):
        assert answered(seeded_url, path).status_code == 404

    def test_the_window_body_carries_no_other_field_of_the_season(self, seeded_url: str):
        """The allow-list, asserted as an exact membership: a subset relation would survive a field added to it."""

        body = answered(seeded_url, f"{PREFIX}/fenster/{OPEN_SAISON}").json()

        assert set(body) == {"acknowledged", "saison_id", "offen", "von", "bis", "laeuft"}


class TestTheAssignedColoursRead:
    """What the Wunschfarbe picker excludes. The ASSIGNMENTS on `saison_teams`, never another applicant's wish.

    Beside the window reads rather than the picker: `docs/backend/spec.md :: I47` puts it inside
    their carve-out.
    """

    def test_one_season_answers_the_colours_it_has_assigned(self, seeded_url: str):
        response = answered(seeded_url, f"{PREFIX}/trikotfarben/{OPEN_SAISON}")

        assert response.status_code == 200
        assert response.json()["vergeben"] == OPEN_SAISON_FARBEN

    def test_another_season_s_assignment_is_not_among_them(self, seeded_url: str):
        """Seeded on a second season, so a read dropping the season term would serve it here."""

        assert OTHER_SEASON_FARBE not in answered(seeded_url, f"{PREFIX}/trikotfarben/{OPEN_SAISON}").json()["vergeben"]

    def test_the_answer_names_no_club_that_holds_one(self, seeded_url: str):
        """Searched over the undecoded body: a colour beside a school publishes which kit that school wears."""

        rendered = answered(seeded_url, f"{PREFIX}/trikotfarben/{OPEN_SAISON}").text

        for withheld in ("Zetteltal", "Adlerhorst", "ZE", "rueckzug", str(OPEN_OID)):
            assert withheld not in rendered

    def test_the_body_carries_the_season_and_the_colours_and_nothing_else(self, seeded_url: str):
        """The allow-list, asserted as an exact membership: a subset relation would survive a field added to it."""

        body = answered(seeded_url, f"{PREFIX}/trikotfarben/{OPEN_SAISON}").json()

        assert set(body) == {"acknowledged", "saison_id", "vergeben"}

    def test_a_season_read_that_would_404_still_serves_its_colours(self, seeded_url: str):
        """The finding this endpoint exists for: `docs/backend/spec.md :: I47` withholds a `future` season's clubs whole."""

        assert answered(seeded_url, f"/api/v{API_VERSION}/teams?saison_id={OPEN_SAISON}").status_code == 404

        assert answered(seeded_url, f"{PREFIX}/trikotfarben/{OPEN_SAISON}").status_code == 200

    def test_a_season_taking_applications_with_nothing_assigned_answers_the_empty_set(self, mongo_url: str):
        """Its own corpus, `seeded_url` holding no season that both takes applications and has assigned nothing."""

        url = seeded_with(mongo_url, [_saison(OPEN_SAISON, bewerbung=dict(RUNNING_WINDOW))])

        response = answered(url, f"{PREFIX}/trikotfarben/{OPEN_SAISON}", database_name=WINDOW_DATABASE)

        assert response.status_code == 200
        assert response.json()["vergeben"] == []

    @pytest.mark.parametrize(
        "saison_id",
        [
            # Non-vacuous: this season HAS an assignment, so an ungated read would answer 200 with it.
            pytest.param(SHUT_SAISON, id="a window whose span has passed"),
            pytest.param(FLAG_OFF_SAISON, id="a span holding today with the flag off"),
            pytest.param(NOT_YET_OPEN_SAISON, id="the flag on and a span not yet begun"),
            pytest.param(ALREADY_CLOSED_SAISON, id="the flag on and a span already over"),
            pytest.param(WINDOWLESS_SAISON, id="a season carrying no window"),
            pytest.param("1999", id="a season no document names"),
        ],
    )
    def test_a_season_not_taking_applications_answers_as_an_unknown_id_does(self, seeded_url: str, saison_id: str):
        """One answer for every way a season can fail to be taking applications, so none is distinguishable from no such season."""

        assert answered(seeded_url, f"{PREFIX}/trikotfarben/{saison_id}").status_code == 404

    @pytest.mark.parametrize("status", [pytest.param("active", id="the running season"), pytest.param("past", id="a finished season")])
    def test_a_season_this_tier_may_read_is_refused_all_the_same(self, mongo_url: str, status: str):
        """The gate judges the WINDOW and never the status, so a season `docs/backend/spec.md :: I47` does not withhold is refused too."""

        url = seeded_with(mongo_url, [_saison(OPEN_SAISON, bewerbung=None, status=status)])

        assert answered(url, f"{PREFIX}/trikotfarben/{OPEN_SAISON}", database_name=WINDOW_DATABASE).status_code == 404


# Present and not an object: what `app/core/constraints.py :: _SAISON_BEWERBUNG` refuses, and what
# a season stored before that validator can still carry.
MALFORMED_WINDOWS = [
    pytest.param("2026-03-01/2026-04-30", id="a window flattened to a string"),
    pytest.param(2026, id="a window stored as a number"),
    pytest.param([dict(RUNNING_WINDOW)], id="a window wrapped in a list"),
]

# An object, short of a key the answer is built from: `app/core/constraints.py ::
# _SAISON_BEWERBUNG` requires all three, and a season stored before it can carry fewer. Then one
# omission each, so a guard checking a subset fails on the one it left out.
INCOMPLETE_WINDOWS = [
    pytest.param({}, id="a window recorded as an empty object"),
    pytest.param({"von": "2026-03-01", "bis": "2026-04-30"}, id="a window missing its flag"),
    pytest.param({"offen": True, "bis": "2026-04-30"}, id="a window missing its opening date"),
    pytest.param({"offen": True, "von": "2026-03-01"}, id="a window missing its closing date"),
]

# Both reads take their window through `app/api/bewerbungen/public_router.py :: _pull_window`.
WINDOW_READS = [
    pytest.param(f"{PREFIX}/fenster/{OPEN_SAISON}", id="the window read"),
    pytest.param(f"{PREFIX}/trikotfarben/{OPEN_SAISON}", id="the colour read"),
]


class TestAStoredWindowThatIsNotAnObject:
    """The window read is what pins the SHAPE half of that guard.

    `_fenster` subscripts what it is handed, so narrowing the guard to a null check answers 500
    there; the colour read has `window_is_running`'s own shape check behind it and 404s either way.
    """

    @pytest.mark.parametrize("path", WINDOW_READS)
    @pytest.mark.parametrize("bewerbung", MALFORMED_WINDOWS)
    def test_it_answers_as_a_season_carrying_no_window_does(self, mongo_url: str, bewerbung: Any, path: str):
        """Non-vacuous: the season EXISTS, so a 404 here is the stored shape being refused rather than the id."""

        url = seeded_with(mongo_url, [_saison(OPEN_SAISON, bewerbung=bewerbung)])

        assert answered(url, path, database_name=WINDOW_DATABASE).status_code == 404


class TestAStoredWindowShortOfAFieldTheReadNeeds:
    """The window read is what pins the FIELDS half of that guard.

    `_fenster` subscripts all three by name, so a guard testing shape alone answers 500 here; the
    colour read has `window_is_running`'s own field check behind it and 404s either way.
    """

    @pytest.mark.parametrize("path", WINDOW_READS)
    @pytest.mark.parametrize("bewerbung", INCOMPLETE_WINDOWS)
    def test_it_answers_as_a_season_carrying_no_window_does(self, mongo_url: str, bewerbung: Any, path: str):
        """Non-vacuous: the season exists and its window IS an object, so the 404 is the missing key rather than the id or the shape."""

        url = seeded_with(mongo_url, [_saison(OPEN_SAISON, bewerbung=bewerbung)])

        assert answered(url, path, database_name=WINDOW_DATABASE).status_code == 404


# Each window TOUCHES today on one end or both, so the query's `$lte` and `$gte` are what admit it.
# `seeded_url`'s own corpus sits a month clear of either edge and cannot pin them.
BOUNDARY_WINDOWS = [
    pytest.param({"offen": True, "von": TODAY, "bis": TODAY}, id="a window of exactly today"),
    pytest.param({"offen": True, "von": TODAY, "bis": "2026-06-30"}, id="a window opening today"),
    pytest.param({"offen": True, "von": "2026-01-01", "bis": TODAY}, id="a window closing today"),
]

# A day either side, so the pair below shows the query admits the edge and nothing past it.
OUTSIDE_WINDOWS = [
    pytest.param({"offen": True, "von": "2026-04-02", "bis": "2026-06-30"}, id="a window opening tomorrow"),
    pytest.param({"offen": True, "von": "2026-01-01", "bis": "2026-03-31"}, id="a window that closed yesterday"),
]


class TestTheOpenWindowQueryIsInclusiveAtBothEnds:
    """Both ends of the span count as inside it.

    The consequence otherwise: a school applying on the last day finds the public links gone while
    `/fenster/{saison_id}` still reports `laeuft` and the POST still accepts.
    """

    @pytest.mark.parametrize("bewerbung", BOUNDARY_WINDOWS)
    def test_a_window_touching_today_is_found(self, mongo_url: str, bewerbung: dict[str, Any]):
        """Narrow either comparison to `$lt` or `$gt` and one of these three answers 404."""

        url = seeded_with(mongo_url, [_saison(OPEN_SAISON, bewerbung=bewerbung)])

        response = answered(url, f"{PREFIX}/fenster", database_name=WINDOW_DATABASE)

        assert response.status_code == 200
        assert response.json()["saison_id"] == OPEN_SAISON
        assert response.json()["laeuft"] is True

    @pytest.mark.parametrize("bewerbung", OUTSIDE_WINDOWS)
    def test_a_window_a_day_outside_is_not(self, mongo_url: str, bewerbung: dict[str, Any]):
        """The control: without it every case above would pass on a query that matched everything."""

        url = seeded_with(mongo_url, [_saison(OPEN_SAISON, bewerbung=bewerbung)])

        assert answered(url, f"{PREFIX}/fenster", database_name=WINDOW_DATABASE).status_code == 404

    @pytest.mark.parametrize("bewerbung", BOUNDARY_WINDOWS)
    def test_the_query_and_the_served_judgement_agree_on_the_edge(self, mongo_url: str, bewerbung: dict[str, Any]):
        """The two are separate expressions of one rule, so a boundary case has to hold for both.

        `/fenster` narrows in MQL and `/fenster/{saison_id}` computes `laeuft` in Python; a school on
        the last day must not see one say open and the other shut.
        """

        url = seeded_with(mongo_url, [_saison(OPEN_SAISON, bewerbung=bewerbung)])

        assert answered(url, f"{PREFIX}/fenster/{OPEN_SAISON}", database_name=WINDOW_DATABASE).json()["laeuft"] is True
