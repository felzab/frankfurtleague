import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient, Response
from pymongo import AsyncMongoClient, MongoClient

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests.config import TEST_BASE_URL, build_test_config
from tests.database import a_clean_database_sync

from .conftest import unwritten

pytestmark = pytest.mark.db

ADMIN_AUTH = {"Authorization": "Bearer test-key-admin"}

CONTAINER_SELECTION_MS = 10_000

PATH = f"/api/v{API_VERSION}/spiele/action_required"

SAISON = "2026"
OTHER_SAISON = "2025"

# Fixed rather than generated, so a failure names the same fixture every run. Its own hex range, as
# every other module in this suite carves one.
WANTED = ObjectId("6890a1b2c3d4e5f607970001")
UNWANTED = ObjectId("6890a1b2c3d4e5f607970002")
FAULTED = ObjectId("6890a1b2c3d4e5f607970003")

SPIELTAG = ObjectId("6890a1b2c3d4e5f6079700a1")
OTHER_SPIELTAG = ObjectId("6890a1b2c3d4e5f6079700a2")
FAULT_SPIELTAG = ObjectId("6890a1b2c3d4e5f6079700a3")

HOME = ObjectId("6890a1b2c3d4e5f607970011")
AWAY = ObjectId("6890a1b2c3d4e5f607970012")


def _side(team_id: ObjectId, name: str, shorthand: str) -> dict[str, Any]:
    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": None}


def spiel_document(
    spiel_id: ObjectId, *, saison_id: str, spiel_nr: int, spieltag_id: ObjectId, both_sides: ObjectId | None = None
) -> dict[str, Any]:
    """A fixture that QUALIFIES for the list: no date, one of the attention conditions.

    `both_sides` puts one club on both sides, the smallest stored double entry: the sweep keys on
    `(spieltag_id, team_id)` and needs no second document.
    """

    home = _side(both_sides or HOME, "Alpha", "AL")
    away = _side(both_sides or AWAY, "Beta", "BE")

    return {
        "_id": spiel_id,
        "spiel_nr": spiel_nr,
        "saison_id": saison_id,
        "saison_phase": "gruppenphase",
        "spieltag_id": spieltag_id,
        "team1": home,
        "team2": away,
        "team1_quelle": None,
        "team2_quelle": None,
        # The attention condition this corpus rests on, so every seeded fixture is in the unscoped list.
        "datum": None,
        "uhrzeit": None,
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "notiz": None,
    }


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_url(mongo_container: Any) -> Iterator[str]:
    """Two seasons, in the database `build_test_config` names.

    The other season carries BOTH halves: a fixture needing attention, and a stored double entry,
    so a scope reaching only one half still fails a case here.
    """

    url = str(mongo_container.get_connection_url())
    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        database[Collection.SPIELE].insert_many(
            [
                spiel_document(WANTED, saison_id=SAISON, spiel_nr=1, spieltag_id=SPIELTAG),
                spiel_document(UNWANTED, saison_id=OTHER_SAISON, spiel_nr=1, spieltag_id=OTHER_SPIELTAG),
                spiel_document(FAULTED, saison_id=OTHER_SAISON, spiel_nr=2, spieltag_id=FAULT_SPIELTAG, both_sides=HOME),
            ]
        )

        with unwritten(url, database_name):
            yield url
    finally:
        client.close()


def answered(uri: str, path: str) -> Response:
    """One request per client, the request and the close on ONE loop, per `fl_backend/tests/api/test_malformed_ids.py :: answered`."""

    async def _answered() -> Response:
        app = create_app(build_test_config())
        app.state.db_client = AsyncMongoClient(host=uri, serverSelectionTimeoutMS=CONTAINER_SELECTION_MS)

        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                return await http.get(path, headers=dict(ADMIN_AUTH))
        finally:
            await app.state.db_client.close()

    return asyncio.run(_answered())


def ids_of(response: Response) -> set[str]:
    return {spiel["id"] for spiel in response.json()["spiele"]}


class TestTheSeasonScopesBothHalves:
    """`saison_id` narrows the attention read AND the fault sweep.

    Scoping one alone surfaces a fixture from a season the admin did not ask about, which is worse
    than either behaviour on its own.
    """

    def test_the_scoped_read_serves_that_season_alone(self, seeded_url: str):
        response = answered(seeded_url, f"{PATH}?saison_id={SAISON}")

        assert response.status_code == 200
        assert ids_of(response) == {str(WANTED)}

    def test_the_other_seasons_faults_are_not_reported(self, seeded_url: str):
        """The half a filter on the attention read alone would leave open: a fault unions its fixture in."""

        response = answered(seeded_url, f"{PATH}?saison_id={SAISON}")

        assert response.json()["bracket_faults"] == []
        assert str(FAULTED) not in ids_of(response)

    def test_asking_for_the_other_season_serves_the_other_season(self, seeded_url: str):
        """The control: a scope that answered the same set for every season would satisfy the two above."""

        response = answered(seeded_url, f"{PATH}?saison_id={OTHER_SAISON}")

        assert ids_of(response) == {str(UNWANTED), str(FAULTED)}
        assert [fault["reason"] for fault in response.json()["bracket_faults"]] == ["fielded_twice", "fielded_twice"]

    def test_naming_no_season_still_spans_them_all(self, seeded_url: str):
        """The optional half of the shape: an absent parameter preserves what every other caller gets today."""

        response = answered(seeded_url, PATH)

        assert ids_of(response) == {str(WANTED), str(UNWANTED), str(FAULTED)}
        assert response.json()["bracket_faults"] != []

    def test_a_season_no_fixture_names_is_empty_rather_than_everything(self, seeded_url: str):
        """A filter dropped for an unknown value is the mistake that reads as working: it would serve all three."""

        response = answered(seeded_url, f"{PATH}?saison_id=1999")

        assert response.status_code == 200
        assert ids_of(response) == set()
        assert response.json()["bracket_faults"] == []
