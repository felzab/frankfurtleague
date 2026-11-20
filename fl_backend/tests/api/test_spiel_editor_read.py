"""
API · the match editor's confirmation rows and line-up marks: what each reads as, as the party's own pages judge it

The editor draws each party's answer by the state its row is served with, so the read must answer `state_of`'s own
state, which a deadline alone does not decide: an answer given stands past its deadline, and a call-off or a club's
exit ends a row still in time. It serves a standing proposal's acts as the Übersicht serves them. And it calls a
line-up stored as every reader does (`aufstellung_stands`): one emptied stays due.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.overview import SPIELE_AS, FLOverviewVorschlagRow, build_overview_pipeline, overview_of
from app.api.spiele.editor import FLSpielbestaetigungEditorRow, FLSpieleAdminSingleResponse, read_spiel_editor
from app.api.spiele.schemas import FLSpielJoinedInternalListAdapter
from app.core import clock
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db
from tests import documents
from tests.database import a_clean_database
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spiel_editor_read_test")

SAISON_ID = "2026"
HOME, AWAY = (ObjectId(f"6890a1b2c3d4e5f6074600{n:02d}") for n in (1, 2))

REFEREE = ObjectId("6890a1b2c3d4e5f607460041")

# The day a row's request was mailed, where a case's party was asked.
ASKED = "2026-04-20"

AGREED = {"kind": "agreed", "at": "2026-04-20", "by": {"kind": "kontakt", "seat": "trainer"}, "vorschlag": None, "reason": None}


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


def _party_id(row: FLSpielbestaetigungEditorRow) -> Any:
    """The club or referee a served row is about: the editor tells a party's rows apart by it."""

    return row.party.team_id if row.party.kind == "team" else row.party.schiedsrichter_id


async def _read(
    url: str,
    spiel: Mapping[str, Any],
    *,
    rows: Sequence[Mapping[str, Any]] = (),
    aufstellungen: Sequence[Mapping[str, Any]] = (),
    junctions: Sequence[Mapping[str, Any]] = (),
    today: str = "2026-04-27",
) -> FLSpieleAdminSingleResponse:
    """The editor's read of `spiel` at noon `today`, beside what is stored for it, the away club having left the season on 1 May."""

    async with a_clean_database(url, DATABASE_NAME) as (_, database):
        await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
        await database[Collection.SPIELE].insert_one(spiel)
        await database[Collection.SAISON_TEAMS].insert_many(
            [
                documents.saison_team_document(SAISON_ID, HOME, "Alpha", "ALP"),
                documents.saison_team_document(
                    SAISON_ID, AWAY, "Beta", "BET", austritt={"type": "rueckzug", "reason": "Schulwechsel", "date": "2026-05-01"}
                ),
                *junctions,
            ]
        )
        for collection, stored in ((Collection.SPIELBESTAETIGUNGEN, rows), (Collection.AUFSTELLUNGEN, aufstellungen)):
            if stored:
                await database[collection].insert_many(stored)
        return await _editor_read(database, spiel["_id"], now=clock.german_instant(today, "12:00:00"))


async def _editor_read(database: AsyncDatabase, spiel_id: Any, *, now: datetime) -> FLSpieleAdminSingleResponse:
    return await read_spiel_editor(
        spiel_id=spiel_id,
        spiele_collection=database[Collection.SPIELE],
        saisons_collection=database[Collection.SAISONS],
        spielorte_collection=database[Collection.SPIELORTE],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spieler_collection=database[Collection.SPIELER],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
        now=now,
    )


async def test_an_answer_stands_past_its_deadline_and_a_team_out_by_the_match_day_lapses_in_time(mongo_replica_set_url: str):
    """The home club agreed before its deadline passed; the away club's row is still in time, but the club leaves before the day.

    Neither lapsed, so neither is dated. The referee's row about the slot the match left on 25 April lapsed at that
    kick-off, unanswered: dated by that day, which the clubs' deadline before it is not.
    """

    spiel = _spiel()
    agreed = documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": HOME}, answer=AGREED)
    left = documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": AWAY}, deadline="2026-04-29")
    referees = documents.spielbestaetigung_document(
        {**spiel, "date": "2026-04-25"},
        party={"kind": "schiedsrichter", "schiedsrichter_id": REFEREE},
        deadline="2026-04-18",
        closed={"reason": "spiel_past"},
    )

    answer = await _read(mongo_replica_set_url, spiel, rows=[agreed, left, referees])

    assert {_party_id(row): (row.state, row.lapsed_on, row.due_by) for row in answer.spielbestaetigungen} == {
        HOME: ("agreed", None, "2026-04-25"),
        AWAY: ("expired", None, "2026-04-29"),
        REFEREE: ("expired", "2026-04-25", "2026-04-25"),
    }


async def test_a_row_an_exit_or_a_move_ended_before_its_answer_was_due_is_dated_by_nothing(mongo_replica_set_url: str):
    """Read the day after the match, every deadline gone by: the away club left on 1 May, its own deadline that day.

    The home club's row is about the slot of 25 April the match left. Dated, either would read „Abgelaufen am …“ for an
    answer nobody owed: the exit and the move ended each row before it was due.
    """

    spiel = _spiel()
    left = documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": AWAY}, deadline="2026-05-01")
    moved = documents.spielbestaetigung_document(
        {**spiel, "date": "2026-04-25"}, party={"kind": "team", "team_id": HOME}, deadline="2026-04-18", closed={"reason": "ansetzung_changed"}
    )

    answer = await _read(mongo_replica_set_url, spiel, rows=[left, moved], today="2026-05-03")

    assert {_party_id(row): (row.state, row.lapsed_on) for row in answer.spielbestaetigungen} == {
        AWAY: ("expired", None),
        HOME: ("invalid", None),
    }


async def test_a_lapsed_row_takes_a_zusage_and_one_an_exit_ended_takes_none(mongo_replica_set_url: str):
    """Two unanswered rows read as lapsed: one past its deadline, one its club's exit ended before its match.

    The home club's deadline passed before a match on 30 April, the day before the away club leaves, and the away
    club's row is about a match on 2 May, after it has left. The Zusage's write refuses nothing for a deadline gone by,
    so the league enters one the club gave by telephone; it refuses a row the exit ends. Offered on the state alone,
    the editor would hide the first act or offer the second.
    """

    before_the_exit = {**_spiel(), "date": "2026-04-30"}
    after_the_exit = _spiel()
    lapsed = documents.spielbestaetigung_document(
        before_the_exit, party={"kind": "team", "team_id": HOME}, deadline="2026-04-25", asked_at=ASKED
    )
    left = documents.spielbestaetigung_document(after_the_exit, party={"kind": "team", "team_id": AWAY}, deadline="2026-04-29", asked_at=ASKED)

    (lapsed_row,) = (await _read(mongo_replica_set_url, before_the_exit, rows=[lapsed])).spielbestaetigungen
    (left_row,) = (await _read(mongo_replica_set_url, after_the_exit, rows=[left])).spielbestaetigungen

    assert [(row.state, row.enterable) for row in (lapsed_row, left_row)] == [("expired", True), ("expired", False)]


async def test_an_open_row_on_a_called_off_match_reads_cancelled(mongo_replica_set_url: str):
    """Still in time and unanswered, on a match called off since, which takes no answer."""

    spiel = _spiel(sonderereignis="ausgefallen")
    in_time = documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": HOME}, deadline="2026-04-29")

    answer = await _read(mongo_replica_set_url, spiel, rows=[in_time])

    assert [row.state for row in answer.spielbestaetigungen] == ["cancelled"]


async def test_an_agreement_closed_at_its_kick_off_reads_agreed(mongo_replica_set_url: str):
    """The home club agreed to 25 April, its row closed at that kick-off: the editor reads closed rows too, with their slot.

    Read off the open rows alone, the editor would tell the league nobody agreed to the match played. How a closed row
    reads once the match moves is the default tier's.
    """

    played = {**_spiel(), "date": "2026-04-25"}
    agreed = documents.spielbestaetigung_document(
        played, party={"kind": "team", "team_id": HOME}, answer=AGREED, closed={"reason": "spiel_past"}
    )

    assert [row.state for row in (await _read(mongo_replica_set_url, played, rows=[agreed])).spielbestaetigungen] == ["agreed"]


async def test_a_line_up_holding_no_entry_reads_as_none_stored(mongo_replica_set_url: str):
    """The home club's line-up names a pupil and the away club's, stored, holds no entry: only the first stands."""

    spiel = _spiel()
    aufstellungen = [documents.aufstellung_document(spiel, HOME, starters=[ObjectId()]), documents.aufstellung_document(spiel, AWAY)]

    marks = (await _read(mongo_replica_set_url, spiel, aufstellungen=aufstellungen)).aufstellung_marks

    assert [None if side is None else side.stored for side in (marks.team1, marks.team2)] == [True, False]


ZETA, OESTERBERG = (ObjectId(f"6890a1b2c3d4e5f6074600{n:02d}") for n in (3, 4))


async def test_a_knockout_spiel_offers_every_team_of_the_season_in_german_order_judged_by_its_exit(mongo_replica_set_url: str):
    """Each club by its season row's name and code, „Österberg“ before „Zeta“ as German sorts them, where a byte order puts it last.

    Österberg left before the match and stands on no side of it, so the save would refuse fielding it; the away club
    left too, but already stands here, which no save of this fixture is refused for.
    """

    junctions = [
        documents.saison_team_document(SAISON_ID, ZETA, "Zeta", "ZET"),
        documents.saison_team_document(
            SAISON_ID, OESTERBERG, "Österberg", "OES", austritt={"type": "rueckzug", "reason": "Schulwechsel", "date": "2026-04-01"}
        ),
    ]

    answer = await _read(mongo_replica_set_url, _spiel(saison_phase="halbfinale"), junctions=junctions)

    assert answer.teams is not None
    assert [(team.id, team.name, team.shorthand, team.on_spieltag, team.fieldable) for team in answer.teams] == [
        (HOME, "Alpha", "ALP", False, True),
        (AWAY, "Beta", "BET", False, True),
        (OESTERBERG, "Österberg", "OES", False, False),
        (ZETA, "Zeta", "ZET", False, True),
    ]


async def test_a_standing_proposal_serves_its_row_and_whom_each_act_mails_as_the_uebersicht_does(mongo_replica_set_url: str):
    """The away club declined, proposing 9 May; the home club agreed and holds no confirmed seat; the referee is still to answer.

    Each act writes by the row's id and its question names whom it mails: an id or a recipient the editor serves
    otherwise than the Übersicht sends the act to another row, or names a mail the backend never sends. An adoption tells
    every asked party of the move, the home club unreached for want of a seat, and a discard the proposing club alone. The
    Zusage is the referee's alone to take: both clubs have answered.
    """

    spiel = _spiel(schiedsrichter={"schiedsrichter_id": REFEREE, "payment": 20})
    vorschlag = {"date": "2026-05-09", "time": "16:00:00"}
    declined = {"kind": "declined", "at": "2026-04-21", "by": {"kind": "kontakt", "seat": "trainer"}, "vorschlag": vorschlag, "reason": None}
    proposing = documents.spielbestaetigung_document(
        spiel, party={"kind": "team", "team_id": AWAY}, deadline="2026-04-29", asked_at=ASKED, answer=declined
    )
    rows = [
        proposing,
        documents.spielbestaetigung_document(
            spiel, party={"kind": "team", "team_id": HOME}, deadline="2026-04-29", asked_at=ASKED, answer=AGREED
        ),
        documents.spielbestaetigung_document(
            spiel, party={"kind": "schiedsrichter", "schiedsrichter_id": REFEREE}, deadline="2026-04-29", asked_at=ASKED
        ),
    ]
    seat = documents.kontakte_document(trainer=documents.kontaktperson_document("Greta", confirmed_at="2026-03-01"))
    now = clock.german_instant("2026-04-27", "12:00:00")

    async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
        await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
        await database[Collection.SPIELE].insert_one(spiel)
        await database[Collection.SAISON_TEAMS].insert_many(
            [
                documents.saison_team_document(SAISON_ID, HOME, "Alpha", "ALP"),
                documents.saison_team_document(SAISON_ID, AWAY, "Beta", "BET", kontakte=seat),
            ]
        )
        await database[Collection.SCHIEDSRICHTER].insert_one(
            documents.schiedsrichter_document(
                REFEREE, email="anna.koerner@example.com", name="Anna Körner", default_payment=20, einwilligung=None
            )
        )
        await database[Collection.SPIELBESTAETIGUNGEN].insert_many(rows)

        editor = await _editor_read(database, spiel["_id"], now=now)
        (season,) = await aggregate_many_from_db(
            collection=database[Collection.SAISONS], pipeline=build_overview_pipeline(saison_id=SAISON_ID, today=clock.german_day(now))
        )
        spiele = FLSpielJoinedInternalListAdapter.validate_python(season[SPIELE_AS])
        overview = overview_of(read=season, spiele=spiele, faults=[], now=now)

    (uebersicht,) = [row for card in overview.cards for row in card.rows if isinstance(row, FLOverviewVorschlagRow)]
    served = {_party_id(row): row for row in editor.spielbestaetigungen}
    proposal = served[AWAY].vorschlag_open

    assert proposal is not None
    assert (served[AWAY].id, proposal.vorschlag, proposal.adoption_recipients, proposal.discard_recipients) == (
        uebersicht.spielbestaetigung_id,
        uebersicht.vorschlag,
        uebersicht.adoption_recipients,
        uebersicht.discard_recipients,
    )
    assert served[AWAY].id == proposing["_id"]
    assert [recipient.name for recipient in proposal.adoption_recipients] == ["Beta", "Anna Körner"]
    assert [recipient.name for recipient in proposal.discard_recipients] == ["Beta"]
    assert {party: (row.vorschlag_open is not None, row.enterable) for party, row in served.items()} == {
        AWAY: (True, False),
        HOME: (False, False),
        REFEREE: (False, True),
    }
