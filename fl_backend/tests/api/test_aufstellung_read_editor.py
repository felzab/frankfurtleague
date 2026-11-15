"""
API · the match editor's line per side: the stored line-up of the club the fixture fields there now, counted

A line-up is keyed by its club, so a fixture can hold one of a club no side fields any more: the editor's line must
never count it for the side that club left.
"""

from typing import Any

import pytest
from bson import ObjectId

from app.api.aufstellungen.schemas import FLAufstellungSummary
from app.api.spiele.editor import FLSpielEditorAufstellungen, read_spiel_editor
from app.core import clock
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_aufstellung_editor_test")

SAISON_ID = "2026"
HOME, AWAY, REPLACED = (ObjectId(f"6890a1b2c3d4e5f6074500{n:02d}") for n in (1, 2, 3))
LINA, OLE, MIA, TOM = (ObjectId(f"6890a1b2c3d4e5f6074500{n:02d}") for n in (11, 12, 13, 14))


def test_each_side_counts_the_line_up_of_the_club_it_fields_now(mongo_replica_set_url: str):
    """The home club's three named, two starting; the away side's club has stored none, and the club it replaced has."""

    spiel = documents.spiel_document(
        spiel_id=ObjectId("6890a1b2c3d4e5f607450021"),
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=ObjectId("6890a1b2c3d4e5f607450031"),
        team1={"team_id": HOME, "tore": None},
        team2={"team_id": AWAY, "tore": None},
    )

    async def body() -> FLSpielEditorAufstellungen:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SPIELE].insert_one(spiel)
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    documents.saison_team_document(SAISON_ID, HOME, "Alpha", "ALP"),
                    documents.saison_team_document(SAISON_ID, AWAY, "Beta", "BET"),
                ]
            )
            await database[Collection.AUFSTELLUNGEN].insert_many(
                [
                    documents.aufstellung_document(spiel, HOME, starters=[LINA, OLE], bench=[MIA]),
                    documents.aufstellung_document(spiel, REPLACED, starters=[TOM]),
                ]
            )
            answer = await read_spiel_editor(
                spiel_id=spiel["_id"],
                spiele_collection=database[Collection.SPIELE],
                saisons_collection=database[Collection.SAISONS],
                spielorte_collection=database[Collection.SPIELORTE],
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                spieler_collection=database[Collection.SPIELER],
                spielberichte_collection=database[Collection.SPIELBERICHTE],
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
                now=clock.now(),
            )
            return answer.aufstellungen

    assert on_the_seed_loop(body()) == FLSpielEditorAufstellungen(team1=FLAufstellungSummary(count=3, starters=2), team2=None)


def test_each_side_counts_this_fixtures_line_up_alone_and_an_open_slot_counts_nothing(mongo_replica_set_url: str):
    """Both sides fielded and stored, the home club's line-up of another fixture stored last; then a fixture whose away slot is open."""

    def fixture(spiel_nr: int, team2: ObjectId | None) -> dict[str, Any]:
        return documents.spiel_document(
            spiel_id=ObjectId(f"6890a1b2c3d4e5f6074500{40 + spiel_nr:02d}"),
            saison_id=SAISON_ID,
            spiel_nr=spiel_nr,
            spieltag_id=ObjectId("6890a1b2c3d4e5f607450031"),
            team1={"team_id": HOME, "tore": None},
            team2=None if team2 is None else {"team_id": team2, "tore": None},
        )

    both, elsewhere, open_slot = fixture(1, AWAY), fixture(2, REPLACED), fixture(3, None)

    async def body() -> tuple[FLSpielEditorAufstellungen, FLSpielEditorAufstellungen]:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SPIELE].insert_many([both, elsewhere, open_slot])
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    documents.saison_team_document(SAISON_ID, HOME, "Alpha", "ALP"),
                    documents.saison_team_document(SAISON_ID, AWAY, "Beta", "BET"),
                    documents.saison_team_document(SAISON_ID, REPLACED, "Gamma", "GAM"),
                ]
            )
            await database[Collection.AUFSTELLUNGEN].insert_many(
                [
                    documents.aufstellung_document(both, HOME, starters=[LINA, OLE], bench=[MIA]),
                    documents.aufstellung_document(both, AWAY, starters=[TOM], bench=[OLE]),
                    documents.aufstellung_document(open_slot, HOME, starters=[LINA]),
                    # Stored last, so a read not keyed by the fixture keeps it for the home club.
                    documents.aufstellung_document(elsewhere, HOME, bench=[MIA, TOM]),
                ]
            )

            async def aufstellungen_of(spiel: dict[str, Any]) -> FLSpielEditorAufstellungen:
                answer = await read_spiel_editor(
                    spiel_id=spiel["_id"],
                    spiele_collection=database[Collection.SPIELE],
                    saisons_collection=database[Collection.SAISONS],
                    spielorte_collection=database[Collection.SPIELORTE],
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                    saison_spieler_collection=database[Collection.SAISON_SPIELER],
                    spieler_collection=database[Collection.SPIELER],
                    spielberichte_collection=database[Collection.SPIELBERICHTE],
                    spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
                    now=clock.now(),
                )
                return answer.aufstellungen

            return await aufstellungen_of(both), await aufstellungen_of(open_slot)

    fielded, open_answer = on_the_seed_loop(body())

    assert fielded == FLSpielEditorAufstellungen(
        team1=FLAufstellungSummary(count=3, starters=2), team2=FLAufstellungSummary(count=2, starters=1)
    )
    assert open_answer == FLSpielEditorAufstellungen(team1=FLAufstellungSummary(count=1, starters=1), team2=None)
