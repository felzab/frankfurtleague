from datetime import datetime
from typing import Any, Iterator, Mapping
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from httpx import Response
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

from app.api.bewerbungen.schemas import FLBewerbungSchuleOption
from app.api.saisons.cache import invalidate_saison_cache
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.dependencies import get_germany_now
from app.main import create_app
from tests.config import build_test_config
from tests.database import a_clean_database_sync

BASE_AUTH = {"Authorization": "Bearer test-key-base"}

# The code a request carrying no bearer token at all answers (`app/core/security.py :: get_token`).
MISSING_BEARER_TOKEN = "REQ-AUTH-001"

CONTAINER_SELECTION_MS = 30_000

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

# What `READ-BEWERBUNG-001` keeps off the club list, spelled as a DOCUMENT spells them: the
# assertions below search decoded bodies by key, where a model's field name would not match.
WITHHELD_KEYS = frozenset({"shorthand", "address", "website_url", "full_name", "schulform", "description", "inactive_since", "statistik"})

# The colours `OPEN_SAISON` has assigned, in the palette's order rather than the junction's, and the
# one another season holds -- which the answer for `OPEN_SAISON` may not carry.
OPEN_SAISON_FARBEN = ["rot", "gruen", "blau"]
OTHER_SEASON_FARBE = "magenta"


def _saison(saison_id: str, *, bewerbung: Any) -> dict[str, Any]:
    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        # `future` on purpose: `docs/backend/spec.md :: I47` withholds one from this tier, which is
        # the whole reason the window has a read of its own.
        "status": "future",
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


@pytest.fixture
def seeded_url(mongo_container: Any) -> Iterator[str]:
    """The corpus, in the database `build_test_config` names -- the one the app resolves its collections from."""

    url = str(mongo_container.get_connection_url())
    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        invalidate_saison_cache()

        database[Collection.SAISONS].insert_many(
            [
                _saison(OPEN_SAISON, bewerbung={"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}),
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

        yield url
    finally:
        client.close()


def seeded_with(mongo_container: Any, saisons: list[dict[str, Any]]) -> str:
    """A corpus of exactly the seasons handed in, for a case that decides which one `/fenster` picks.

    `seeded_url` cannot serve those: a boundary season would sort behind its fixed answer and never
    be the one returned.
    """

    url = str(mongo_container.get_connection_url())

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, build_test_config().db_base_name)
        invalidate_saison_cache()
        database[Collection.SAISONS].insert_many(saisons)

        return url
    finally:
        client.close()


def answered(uri: str, path: str, headers: Mapping[str, str] = BASE_AUTH) -> Response:
    """One request per client: Motor binds to the loop `TestClient` first ran on.

    No lifespan either, for the reason `fl_backend/tests/api/test_malformed_ids.py :: client` gives.
    """

    app = create_app(build_test_config())
    app.state.db_client = AsyncIOMotorClient(host=uri, serverSelectionTimeoutMS=CONTAINER_SELECTION_MS)
    app.dependency_overrides[get_germany_now] = lambda: NOW

    try:
        return TestClient(app, raise_server_exceptions=False).get(path, headers=dict(headers))
    finally:
        app.state.db_client.close()


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


class TestTheClubList:
    """`READ-BEWERBUNG-001`: an anonymous visitor picks from this, so every field is serialised into a public page."""

    def test_the_shape_declares_exactly_these_fields(self):
        """An allow-list is one only while its whole membership is pinned; a subset relation would not do it."""

        assert set(FLBewerbungSchuleOption.model_fields) == {"id", "name"}

    def test_only_a_club_id_and_a_name_are_served(self, seeded_url: str):
        response = answered(seeded_url, f"{PREFIX}/schulen")

        assert response.status_code == 200
        # Non-vacuous: every live club IS in the body, so what is asserted below is what they carry.
        assert len(response.json()["schulen"]) == len(CLUBS)
        assert all(set(row) == {"id", "name"} for row in response.json()["schulen"])

    @pytest.mark.parametrize("key", sorted(WITHHELD_KEYS))
    def test_no_withheld_key_reaches_the_body(self, seeded_url: str, key: str):
        assert key not in answered(seeded_url, f"{PREFIX}/schulen").json()["schulen"][0]

    def test_no_withheld_value_reaches_the_body_under_any_key(self, seeded_url: str):
        """Searched as VALUES over the undecoded body: a key RENAMED on the way out satisfies the check above and publishes both."""

        rendered = answered(seeded_url, f"{PREFIX}/schulen").text

        for withheld in ("Hanauer", "60314", "zetteltal.example.de", "gymnasium_g9", "lange Tradition"):
            assert withheld not in rendered

    def test_a_retired_club_is_not_offered(self, seeded_url: str):
        """The picker offers what a school may apply AS, and `find_picked_club_refusal` refuses the same set at the write."""

        assert "Verlassen" not in answered(seeded_url, f"{PREFIX}/schulen").text

    def test_the_list_is_sorted_by_name(self, seeded_url: str):
        """Seeded out of order, so this proves the sort rather than the insertion order."""

        names = [row["name"] for row in answered(seeded_url, f"{PREFIX}/schulen").json()["schulen"]]

        assert names == sorted(names)


class TestTheKuerzelCheck:
    """ONE neutral answer: it names no club, and does not tell an active one from a retired one."""

    @pytest.mark.parametrize(
        ("shorthand", "vergeben"),
        [
            pytest.param("ZE", True, id="a live club's"),
            pytest.param("VE", True, id="a RETIRED club's, which `uniq_shorthand` still holds"),
            pytest.param("QQ", False, id="one nobody holds"),
        ],
    )
    def test_a_taken_kuerzel_answers_taken(self, seeded_url: str, shorthand: str, vergeben: bool):
        response = answered(seeded_url, f"{PREFIX}/kuerzel/{shorthand}")

        assert response.status_code == 200
        assert response.json()["vergeben"] is vergeben

    def test_the_answer_names_no_club(self, seeded_url: str):
        """A shape distinguishing a retired holder from a live one would publish which schools have left."""

        body = answered(seeded_url, f"{PREFIX}/kuerzel/VE").json()

        assert set(body) == {"acknowledged", "shorthand", "vergeben"}
        assert "Verlassen" not in answered(seeded_url, f"{PREFIX}/kuerzel/VE").text


class TestTheAssignedColoursRead:
    """What the Wunschfarbe picker excludes. The ASSIGNMENTS on `saison_teams`, never another applicant's wish."""

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

    @pytest.mark.parametrize(
        "saison_id",
        [
            pytest.param(WINDOWLESS_SAISON, id="a season holding no junction row"),
            pytest.param("1999", id="a season no document names"),
        ],
    )
    def test_a_season_with_nothing_assigned_answers_the_empty_set(self, seeded_url: str, saison_id: str):
        """No 404 either way, so nothing here tells an unknown season from one that has assigned nothing."""

        response = answered(seeded_url, f"{PREFIX}/trikotfarben/{saison_id}")

        assert response.status_code == 200
        assert response.json()["vergeben"] == []


class TestTheTierTheseReadsAreServedAt:
    """Base-tier at a prefix whose other two routers are admin, which is exactly the mix `test_admin_guard.py` exists to catch."""

    @pytest.mark.parametrize(
        "path",
        [
            f"{PREFIX}/fenster",
            f"{PREFIX}/fenster/{OPEN_SAISON}",
            f"{PREFIX}/schulen",
            f"{PREFIX}/kuerzel/ZE",
            f"{PREFIX}/trikotfarben/{OPEN_SAISON}",
        ],
    )
    def test_the_base_key_reaches_every_one(self, seeded_url: str, path: str):
        assert answered(seeded_url, path).status_code == 200

    @pytest.mark.parametrize(
        "path",
        [f"{PREFIX}/fenster", f"{PREFIX}/fenster/{OPEN_SAISON}", f"{PREFIX}/schulen", f"{PREFIX}/kuerzel/ZE"],
    )
    def test_no_key_reaches_none_of_them(self, seeded_url: str, path: str):
        """Public here means no SESSION, never no key: the edge reaches this application through the frontend, which holds one."""

        response = answered(seeded_url, path, headers={})

        assert response.status_code == 401
        assert response.json()["error_code"] == MISSING_BEARER_TOKEN

    def test_the_admin_list_at_this_prefix_still_refuses_the_base_key(self, seeded_url: str):
        """The control: a base-tier router joining an admin prefix must not have widened the two routers already there."""

        assert answered(seeded_url, PREFIX).status_code == 401


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
    def test_a_window_touching_today_is_found(self, mongo_container: Any, bewerbung: dict[str, Any]):
        """Narrow either comparison to `$lt` or `$gt` and one of these three answers 404."""

        url = seeded_with(mongo_container, [_saison(OPEN_SAISON, bewerbung=bewerbung)])

        response = answered(url, f"{PREFIX}/fenster")

        assert response.status_code == 200
        assert response.json()["saison_id"] == OPEN_SAISON
        assert response.json()["laeuft"] is True

    @pytest.mark.parametrize("bewerbung", OUTSIDE_WINDOWS)
    def test_a_window_a_day_outside_is_not(self, mongo_container: Any, bewerbung: dict[str, Any]):
        """The control: without it every case above would pass on a query that matched everything."""

        url = seeded_with(mongo_container, [_saison(OPEN_SAISON, bewerbung=bewerbung)])

        assert answered(url, f"{PREFIX}/fenster").status_code == 404

    @pytest.mark.parametrize("bewerbung", BOUNDARY_WINDOWS)
    def test_the_query_and_the_served_judgement_agree_on_the_edge(self, mongo_container: Any, bewerbung: dict[str, Any]):
        """The two are separate expressions of one rule, so a boundary case has to hold for both.

        `/fenster` narrows in MQL and `/fenster/{saison_id}` computes `laeuft` in Python; a school on
        the last day must not see one say open and the other shut.
        """

        url = seeded_with(mongo_container, [_saison(OPEN_SAISON, bewerbung=bewerbung)])

        assert answered(url, f"{PREFIX}/fenster/{OPEN_SAISON}").json()["laeuft"] is True
