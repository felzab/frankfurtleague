from collections.abc import Iterable, Mapping
from typing import Any

from fastapi import APIRouter, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.services import find_own_entry_refusal
from app.api.identity.crud import roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.identity.schemas import FLSubjectSeat
from app.api.identity.services import seats_on
from app.api.spielbestaetigungen.crud import (
    JUDGED_JUNCTION_FIELDS,
    JUNCTION_FIELDS,
    OWN_ROW_FIELDS,
    anchor_the_spiele_acted_on,
    pull_ansetzung_state,
)
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungSchiedsrichterAnswerPayload,
    FLSpielbestaetigungTeamAnswerPayload,
)
from app.api.spielbestaetigungen.services import (
    build_answerable_filter,
    compose_answer_update,
    compose_schiedsrichter_answer_update,
    find_foreign_row_refusal,
    find_unanswerable_refusal,
    find_vorschlag_past_refusal,
    find_vorschlag_unchanged_refusal,
    foreign_row_refusal,
    proposal_payload,
    unanswerable_refusal,
)
from app.api.spiele.crud import pull_booked_slots, pull_saison_membership, pull_spieltag_span
from app.api.spiele.schemas import FLSpiel
from app.api.spiele.services import find_claims_made, find_clash_refusal, find_eligibility_refusal, find_spiel_date_refusal
from app.core import clock
from app.core.crud import anchor_in_db, patch_one_in_db, pull_many_from_db, refuse, refuse_faults
from app.core.dependencies import (
    DBClient,
    GermanyNow,
    SaisonsCollection,
    SaisonTeamsCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpieltageReadCollection,
)
from app.core.exceptions import DocumentNotFoundError, as_judged_on_stored_state
from app.core.recording import ACT_BY_KONTAKT, ACT_BY_SCHIEDSRICHTER, record_act
from app.core.routing import by_id
from app.core.security import PERSON_TIER, PersonIdentifier
from app.core.transactions import transact
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLKontaktSeat

# A referee and a club's seat holder answer here, each answer recorded under the answering party's Funktion.
router = APIRouter(
    prefix="/spielbestaetigungen",
    dependencies=PERSON_TIER,
)


def _answering_seat(*, spielbestaetigung_raw: Mapping[str, Any] | None, seats: Iterable[FLSubjectSeat]) -> FLKontaktSeat | None:
    """The seat a signed-in person answers a team row from: their first in `KONTAKT_SEATS` order on the row's team in its season.

    `None` for a row of no team, or of a team the seats do not sit on, which `foreign_row_refusal` answers alike.
    """

    if spielbestaetigung_raw is None or spielbestaetigung_raw["party"]["kind"] != "team":
        return None

    held = seats_on(seats, team_id=spielbestaetigung_raw["party"]["team_id"], saison_id=spielbestaetigung_raw["saison_id"])

    return held[0] if held else None


@router.post(
    f"{by_id('spielbestaetigung_id')}/answer",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Accept or decline one of the signed-in referee's own fixture assignments",
)
async def post_schiedsrichter_answer(
    spielbestaetigung_id: CustomObjectId,
    answer_data: FLSpielbestaetigungSchiedsrichterAnswerPayload,
    identifier: PersonIdentifier,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    records: SubjectLookup,
    db: DBClient,
    germany_now: GermanyNow,
) -> None:
    """Record the signed-in referee's first answer about a fixture they are booked on, until its kick-off: accept, or decline giving a reason.

    A decline takes them off the fixture, and the caller drops the cached fixture list after a successful answer, since
    either answer can move the referee's name on the public fixture.
    """

    today = clock.german_day(germany_now)

    async def answer(session: AsyncClientSession) -> None:
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
            junction_projection=JUDGED_JUNCTION_FIELDS,
            session=session,
        )
        # One snapshot with the row, and the fixture is removed with its rows in one transaction.
        assert ansetzung_state is not None
        refuse(find_unanswerable_refusal(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, now=germany_now))

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
            refuse(unanswerable_refusal())

        await record_act(
            collection=spielbestaetigungen_collection,
            action="spielbestaetigung.answered",
            by=ACT_BY_SCHIEDSRICHTER,
            record_id=spielbestaetigung_id,
            saison_id=str(row["saison_id"]),
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
                refuse(unanswerable_refusal())
        else:
            # What the acceptance judged and does not write, so a move, a reassignment or a club's exit landing under it
            # conflicts with it, and the retry judges what that write left.
            await anchor_the_spiele_acted_on(spiele_collection=spiele_collection, spiel_ids=[row["spiel_id"]], session=session)
            await anchor_in_db(
                collection=saison_teams_collection,
                db_filter={"saison_id": row["saison_id"], "team_id": {"$in": [junction["team_id"] for junction in ansetzung_state.junctions]}},
                session=session,
            )

    await transact(db, answer)


@router.post(
    f"{by_id('spielbestaetigung_id')}/answer/team",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Confirm a fixture's Ansetzung as the team's seat holder, or decline it proposing another date",
)
async def post_team_answer(
    spielbestaetigung_id: CustomObjectId,
    answer_data: FLSpielbestaetigungTeamAnswerPayload,
    identifier: PersonIdentifier,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieltage_collection: SpieltageReadCollection,
    records: SubjectLookup,
    db: DBClient,
    germany_now: GermanyNow,
) -> None:
    """Record one club's answer about one Ansetzung, from whichever of its confirmed seats presses first, and the seat it came from.

    It writes no fixture: a decline's proposal is the administrator's to act on, and is refused wherever the
    administrator's own save of that date would be.
    """

    today = clock.german_day(germany_now)
    vorschlag = (
        None
        if answer_data.vorschlag is None
        else FLSpielbestaetigungAppointment(date=answer_data.vorschlag.date, time=answer_data.vorschlag.time)
    )

    async def answer(session: AsyncClientSession) -> None:
        subject = await roles_of(identifier, records, session=session)
        # `find_one` rather than `pull_one_from_db`, whose 404 would tell the caller which ids exist.
        row = await spielbestaetigungen_collection.find_one({"_id": spielbestaetigung_id}, session=session)
        seat = _answering_seat(spielbestaetigung_raw=row, seats=subject.seats)
        refuse(None if seat is not None else foreign_row_refusal())
        assert row is not None and seat is not None

        ansetzung_state = await pull_ansetzung_state(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            spielbestaetigung_raw=row,
            junction_projection=JUNCTION_FIELDS,
            session=session,
        )
        # One snapshot with the row, and the fixture is removed with its rows in one transaction.
        assert ansetzung_state is not None

        refuse(find_unanswerable_refusal(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, now=germany_now))

        if vorschlag is not None:
            stored = FLSpiel.model_validate(ansetzung_state.spiel)
            refuse_faults(
                find_vorschlag_past_refusal(vorschlag=vorschlag, today=today),
                find_vorschlag_unchanged_refusal(vorschlag=vorschlag, spiel=stored),
            )
            proposed = proposal_payload(stored, vorschlag)

            # The administrator's save's judges in its order, each read just ahead of the one refusal that consumes it.
            membership = await pull_saison_membership(
                saison_teams_collection=saison_teams_collection, saison_id=stored.saison_id, session=session
            )
            refuse(as_judged_on_stored_state(find_eligibility_refusal(stored.id, proposed, [stored], membership)))

            span = await pull_spieltag_span(spieltage_collection=spieltage_collection, spieltag_id=stored.spieltag_id, session=session)
            if span is not None:
                refuse(as_judged_on_stored_state(find_spiel_date_refusal(date=proposed.date, spieltag_start=span.start, spieltag_end=span.end)))

            # Last, as in the save: it validates every season's fixtures, and a hand-edited one raises, answering 500 for a
            # proposal an earlier rule refuses. Only claims the stored fixture did not make.
            booked = await pull_booked_slots(
                spiele_collection=spiele_collection, spiel_id=stored.id, claims=find_claims_made(stored, proposed), session=session
            )
            refuse(as_judged_on_stored_state(find_clash_refusal(date=proposed.date, time=proposed.time, booked=booked)))

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
            refuse(unanswerable_refusal())

        # Both clubs' season rows: the seat was judged off its own club's, so an erasure or a Widerspruch emptying the seat
        # under this answer conflicts with it, and no reason typed from a seat its holder has left outlives the step taking
        # that holder's reasons; and either club's exit was judged off its row. The fixture too, so a move or a re-fielding
        # conflicts. A re-dated matchday or a rival booking of the proposed slot stays unanchored: the answer writes no
        # fixture, and the adoption judges the proposal again as the fixture's save judges it.
        await anchor_in_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": row["saison_id"], "team_id": {"$in": [junction["team_id"] for junction in ansetzung_state.junctions]}},
            session=session,
        )
        await anchor_the_spiele_acted_on(spiele_collection=spiele_collection, spiel_ids=[row["spiel_id"]], session=session)

        await record_act(
            collection=spielbestaetigungen_collection,
            action="spielbestaetigung.answered",
            by=ACT_BY_KONTAKT,
            team=next(
                (str(junction["name"]) for junction in ansetzung_state.junctions if junction["team_id"] == row["party"]["team_id"]), None
            ),
            record_id=spielbestaetigung_id,
            saison_id=str(row["saison_id"]),
            session=session,
        )

    await transact(db, answer)
