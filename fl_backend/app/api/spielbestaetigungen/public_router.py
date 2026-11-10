from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.spielbestaetigungen.crud import VEREIN_FIELDS, VIEW_SPIEL_FIELDS, pull_ansetzung_state, pull_vorschlag_open
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnswerPayload,
    FLSpielbestaetigungAnswerResponse,
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungByKontakt,
    FLSpielbestaetigungViewResponse,
)
from app.api.spielbestaetigungen.services import (
    LINK_FIELDS,
    AnsetzungState,
    build_answerable_filter,
    build_token_filter,
    clubs_without_a_season_row,
    compose_answer_update,
    find_spent_link_refusal,
    find_unknown_link_refusal,
    find_vorschlag_past_refusal,
    find_vorschlag_unchanged_refusal,
    first_press_refusal,
    judged_as_a_proposal,
    proposal_payload,
    seat_holding,
    side_of,
    stand_moved,
    view_ansetzung_of,
    view_snapshot_of,
    zustand_of,
)
from app.api.spiele.crud import pull_booked_slots, pull_booked_venue, pull_saison_membership, pull_spieltag_span
from app.api.spiele.schemas import FLSpiel, FLSpielortFieldPublic
from app.api.spiele.services import find_claims_made, find_clash_refusal, find_eligibility_refusal, find_spiel_date_refusal
from app.api.teams.crud import pull_team_names
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SpielbestaetigungenCollection,
    SpielbestaetigungenReadCollection,
    SpieleCollection,
    SpieleReadCollection,
    SpielorteReadCollection,
    SpieltageCollection,
    TeamsReadCollection,
    get_german_date_str,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.recording import ACT_BY_KONTAKT, record_act
from app.core.routing import SAFE
from app.core.security import verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token

# Base tier and the public actor: the token is the whole credential, as a sign-in code is, for
# `app/api/bewerbungen/public_router.py`'s reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen",
    dependencies=[Depends(verify_access_base)],
)


@router.post(
    "/view",
    response_model=FLSpielbestaetigungViewResponse,
    summary="What one fixture confirmation link opens",
    openapi_extra=SAFE,
)
async def get_spielbestaetigung_view(
    view_data: Annotated[FLTokenPayload, Body()],
    spielbestaetigungen_collection: SpielbestaetigungenReadCollection,
    spiele_collection: SpieleReadCollection,
    saison_teams_collection: SaisonTeamsReadCollection,
    spielorte_collection: SpielorteReadCollection,
    teams_collection: TeamsReadCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungViewResponse:
    """
    Answer what the page renders for the fixture this token asks a club about, and nobody's name or address (`READ-ANSETZUNG-001`).

    The state, which side the reader's club plays, the fixture as it stands now (or, where it moved since the link, the
    Ansetzung the link asked about), the row's deadline, the other club's proposal and which role answered. A POST that
    reads, so the token travels in a body and never in a second URL. Refuses only a token no seat of any row holds
    (`link_invalid`), a guess and a link voided when its seat changed hands alike: an answered, closed, moved,
    decided or expired link is SERVED in that state rather than refused, so a reopened link shows what became of it.
    `vorschlag` is the state of an open link while the other club's decline proposes another date for the same
    Ansetzung, whose date and hour alone are served.
    """

    token_hash = hash_token(view_data.token)

    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, and no state term, so a spent link
    # is found and shown in its state.
    row = await spielbestaetigungen_collection.find_one(build_token_filter(token_hash=token_hash), projection=LINK_FIELDS)
    seat = None if row is None else seat_holding(spielbestaetigung_raw=row, token_hash=token_hash)
    refuse(find_unknown_link_refusal(seat=seat))
    assert row is not None and seat is not None

    ansetzung_state = await pull_ansetzung_state(
        spiele_collection=spiele_collection,
        saison_teams_collection=saison_teams_collection,
        spielbestaetigung_raw=row,
        spiel_projection=VIEW_SPIEL_FIELDS,
        verein_projection=VEREIN_FIELDS,
    )
    # The row read outside any transaction: an undraw or a replace committing since took the fixture and the row together.
    refuse(find_unknown_link_refusal(seat=None if ansetzung_state is None else seat))
    assert ansetzung_state is not None
    vorschlag_open = await pull_vorschlag_open(spielbestaetigungen_collection=spielbestaetigungen_collection, spielbestaetigung_raw=row)

    state = zustand_of(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, today=today, vorschlag_open=vorschlag_open)
    answer = row.get("answer")

    if stand_moved(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state):
        venue = await pull_booked_venue(spielorte_collection, row["ansetzung"]["spielort_id"])
        spielort = (
            None
            if venue is None
            else FLSpielortFieldPublic(spielort_id=row["ansetzung"]["spielort_id"], name=venue.name, maps_link=venue.maps_link)
        )
        vereinsnamen = await pull_team_names(
            teams_collection=teams_collection, team_ids=clubs_without_a_season_row(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state)
        )
        ansetzung = view_snapshot_of(spielbestaetigung_raw=row, ansetzung_state=ansetzung_state, vereinsnamen=vereinsnamen, spielort=spielort)
    else:
        ansetzung = view_ansetzung_of(ansetzung_state.spiel)

    return FLSpielbestaetigungViewResponse(
        state=state,
        side=side_of(row),
        ansetzung=ansetzung,
        deadline=str(row["deadline"]),
        # Never the row's own proposal on `declined`: the page shows an answered link its answering role alone.
        vorschlag=vorschlag_open if state == "vorschlag" else None,
        answered_by=answer["by"] if state in ("agreed", "declined") and answer is not None else None,
    )


@router.post(
    "",
    response_model=FLSpielbestaetigungAnswerResponse,
    summary="Confirm a fixture's Ansetzung, or decline it proposing another date",
)
async def post_spielbestaetigung(
    answer_data: Annotated[FLSpielbestaetigungAnswerPayload, Body()],
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieltage_collection: SpieltageCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielbestaetigungAnswerResponse:
    """
    Record one club's answer about one Ansetzung, from whichever of its three seats presses first, and the seat it came from.

    The first press binds: a second seat pressing at once conflicts with it, and its retry finds the row answered
    (`ansetzung_answered`). Writes no fixture: a proposal is the administrator's to act on.

    Refuses, in this order: a token no seat holds (`link_invalid`); a row already answered, closed since or not
    (`ansetzung_answered`); one closed unanswered (`ansetzung_closed`); a fixture decided, called off or left by a club
    (`ansetzung_decided`), then one whose date, time, ground or sides moved since the link (`ansetzung_changed`), each
    as the confirmation pass's close judges the row; an answer after the deadline's day (`ansetzung_deadline_past`); a
    proposal dated before today (`ansetzung_vorschlag_past`); one naming the day and hour the fixture already holds
    (`ansetzung_vorschlag_unchanged`, on both boxes); and a proposal the administrator's own save of that date would be
    refused, judged on what it newly claims and in that save's order: on or after a club's exit
    (`eligibility_disqualified`), outside the matchday (`spiel_outside_spieltag`), or within four hours of the ground's or the referee's
    other fixture (`spiel_double_booked`). The reason is stored as typed. Every refusal after the first is asked again outside
    the transaction just before answering, so a write landing mid-answer on what was judged refuses the answer rather
    than letting it stand.
    """

    token_hash = hash_token(answer_data.token)
    vorschlag = (
        None
        if answer_data.vorschlag is None
        else FLSpielbestaetigungAppointment(date=answer_data.vorschlag.date, time=answer_data.vorschlag.time)
    )

    async def answer_for_the_seat(session: AsyncClientSession) -> FLSpielbestaetigungAnswerResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        row = await spielbestaetigungen_collection.find_one(build_token_filter(token_hash=token_hash), projection=LINK_FIELDS, session=session)
        seat = None if row is None else seat_holding(spielbestaetigung_raw=row, token_hash=token_hash)
        refuse(find_unknown_link_refusal(seat=seat))
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
            """Every other refusal, over this Ansetzung and reads under `reads`: asked in the transaction, then again outside it."""

            refuse(find_spent_link_refusal(spielbestaetigung_raw=row, ansetzung_state=current, today=today))

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
                db_filter={**build_token_filter(token_hash=token_hash), **build_answerable_filter()},
                update=compose_answer_update(
                    answer=answer_data.answer,
                    seat=seat,
                    vorschlag=vorschlag,
                    reason=answer_data.reason,
                    today=today,
                ),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        except DocumentNotFoundError:
            # Never a seat answering under this press, which conflicts with the write and meets the retry's judgement:
            # the filter repeats that judgement on the write.
            refuse(first_press_refusal())

        await record_act(
            collection=spielbestaetigungen_collection,
            action="spielbestaetigung.answered",
            by=ACT_BY_KONTAKT,
            team=next((str(verein["name"]) for verein in ansetzung_state.vereine if verein["team_id"] == row["party"]["team_id"]), None),
            record_id=row["_id"],
            label=str(row["saison_id"]),
            session=session,
        )

        # Nothing judged is written here, so a move, a club's exit, a renamed seat, a re-dated matchday or a rival booking
        # landing under this transaction raises no conflict: all judged again outside it before answering.
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
        return await session.with_transaction(answer_for_the_seat)
