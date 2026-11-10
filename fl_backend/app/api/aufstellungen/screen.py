"""
API · a line-up's screen read and saved, one way for a seat of the club and for an administrator

Both addresses show the same screen and save the same document, so a seat's route and an administrator's differ only in
what they judge first: a seat holder is asked for the seat and refused from the lock, an administrator is asked
neither (`app/api/aufstellungen/admin_router.py`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from typing import Any

from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aufstellungen.crud import write_aufstellung
from app.api.aufstellungen.schemas import (
    FLAufstellungEntry,
    FLAufstellungPayload,
    FLAufstellungResponse,
    FLAufstellungSpiel,
    FLAufstellungSpieler,
)
from app.api.aufstellungen.services import (
    aufstellung_marks,
    build_aufstellung_kader_pipeline,
    judge_the_kickoff,
    judge_the_names,
    newly_named,
)
from app.api.identity.crud import roles_of
from app.api.identity.lookup import RecordCollections
from app.api.identity.schemas import FLSubjectSeat
from app.api.identity.services import find_role_refusal
from app.api.saisons.services import SPIELTAG_POSITION_LOOKUP, matchday_of
from app.api.spielberichte.crud import anchor_the_pupils_named
from app.api.spielberichte.services import SIDES, team_id_of
from app.api.spiele.services import build_spiele_pipeline, spiel_label
from app.core.codes import Code
from app.core.crud import GERMAN_COLLATION, VERSION_FIELD, aggregate_many_from_db, find_stale_first_save_refusal, pull_many_from_db, refuse
from app.core.exceptions import DocumentNotFoundError, WriteRefusal
from app.core.readonly import ReadCollection
from app.core.recording import ACT_BY_KONTAKT
from app.core.transactions import transaction_session
from app.shared.schemas.literals import FLSpielSide


@dataclass(frozen=True, kw_only=True)
class SeatHolder:
    """The signed-in person a seat's route acts for, and the collections their seats are read from."""

    identifier: str
    records: RecordCollections


@dataclass(frozen=True, kw_only=True)
class AufstellungReads:
    """Every collection the screen reads, handed on whole so no caller can omit one."""

    spiele: ReadCollection
    saison_spieler: ReadCollection
    spieler: ReadCollection
    aufstellungen: ReadCollection


@dataclass(frozen=True, kw_only=True)
class _State:
    """What the screen is composed from and a save is judged against, read at one moment."""

    spiel: Mapping[str, Any]
    side: FLSpielSide
    # Every squad row of the club in the fixture's season, ausgetragen ones too, in shirt-number order.
    kader: Sequence[Mapping[str, Any]]


def find_aufstellung_seat_refusal(*, seats: Sequence[FLSubjectSeat], team_id: ObjectId, saison_id: str | None) -> WriteRefusal | None:
    """`role_not_held` for a person holding no seat on this club in the fixture's season.

    Where no fixture carries the id there is no season to ask, and a seat on the club in any season admits the person
    as far as the fixture's `document_not_found`: a stranger to the club learns nothing of which fixtures exist.
    """

    if saison_id is not None:
        return find_role_refusal(seats=seats, team_id=team_id, saison_id=saison_id)
    if any(seat.team_id == team_id for seat in seats):
        return None

    return WriteRefusal(error_code=Code.ROLE_NOT_HELD, status=HTTPStatus.FORBIDDEN)


async def _pull_spiel(*, spiele_collection: ReadCollection, spiel_id: ObjectId, session: AsyncClientSession) -> Mapping[str, Any] | None:
    """The fixture as the public reads join it, each side named, with its matchday's position; none for an id no fixture holds."""

    found = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=[*build_spiele_pipeline(db_filter={"_id": spiel_id}), SPIELTAG_POSITION_LOOKUP],
        limit=1,
        session=session,
    )

    return found[0] if found else None


async def _read_state(
    *, seat: SeatHolder | None, spiel_id: ObjectId, team_id: ObjectId, reads: AufstellungReads, session: AsyncClientSession
) -> _State:
    """The fixture, the seat and the squad, judged in the order the screen's refusals take.

    `role_not_held` before anything about the fixture, and `document_not_found` for a fixture that does not exist or
    fields this club on neither side.
    """

    spiel = await _pull_spiel(spiele_collection=reads.spiele, spiel_id=spiel_id, session=session)
    if seat is not None:
        subject = await roles_of(seat.identifier, seat.records, session=session)
        refuse(find_aufstellung_seat_refusal(seats=subject.seats, team_id=team_id, saison_id=None if spiel is None else spiel["saison_id"]))

    fielding: list[FLSpielSide] = [] if spiel is None else [side for side in SIDES if team_id_of(spiel, side) == team_id]
    if spiel is None or not fielding:
        raise DocumentNotFoundError()

    kader = await aggregate_many_from_db(
        collection=reads.saison_spieler,
        pipeline=build_aufstellung_kader_pipeline(saison_id=spiel["saison_id"], team_id=team_id),
        collation=GERMAN_COLLATION,
        session=session,
    )

    return _State(spiel=spiel, side=fielding[0], kader=kader)


async def _pull_people(
    *, spieler_collection: ReadCollection, state: _State, saved: Mapping[str, Any] | None, session: AsyncClientSession
) -> dict[ObjectId, Mapping[str, Any]]:
    """The names of every pupil the stored line-up names who holds no squad row of the club in the season, by id."""

    rows = {row["spieler_id"] for row in state.kader}
    rest = sorted({entry["spieler_id"] for entry in ([] if saved is None else saved["spieler"])} - rows)
    if not rest:
        return {}

    people = await pull_many_from_db(
        collection=spieler_collection, db_filter={"_id": {"$in": rest}}, projection=["first_name", "last_name"], session=session
    )

    return {person["_id"]: person for person in people}


def _compose(
    *, state: _State, team_id: ObjectId, saved: Mapping[str, Any] | None, people: Mapping[ObjectId, Mapping[str, Any]], now: datetime
) -> FLAufstellungResponse:
    """The screen: the live squad, every pupil the stored line-up names outside it, and the stored line-up with its marks."""

    live = [row for row in state.kader if row["inactive_since"] is None]
    live_ids = {row["spieler_id"] for row in live}
    rows = {row["spieler_id"]: row for row in state.kader}
    entries = [] if saved is None else saved["spieler"]

    def outside(spieler_id: ObjectId) -> FLAufstellungSpieler:
        row = rows.get(spieler_id)
        if row is not None:
            return FLAufstellungSpieler.model_validate(row)
        # An erased pupil's sentinel among them, which is nameless.
        person = people.get(spieler_id, {})
        return FLAufstellungSpieler(
            spieler_id=spieler_id,
            first_name=person.get("first_name"),
            last_name=person.get("last_name"),
            nummer=None,
            position=None,
            rolle=None,
            is_nachnominiert=False,
        )

    spiel = state.spiel

    return FLAufstellungResponse(
        spiel=FLAufstellungSpiel.model_validate({**spiel, "spiel_id": spiel["_id"], **matchday_of(spiel)}),
        team_id=team_id,
        kader=[FLAufstellungSpieler.model_validate(row) for row in live],
        named=[outside(entry["spieler_id"]) for entry in entries if entry["spieler_id"] not in live_ids],
        spieler=[FLAufstellungEntry.model_validate(entry) for entry in entries],
        version=None if saved is None else int(saved.get(VERSION_FIELD) or 0),
        marks=aufstellung_marks(date=spiel.get("date"), time=spiel.get("time"), stored=saved is not None, now=now),
    )


async def read_aufstellung_screen(
    *,
    seat: SeatHolder | None,
    spiel_id: ObjectId,
    team_id: ObjectId,
    reads: AufstellungReads,
    now: datetime,
    # REQUIRED: one snapshot, so the seat, the fixture, the squad and the stored line-up never straddle a commit.
    session: AsyncClientSession,
) -> FLAufstellungResponse:
    """One club's line-up screen for one fixture, as a seat of the club reads it, or an administrator where `seat` is None."""

    state = await _read_state(seat=seat, spiel_id=spiel_id, team_id=team_id, reads=reads, session=session)
    saved = await reads.aufstellungen.find_one({"spiel_id": spiel_id, "team_id": team_id}, session=session)
    people = await _pull_people(spieler_collection=reads.spieler, state=state, saved=saved, session=session)

    return _compose(state=state, team_id=team_id, saved=saved, people=people, now=now)


async def save_aufstellung_screen(
    *,
    seat: SeatHolder | None,
    spiel_id: ObjectId,
    team_id: ObjectId,
    payload: FLAufstellungPayload,
    reads: AufstellungReads,
    aufstellungen_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    spieler_collection: AsyncCollection,
    db: AsyncMongoClient,
    now: datetime,
) -> tuple[FLAufstellungResponse, bool]:
    """Save one club's whole line-up for one fixture and answer the screen it leaves, and whether this save created it.

    A seat's save where `seat` names its holder, refused from the lock; an administrator's where it is None, at any time.
    """

    entries = payload.spieler

    async def write(session: AsyncClientSession) -> tuple[FLAufstellungResponse, bool]:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        state = await _read_state(seat=seat, spiel_id=spiel_id, team_id=team_id, reads=reads, session=session)
        spiel = state.spiel
        # The marks' phase is the clock's alone, so whether one is stored is no part of the judgement.
        judge_the_kickoff(aufstellung_marks(date=spiel.get("date"), time=spiel.get("time"), stored=False, now=now), locks=seat is not None)
        saved = await aufstellungen_collection.find_one({"spiel_id": spiel_id, "team_id": team_id}, session=session)
        refuse(find_stale_first_save_refusal(saved, version=payload.version))
        new = newly_named(entries, saved)
        judge_the_names(entries=entries, new=new, kader=state.kader)

        # So an erasure of a pupil this save names conflicts with it rather than leaving the line-up naming nobody.
        await anchor_the_pupils_named(spieler_collection=spieler_collection, spieler_ids=new, session=session)
        written = await write_aufstellung(
            aufstellungen_collection=aufstellungen_collection,
            saisons_collection=saisons_collection,
            saison_id=spiel["saison_id"],
            spiel_id=spiel_id,
            team_id=team_id,
            spieler=entries,
            version=payload.version,
            by=None if seat is None else ACT_BY_KONTAKT,
            team=None if seat is None else spiel[state.side]["name"],
            label=spiel_label(spiel["saison_id"], spiel["spiel_nr"]),
            session=session,
        )
        people = await _pull_people(spieler_collection=reads.spieler, state=state, saved=written, session=session)

        # Nothing judged is written here, so a seat ending, a fixture re-dated or re-fielded or a pupil ausgetragen
        # conflicts with nothing: judged again outside the transaction, as the match report's write judges its own.
        async with db.start_session(snapshot=True) as outside:
            current = await _read_state(seat=seat, spiel_id=spiel_id, team_id=team_id, reads=reads, session=outside)
        judge_the_kickoff(
            aufstellung_marks(date=current.spiel.get("date"), time=current.spiel.get("time"), stored=False, now=now), locks=seat is not None
        )
        judge_the_names(entries=entries, new=new, kader=current.kader)

        return _compose(state=state, team_id=team_id, saved=written, people=people, now=now), saved is None

    async with transaction_session(db) as session:
        return await session.with_transaction(write)
