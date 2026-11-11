from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.services import find_own_entry_refusal
from app.api.identity.crud import roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.identity.schemas import FLSubjectSeat
from app.api.identity.services import rollen_on
from app.api.spielbestaetigungen.crud import JUDGED_VEREIN_FIELDS, OWN_ROW_FIELDS, VEREIN_FIELDS, pull_ansetzung_state
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnswerResponse,
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungByKontakt,
    FLSpielbestaetigungSchiedsrichterAnswerPayload,
    FLSpielbestaetigungSchiedsrichterAnswerResponse,
    FLSpielbestaetigungTeamAnswerPayload,
)
from app.api.spielbestaetigungen.services import (
    TEAM_ANSWER_FIELDS,
    AnsetzungState,
    ansetzung_left_refusal,
    build_answerable_filter,
    compose_answer_update,
    compose_schiedsrichter_answer_update,
    find_foreign_row_refusal,
    find_unanswerable_refusal,
    find_vorschlag_past_refusal,
    find_vorschlag_unchanged_refusal,
    first_press_refusal,
    foreign_row_refusal,
    judged_as_a_proposal,
    proposal_payload,
)
from app.api.spiele.crud import pull_booked_slots, pull_saison_membership, pull_spieltag_span
from app.api.spiele.schemas import FLSpiel
from app.api.spiele.services import find_claims_made, find_clash_refusal, find_eligibility_refusal, find_spiel_date_refusal
from app.core import clock
from app.core.config import API_VERSION
from app.core.crud import anchor_in_db, patch_one_in_db, pull_many_from_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpieleReadCollection,
    SpieltageReadCollection,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.recording import ACT_BY_KONTAKT, ACT_BY_SCHIEDSRICHTER, record_act
from app.core.routing import by_id
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.literals import FLKontaktRolle

# The person lane's identifier, as `app/api/registrierungen/person_router.py` declares it and for its reason: a
# referee and a club's seat holder answer here, each answer recorded under the answering party's Funktion.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)


def _answering_seat(*, spielbestaetigung_raw: Mapping[str, Any] | None, seats: Iterable[FLSubjectSeat]) -> FLKontaktRolle | None:
    """The seat a signed-in person answers a team row from: their first in `KONTAKT_ROLLEN` order on the row's team in its season.

    `None` for a row of no team, or of a team the seats do not sit on, which `foreign_row_refusal` answers alike.
    """

    if spielbestaetigung_raw is None or spielbestaetigung_raw["party"]["kind"] != "team":
        return None

    held = rollen_on(seats, team_id=spielbestaetigung_raw["party"]["team_id"], saison_id=spielbestaetigung_raw["saison_id"])

    return held[0] if held else None


@router.post(
    f"{by_id('spielbestaetigung_id')}/answer",
    response_model=FLSpielbestaetigungSchiedsrichterAnswerResponse,
    summary="Accept or decline one of the signed-in referee's own fixture assignments",
)
async def post_schiedsrichter_answer(
    spielbestaetigung_id: CustomRouteObjectId,
    answer_data: Annotated[FLSpielbestaetigungSchiedsrichterAnswerPayload, Body()],
    identifier: PersonIdentifier,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    records: SubjectLookup,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLSpielbestaetigungSchiedsrichterAnswerResponse:
    """
    Record the signed-in referee's answer about one fixture they are booked on: they accept it, or decline it giving a reason.

    The first answer binds, as a club's does. A decline also takes the referee off the fixture, writing its referee
    null and nothing else of it -- no other fixture is resolved again and no club is told -- and closes the row, so
    booking the same referee again asks them afresh. The reason is stored as typed, for the administrator, and goes at
    the season's end. Answering is open until the fixture's kick-off, or its day where it holds no time, whatever
    deadline a club's row of the same fixture carries.

    Refuses, in this order: an address holding no live, confirmed referee record (`role_not_held`); an id naming no
    row of an `active` season, or a row naming none of those records (`ansetzung_foreign_row`, one answer for both); a row
    already answered, by them or by the league for them (`ansetzung_answered`); one closed unanswered
    (`ansetzung_closed`); a fixture decided, called off or left by a club (`ansetzung_decided`), then one whose date,
    time, ground or sides moved since the row, or which books another referee or none (`ansetzung_changed`); and a
    fixture whose kick-off has come (`ansetzung_deadline_past`). An acceptance is judged again outside the transaction just
    before answering, so a move or a reassignment landing mid-answer refuses it rather than letting it stand.

    **The caller drops the cached fixture list after a successful answer**: an acceptance can put the referee's name
    on the public fixture, and a decline takes it off.
    """

    today = clock.german_day(now)

    async def answer(session: AsyncClientSession) -> FLSpielbestaetigungSchiedsrichterAnswerResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        subject = await roles_of(identifier, records, session=session)
        refuse(find_own_entry_refusal(held=bool(subject.schiedsrichter)))

        # The active seasons alone: a row of a season ended since is no booking left to answer, its slot the archive's.
        saisons = await pull_many_from_db(
            collection=saisons_collection, db_filter={"status": "active"}, projection=["_id"], limit=LIST_LIMIT_DEFAULT, session=session
        )
        # `find_one` rather than `pull_one_from_db`, whose 404 would tell the caller which ids exist.
        row = await spielbestaetigungen_collection.find_one(
            {"_id": spielbestaetigung_id, "saison_id": {"$in": [str(saison["_id"]) for saison in saisons]}},
            projection=OWN_ROW_FIELDS,
            session=session,
        )
        refuse(
            find_foreign_row_refusal(
                spielbestaetigung_raw=row, schiedsrichter_ids=[entry.schiedsrichter_id for entry in subject.schiedsrichter]
            )
        )
        assert row is not None

        ansetzung_state = await pull_ansetzung_state(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            spielbestaetigung_raw=row,
            spiel_projection=None,
            verein_projection=JUDGED_VEREIN_FIELDS,
            session=session,
        )
        # One snapshot with the row, and the fixture is removed with its rows in one transaction.
        assert ansetzung_state is not None
        refuse(find_unanswerable_refusal(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, now=now))

        try:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_answerable_filter()},
                update=compose_schiedsrichter_answer_update(answer=answer_data.answer, reason=answer_data.reason, today=today),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        except DocumentNotFoundError:
            refuse(first_press_refusal())

        await record_act(
            collection=spielbestaetigungen_collection,
            action="spielbestaetigung.answered",
            by=ACT_BY_SCHIEDSRICHTER,
            record_id=spielbestaetigung_id,
            label=str(row["saison_id"]),
            session=session,
        )

        if answer_data.answer == "declined":
            # Never `PATCH /spiele/{spiel_id}`, which re-resolves the season's bracket: a person's press moves this one
            # block. A rival save of the fixture writes this document too, so the two conflict and one retries.
            try:
                await patch_one_in_db(
                    collection=spiele_collection,
                    db_filter={"_id": row["spiel_id"], "schiedsrichter.schiedsrichter_id": row["party"]["schiedsrichter_id"]},
                    update={"$set": {"schiedsrichter": None}},
                    session=session,
                    expected_version=None,
                    return_document=ReturnDocument.BEFORE,
                )
            except DocumentNotFoundError:
                # Unreachable: the snapshot judged above books them, and a write since conflicts rather than missing.
                # Mapped to that judgement's refusal, so no `document_not_found` is published for a miss no caller meets.
                refuse(ansetzung_left_refusal())
        else:
            # The acceptance writes no fixture, so a move, a reassignment or a club's exit landing under this transaction
            # raises no conflict: all judged again outside it before answering.
            current = await pull_ansetzung_state(
                spiele_collection=spiele_collection,
                saison_teams_collection=saison_teams_collection,
                spielbestaetigung_raw=row,
                spiel_projection=None,
                verein_projection=JUDGED_VEREIN_FIELDS,
                session=None,
            )
            # An undraw removing the fixture deletes this row in its transaction, a write conflict while this one holds it.
            assert current is not None
            refuse(find_unanswerable_refusal(spielbestaetigung_raw=row, ansetzung_state=current, now=now))

        return FLSpielbestaetigungSchiedsrichterAnswerResponse(spielbestaetigung_id=spielbestaetigung_id, state=answer_data.answer)

    async with transaction_session(db) as session:
        return await session.with_transaction(answer)


@router.post(
    f"{by_id('spielbestaetigung_id')}/answer/team",
    response_model=FLSpielbestaetigungAnswerResponse,
    summary="Confirm a fixture's Ansetzung as the team's seat holder, or decline it proposing another date",
)
async def post_team_answer(
    spielbestaetigung_id: CustomRouteObjectId,
    answer_data: Annotated[FLSpielbestaetigungTeamAnswerPayload, Body()],
    identifier: PersonIdentifier,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleReadCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieltage_collection: SpieltageReadCollection,
    records: SubjectLookup,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLSpielbestaetigungAnswerResponse:
    """
    Record one club's answer about one Ansetzung, from whichever of its confirmed seats presses first, and the seat it came from.

    The first press binds: a second seat pressing at once conflicts with it, and its retry finds the row answered
    (`ansetzung_answered`). Writes no fixture: a proposal is the administrator's to act on. The seat recorded is the
    signed-in person's own on the row's team, the first in order where they hold two.

    Refuses, in this order: an id naming no team's row, or the row of a team the signed-in person holds no seat on in
    its season (`ansetzung_foreign_row`, one answer for both); a row already answered, closed since or not (`ansetzung_answered`); one closed
    unanswered (`ansetzung_closed`); a fixture decided, called off or left by a club (`ansetzung_decided`), then one
    whose date, time, ground or sides moved since the row was asked (`ansetzung_changed`); an answer after the
    deadline's day (`ansetzung_deadline_past`); a proposal dated before today (`ansetzung_vorschlag_past`); one naming
    the day and hour the fixture already holds (`ansetzung_vorschlag_unchanged`, on both boxes); and a proposal the
    administrator's own save of that date would be refused: on or after a club's exit (`eligibility_disqualified`),
    outside the matchday (`spiel_outside_spieltag`), or within four hours of the ground's or the referee's other
    fixture (`spiel_double_booked`). The reason is stored as typed. Every refusal after the seat's is asked again outside
    the transaction just before answering, so a write landing mid-answer on what was judged refuses the answer rather
    than letting it stand.
    """

    today = clock.german_day(now)
    vorschlag = (
        None
        if answer_data.vorschlag is None
        else FLSpielbestaetigungAppointment(date=answer_data.vorschlag.date, time=answer_data.vorschlag.time)
    )

    async def answer(session: AsyncClientSession) -> FLSpielbestaetigungAnswerResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        subject = await roles_of(identifier, records, session=session)
        # `find_one` rather than `pull_one_from_db`, whose 404 would tell the caller which ids exist.
        row = await spielbestaetigungen_collection.find_one({"_id": spielbestaetigung_id}, projection=TEAM_ANSWER_FIELDS, session=session)
        seat = _answering_seat(spielbestaetigung_raw=row, seats=subject.seats)
        refuse(None if seat is not None else foreign_row_refusal())
        assert row is not None and seat is not None

        ansetzung_state = await pull_ansetzung_state(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            spielbestaetigung_raw=row,
            spiel_projection=None,
            verein_projection=VEREIN_FIELDS,
            session=session,
        )
        # One snapshot with the row, and the fixture is removed with its rows in one transaction.
        assert ansetzung_state is not None

        async def judge(current: AnsetzungState, reads: AsyncClientSession | None) -> None:
            """Every refusal after the seat's, over this Ansetzung and reads under `reads`: asked in the transaction, then again outside it."""

            refuse(find_unanswerable_refusal(spielbestaetigung_raw=row, ansetzung_state=current, now=now))

            if vorschlag is not None:
                refuse(find_vorschlag_past_refusal(vorschlag=vorschlag, today=today))

                stored = FLSpiel.model_validate(current.spiel)
                refuse(find_vorschlag_unchanged_refusal(vorschlag=vorschlag, spiel=stored))
                proposed = proposal_payload(stored, vorschlag)

                # The administrator's save's judges in its order, each read just ahead of the one refusal that consumes it.
                membership = await pull_saison_membership(
                    saison_teams_collection=saison_teams_collection, saison_id=stored.saison_id, session=reads
                )
                # The composer spelled at the call: its kept sides are what disarm this check's no-membership code here.
                refuse(judged_as_a_proposal(find_eligibility_refusal(stored.id, proposal_payload(stored, vorschlag), [stored], membership)))

                span = await pull_spieltag_span(spieltage_collection=spieltage_collection, spieltag_id=stored.spieltag_id, session=reads)
                if span is not None:
                    refuse(judged_as_a_proposal(find_spiel_date_refusal(date=proposed.date, spieltag_start=span.start, spieltag_end=span.end)))

                # Last, as in the save: it validates every season's fixtures, and a hand-edited one raises, answering 500 for a
                # proposal an earlier rule refuses. Only claims the stored fixture did not make.
                booked = await pull_booked_slots(
                    spiele_collection=spiele_collection, spiel_id=stored.id, claims=find_claims_made(stored, proposed), session=reads
                )
                refuse(judged_as_a_proposal(find_clash_refusal(date=proposed.date, time=proposed.time, booked=booked)))

        await judge(ansetzung_state, session)

        try:
            await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_answerable_filter()},
                update=compose_answer_update(answer=answer_data.answer, seat=seat, vorschlag=vorschlag, reason=answer_data.reason, today=today),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        except DocumentNotFoundError:
            # Never a seat answering under this press, which conflicts with the write and meets the retry's judgement:
            # the filter repeats that judgement on the write.
            refuse(first_press_refusal())

        # The season row the seat was judged off: an erasure or a Widerspruch emptying the seat under this answer then
        # conflicts with it, so no reason typed from a seat its holder has left outlives the step taking that holder's reasons.
        await anchor_in_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": row["saison_id"], "team_id": row["party"]["team_id"]},
            session=session,
        )

        await record_act(
            collection=spielbestaetigungen_collection,
            action="spielbestaetigung.answered",
            by=ACT_BY_KONTAKT,
            team=next((str(verein["name"]) for verein in ansetzung_state.vereine if verein["team_id"] == row["party"]["team_id"]), None),
            record_id=spielbestaetigung_id,
            label=str(row["saison_id"]),
            session=session,
        )

        # Nothing judged is written here, so a move, a club's exit, a re-dated matchday or a rival booking landing under
        # this transaction raises no conflict: all judged again outside it before answering.
        current = await pull_ansetzung_state(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            spielbestaetigung_raw=row,
            spiel_projection=None,
            verein_projection=VEREIN_FIELDS,
            session=None,
        )
        # An undraw removing the fixture deletes this row in its transaction, a write conflict while this one holds it.
        assert current is not None
        await judge(current, None)

        return FLSpielbestaetigungAnswerResponse(
            state=answer_data.answer, answered_by=FLSpielbestaetigungByKontakt(kind="kontakt", rolle=seat), vorschlag=vorschlag
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(answer)
