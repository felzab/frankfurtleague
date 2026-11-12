"""
API · the match editor's confirmation rows: whether a party's answer lapsed, as the party's own page judges it

The editor draws a lapsed answer as „Abgelaufen“, which no answer reaches, so the read must answer `expired` exactly
where `state_of` does: a row past its deadline lapsed, one still in time did not.
"""

import pytest
from bson import ObjectId

from app.api.spiele.editor import read_spiel_editor
from app.core import clock
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spiel_editor_expired_test")

SAISON_ID = "2026"
HOME, AWAY = (ObjectId(f"6890a1b2c3d4e5f6074600{n:02d}") for n in (1, 2))


def test_a_club_row_past_its_deadline_reads_expired_and_one_in_time_does_not(mongo_replica_set_url: str):
    """Both clubs asked about a match on 2 May, read on 27 April: the home club's deadline has passed, the away club's has not."""

    spiel = documents.spiel_document(
        spiel_id=ObjectId("6890a1b2c3d4e5f607460021"),
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=ObjectId("6890a1b2c3d4e5f607460031"),
        team1={"team_id": HOME, "tore": None},
        team2={"team_id": AWAY, "tore": None},
        date="2026-05-02",
        time="16:00:00",
    )
    lapsed = documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": HOME}, deadline="2026-04-25")
    in_time = documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": AWAY}, deadline="2026-04-29")

    async def body() -> dict[str, bool]:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SPIELE].insert_one(spiel)
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    documents.saison_team_document(SAISON_ID, HOME, "Alpha", "ALP"),
                    documents.saison_team_document(SAISON_ID, AWAY, "Beta", "BET"),
                ]
            )
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many([lapsed, in_time])
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
                now=clock.german_instant("2026-04-27", "12:00:00"),
            )
            return {str(row.id): row.expired for row in answer.spielbestaetigungen}

    assert on_the_seed_loop(body()) == {str(lapsed["_id"]): True, str(in_time["_id"]): False}
