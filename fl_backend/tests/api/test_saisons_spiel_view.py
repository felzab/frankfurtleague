import json
from collections.abc import Iterator
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_spiel
from app.api.spielberichte.services import compose_public_bericht
from app.api.spieler.services import build_ghost_spieler
from app.core.collections import Collection
from app.core.sentinels import GHOST_SPIELER_ID
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_saisons_spiel_view_test")

SAISON = "2026"
HOME, AWAY = ObjectId("6890a1b2c3d4e5f607430001"), ObjectId("6890a1b2c3d4e5f607430002")
NAMED, INTERN = ObjectId("6890a1b2c3d4e5f607430011"), ObjectId("6890a1b2c3d4e5f607430012")


def adopted_match() -> dict[str, Any]:
    """A 2:0 the report proposed, the administrator adopted and nobody changed since."""

    return documents.spiel_document(
        spiel_id=ObjectId("6890a1b2c3d4e5f607430021"),
        saison_id=SAISON,
        spiel_nr=1,
        spieltag_id=ObjectId("6890a1b2c3d4e5f607430031"),
        team1={"team_id": HOME, "name": "Alpha", "shorthand": "ALP", "tore": 2},
        team2={"team_id": AWAY, "name": "Beta", "shorthand": "BET", "tore": 0},
        ergebnis="2:0",
    )


def report_of(spiel: dict[str, Any], **bericht: Any) -> dict[str, Any]:
    """Two goals for the home side, one by a named pupil and one by nobody named; a card to an intern pupil and one to the erased."""

    return documents.spielbericht_document(
        spiel,
        bericht=documents.bericht_document(
            ergebnis_vorschlag={"team1_tore": 2, "team2_tore": 0, "elfmeterschiessen": None, "sonderereignis": None},
            torschuetzen=[
                {"seite": "team1", "spieler_id": None, "minute": "80", "eigentor": False},
                {"seite": "team1", "spieler_id": NAMED, "minute": "45+2", "eigentor": False},
            ],
            karten=[
                {"seite": "team2", "spieler_id": INTERN, "minute": "60", "farbe": "gelb", "grund": "foulspiel"},
                {"seite": "team2", "spieler_id": GHOST_SPIELER_ID, "minute": "70", "farbe": "rot", "grund": None},
            ],
            seiten=documents.spielbericht_seiten(spiel),
            **{"version": 1, "adopted_version": 1, **bericht},
        ),
    )


@pytest.mark.parametrize(
    ("adoption", "public"),
    [
        pytest.param({}, True, id="adopted and unchanged"),
        pytest.param({"adopted_version": None}, False, id="never adopted"),
        pytest.param({"version": 2}, False, id="corrected since its adoption"),
    ],
)
def test_only_an_adopted_unchanged_report_publishes_its_scorers_and_cards(adoption: dict[str, Any], public: bool):
    spiel = adopted_match()
    served = compose_public_bericht(report_of(spiel, **adoption), spiel)

    assert (served.torschuetzen is not None, served.karten is not None) == (public, public)


@pytest.fixture(scope="module")
def seeded_url(mongo_url: str) -> Iterator[str]:
    spiel = adopted_match()
    intern = {**documents.EINWILLIGUNG, "umfang": "intern"}

    async def _seed() -> None:
        async with a_clean_database(mongo_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON, "active"))
            await database[Collection.SPIELTAGE].insert_one(
                {"_id": spiel["spieltag_id"], "beginn": None, "ende": None, "position": 3, "saison_phase": "gruppenphase", "saison_id": SAISON}
            )
            await database[Collection.SPIELE].insert_one(spiel)
            # The two sides entered in one group, so the match's own 2:0 is the whole of the group's table.
            await database[Collection.TEAMS].insert_many(
                [documents.team_document(HOME, "Alpha", "ALP"), documents.team_document(AWAY, "Beta", "BET")]
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [documents.saison_team_document(SAISON, HOME, "Alpha", "ALP"), documents.saison_team_document(SAISON, AWAY, "Beta", "BET")]
            )
            await database[Collection.SPIELBERICHTE].insert_one(report_of(spiel))
            await database[Collection.SPIELER].insert_many(
                [
                    documents.spieler_document(NAMED, "Maxim", "Müller"),
                    documents.spieler_document(INTERN, "Nadja", "Gerber", einwilligung=intern),
                    build_ghost_spieler(),
                ]
            )
            await database[Collection.SAISON_SPIELER].insert_many(
                [
                    documents.saison_spieler_document(NAMED, SAISON, HOME, nummer="7", position="Angriff"),
                    documents.saison_spieler_document(INTERN, SAISON, AWAY, nummer="4", position="Abwehr"),
                ]
            )

    on_the_seed_loop(_seed())

    with unwritten(mongo_url, DATABASE_NAME):
        yield mongo_url


def the_page(url: str) -> Any:
    async def body() -> Any:
        database: AsyncDatabase = shared_client(url)[DATABASE_NAME]
        return await get_spiel(
            saison_id=SAISON,
            spiel_id=adopted_match()["_id"],
            saisons_collection=database[Collection.SAISONS],
            spiele_collection=database[Collection.SPIELE],
            teams_collection=database[Collection.TEAMS],
            spielberichte_collection=database[Collection.SPIELBERICHTE],
        )

    return on_the_seed_loop(body())


@pytest.mark.db
def test_each_side_stands_at_its_place_and_the_page_names_its_matchday(seeded_url: str):
    """The winner first and the loser second, each on its own side, so a swap or a join that matched nobody shows."""

    page = the_page(seeded_url)

    assert page.spieltag_position == 3
    assert page.standings.model_dump() == {"team1": {"gruppe": "A", "platz": 1}, "team2": {"gruppe": "A", "platz": 2}}


@pytest.mark.db
def test_each_entry_reads_as_a_name_as_anonym_or_as_unbekannt(seeded_url: str):
    """By minute; the intern pupil keeps their number and position, the erased one keeps nothing, and no card says why."""

    bericht = the_page(seeded_url).bericht
    entries = [*bericht.torschuetzen, *bericht.karten]
    served = [(entry.minute, entry.spieler.type, entry.spieler.vorname, entry.spieler.nachname, entry.spieler.nummer) for entry in entries]

    assert served == [
        ("45+2", "named", "Maxim", "M.", "7"),
        ("80", "unknown", None, None, None),
        ("60", "anonymous", None, None, "4"),
        ("70", "anonymous", None, None, None),
    ]
    assert not {"Gerber", "Nadja", "Müller", "grund", "foulspiel"} & set(json.dumps(bericht.model_dump(mode="json")).replace('"', " ").split())
