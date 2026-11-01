from collections.abc import Iterator
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_ko_runde, get_spielplan
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLSpielJoined
from app.api.spieltage.schemas import FLSpielplanSpieltag
from app.api.spieltage.services import build_spielplan, current_spieltag_id
from app.core.collections import Collection
from app.shared.schemas.literals import FLSaisonStatus, FLSonderereignis
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.documents import rules_document, saison_document, spiel_document
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_saisons_spielplan_view_test")

SAISON = "2026"
GROUP_DAY_1 = ObjectId("6890a1b2c3d4e5f607410001")
GROUP_DAY_2 = ObjectId("6890a1b2c3d4e5f607410002")
FINALE_DAY = ObjectId("6890a1b2c3d4e5f607410003")


def spieltag(spieltag_id: ObjectId, phase: str, position: int) -> dict[str, Any]:
    return {"_id": spieltag_id, "beginn": None, "ende": None, "position": position, "saison_phase": phase, "saison_id": SAISON}


def spiel(spiel_nr: int, spieltag_id: ObjectId, phase: str = "gruppenphase") -> dict[str, Any]:
    return spiel_document(spiel_id=ObjectId(), saison_id=SAISON, spiel_nr=spiel_nr, spieltag_id=spieltag_id, saison_phase=phase)


@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    """Two group matchdays and the Finale's, stored out of playing order, their matches out of number order."""

    async def _seed() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(saison_document(SAISON, "active"))
            await database[Collection.SPIELTAGE].insert_many([dict(document) for document in STORED_SPIELTAGE])
            await database[Collection.SPIELE].insert_many([dict(document) for document in STORED_SPIELE])

    on_the_seed_loop(_seed())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


def served(url: str, read: Any) -> list[tuple[str, int, list[int]]]:
    async def _run() -> Any:
        database: AsyncDatabase = shared_client(url)[DATABASE_NAME]
        return await read(
            saison_id=SAISON,
            saisons_collection=database[Collection.SAISONS],
            spieltage_collection=database[Collection.SPIELTAGE],
            spiele_collection=database[Collection.SPIELE],
        )

    response = on_the_seed_loop(_run())

    return [(day.saison_phase, day.position, [match.spiel_nr for match in day.spiele]) for day in response.spieltage]


# Two group matchdays and the Finale's, stored out of playing order, their matches out of number order.
STORED_SPIELTAGE = [spieltag(FINALE_DAY, "finale", 1), spieltag(GROUP_DAY_2, "gruppenphase", 2), spieltag(GROUP_DAY_1, "gruppenphase", 1)]
STORED_SPIELE = [
    spiel(6, FINALE_DAY, "finale"),
    spiel(5, FINALE_DAY, "finale"),
    spiel(4, GROUP_DAY_2),
    spiel(2, GROUP_DAY_1),
    spiel(1, GROUP_DAY_1),
]

IN_PLAYING_ORDER = [("gruppenphase", 1, [1, 2]), ("gruppenphase", 2, [4]), ("finale", 1, [5, 6])]


def test_the_spielplan_holds_each_matchday_s_matches_in_playing_order():
    """The phase, then the position; each matchday's matches by number."""

    # Each match as the pipeline yields it, beside the confirmation verdict only its join composes.
    joined = [{**document, "ansetzung_confirmed": None} for document in STORED_SPIELE]
    spieltage = build_spielplan(STORED_SPIELTAGE, joined, FLSaisonRules.model_validate(rules_document()))

    assert [(day.saison_phase, day.position, [match.spiel_nr for match in day.spiele]) for day in spieltage] == IN_PLAYING_ORDER


@pytest.mark.db
def test_the_spielplan_read_hands_each_matchday_its_own_matches(seeded_url: str):
    """The wiring: the read's pipeline yields what `build_spielplan` groups by `spieltag_id`, which the case above orders."""

    assert served(seeded_url, get_spielplan) == IN_PLAYING_ORDER


@pytest.mark.db
def test_the_ko_runde_holds_the_knockout_matchdays_alone(seeded_url: str):
    assert served(seeded_url, get_ko_runde) == [("finale", 1, [5, 6])]


def matchday(*states: tuple[str | None, FLSonderereignis | None]) -> FLSpielplanSpieltag:
    """A matchday holding one match per `(ergebnis, sonderereignis)`, all the rule reads."""

    spiele = [FLSpielJoined.model_construct(ergebnis=ergebnis, sonderereignis=ereignis) for ergebnis, ereignis in states]
    return FLSpielplanSpieltag.model_construct(id=ObjectId(), spiele=spiele)


PLAYED = ("2:1", None)
OPEN = (None, None)


@pytest.mark.parametrize(
    ("states", "status", "opens_on"),
    [
        pytest.param([[PLAYED], [PLAYED, OPEN], [OPEN]], "active", 1, id="the first holding a match still to play"),
        pytest.param([[(None, "ausgefallen")], [OPEN]], "active", 1, id="a called-off match is nothing left to play"),
        pytest.param([[(None, "abgebrochen")], [OPEN]], "active", 0, id="an abandonment still owes its result"),
        pytest.param([[PLAYED], [PLAYED]], "active", 1, id="everything played opens on the last"),
        pytest.param([[OPEN], [OPEN]], "past", 1, id="a finished season opens on its last"),
    ],
)
def test_the_spielplan_opens_on_the_matchday_still_to_play_else_the_last(
    states: list[list[tuple[str | None, FLSonderereignis | None]]], status: FLSaisonStatus, opens_on: int
):
    spieltage = [matchday(*day) for day in states]

    assert current_spieltag_id(spieltage, saison_status=status) == spieltage[opens_on].id


def test_a_season_with_no_matchday_opens_on_none():
    assert current_spieltag_id([], saison_status="active") is None
