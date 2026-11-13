"""
API · the match editor's confirmation rows and line-up marks: what each reads as, as the party's own pages judge it

The editor draws each party's answer by the state its row is served with, so the read must answer `state_of`'s own
state, which a deadline alone does not decide: an answer given stands past its deadline, and a call-off or a club's
exit ends a row still in time. And it calls a line-up stored as every reader does (`aufstellung_stands`): one emptied
stays due.
"""

from collections.abc import Mapping, Sequence
from typing import Any

import pytest
from bson import ObjectId

from app.api.spiele.editor import FLSpieleAdminSingleResponse, read_spiel_editor
from app.core import clock
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spiel_editor_read_test")

SAISON_ID = "2026"
HOME, AWAY = (ObjectId(f"6890a1b2c3d4e5f6074600{n:02d}") for n in (1, 2))

AGREED = {"kind": "agreed", "at": "2026-04-20", "by": {"kind": "kontakt", "rolle": "trainer"}, "vorschlag": None, "reason": None}


def _spiel(**fields: Any) -> dict[str, Any]:
    """A match between both clubs on 2 May, a week after the deadline a row carries unless set otherwise, 25 April."""

    return documents.spiel_document(
        spiel_id=ObjectId("6890a1b2c3d4e5f607460021"),
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=ObjectId("6890a1b2c3d4e5f607460031"),
        team1={"team_id": HOME, "tore": None},
        team2={"team_id": AWAY, "tore": None},
        date="2026-05-02",
        time="16:00:00",
        **fields,
    )


def _read(
    url: str, spiel: Mapping[str, Any], *, rows: Sequence[Mapping[str, Any]] = (), aufstellungen: Sequence[Mapping[str, Any]] = ()
) -> FLSpieleAdminSingleResponse:
    """The editor's read of `spiel` on 27 April, beside what is stored for it, the away club having left the season on 1 May."""

    async def body() -> FLSpieleAdminSingleResponse:
        async with a_clean_database(url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SPIELE].insert_one(spiel)
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    documents.saison_team_document(SAISON_ID, HOME, "Alpha", "ALP"),
                    documents.saison_team_document(
                        SAISON_ID, AWAY, "Beta", "BET", austritt={"type": "rueckzug", "reason": "Schulwechsel", "date": "2026-05-01"}
                    ),
                ]
            )
            for collection, stored in ((Collection.SPIELBESTAETIGUNGEN, rows), (Collection.AUFSTELLUNGEN, aufstellungen)):
                if stored:
                    await database[collection].insert_many(stored)
            return await read_spiel_editor(
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

    return on_the_seed_loop(body())


def test_an_answer_stands_past_its_deadline_and_a_club_out_by_the_match_day_lapses_in_time(mongo_replica_set_url: str):
    """The home club agreed before its deadline passed; the away club's row is still in time, but the club leaves before the day."""

    spiel = _spiel()
    agreed = documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": HOME}, answer=AGREED)
    left = documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": AWAY}, deadline="2026-04-29")

    answer = _read(mongo_replica_set_url, spiel, rows=[agreed, left])

    assert {str(row.id): row.state for row in answer.spielbestaetigungen} == {str(agreed["_id"]): "agreed", str(left["_id"]): "expired"}


def test_an_open_row_on_a_called_off_match_reads_cancelled(mongo_replica_set_url: str):
    """Still in time and unanswered, on a match called off since, which takes no answer."""

    spiel = _spiel(sonderereignis="ausgefallen")
    in_time = documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": HOME}, deadline="2026-04-29")

    answer = _read(mongo_replica_set_url, spiel, rows=[in_time])

    assert [row.state for row in answer.spielbestaetigungen] == ["cancelled"]


def test_a_line_up_holding_no_entry_reads_as_none_stored(mongo_replica_set_url: str):
    """The home club's line-up names a pupil and the away club's, stored, holds no entry: only the first stands."""

    spiel = _spiel()
    aufstellungen = [documents.aufstellung_document(spiel, HOME, starters=[ObjectId()]), documents.aufstellung_document(spiel, AWAY)]

    marks = _read(mongo_replica_set_url, spiel, aufstellungen=aufstellungen).aufstellung_marks

    assert [None if side is None else side.stored for side in (marks.team1, marks.team2)] == [True, False]
