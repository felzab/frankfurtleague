from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Query, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.grants.guard import verify_actor_is_admin
from app.api.outbox.services import enqueue_mails
from app.api.spielbestaetigungen.crud import anchor_the_mailboxes_told, pull_admin_rows, pull_named_spiele
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigung,
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungenFilterParams,
    FLSpielbestaetigungenListResponse,
    FLSpielbestaetigungEnterPayload,
)
from app.api.spielbestaetigungen.services import (
    ADOPTION_TWINS,
    ANSETZUNG_QUELLEN,
    AnsetzungState,
    build_answerable_filter,
    build_discardable_filter,
    compose_closing_update,
    compose_enter_update,
    discard_owes_a_notice,
    discard_refusal,
    enter_refusal,
    find_adoption_refusal,
    find_discard_refusal,
    find_enter_refusal,
    find_vorschlag_past_refusal,
    notice_data_of,
    proposal_payload,
    spiel_mail_appointment_of,
    team_mails,
    vereinsnamen_of,
)
from app.api.spiele.crud import SpielSaveCollections, save_spiel_in_session
from app.api.spiele.schemas import FLSpiel
from app.core.config import API_VERSION
from app.core.crud import anchor_in_db, patch_one_in_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import (
    DBClient,
    OutboxCollection,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    SpielbestaetigungenReadCollection,
    SpieleCollection,
    SpielorteCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import APIError, DocumentNotFoundError, WriteRefusal, as_judged_on_stored_state
from app.core.recording import record_act
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)

FLSpielbestaetigungenFilters = Annotated[FLSpielbestaetigungenFilterParams, Query()]


@router.get(
    "",
    response_model=FLSpielbestaetigungenListResponse,
    summary="A season's fixture confirmations, or one fixture's",
)
async def get_spielbestaetigungen(
    spielbestaetigungen_collection: SpielbestaetigungenReadCollection,
    filters: FLSpielbestaetigungenFilters,
) -> FLSpielbestaetigungenListResponse:
    """
    Every confirmation row of the season, or of its one fixture.

    Newest first, closed rows included. No seat's address is served. Every row still holding its party's question is
    served; `limit` cuts the others, and `complete` is false where it left the oldest of them out. A season no
    document has answers no rows rather than 404.
    """

    db_filter: dict[str, Any] = {"saison_id": filters.saison_id}
    if filters.spiel_id is not None:
        db_filter["spiel_id"] = filters.spiel_id

    rows, complete = await pull_admin_rows(
        spielbestaetigungen_collection=spielbestaetigungen_collection, db_filter=db_filter, limit=filters.limit
    )

    return FLSpielbestaetigungenListResponse(
        spielbestaetigungen=[FLSpielbestaetigung.model_validate(row) for row in rows],
        complete=complete,
    )


@router.post(
    f"{by_id('spielbestaetigung_id')}/enter",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Record a party's Zusage on its behalf",
)
async def enter_spielbestaetigung(
    spielbestaetigung_id: CustomRouteObjectId,
    enter_data: Annotated[FLSpielbestaetigungEnterPayload, Body()],
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> None:
    """
    Record that the party of an open confirmation agreed to its Ansetzung elsewhere than by its own answer, signed in.

    The administrator's reason says how. IRREVERSIBLE: the answer is the league's record of how a date was agreed, and
    nothing rewrites it. It names nobody: no seat and no person is recorded, and the reason takes any text and goes at
    the season's end. Refused for a row
    already answered, by a seat or by an administrator, or closed (`ansetzung_not_enterable`), including one a seat answers
    while this request runs: of the two answers exactly one is stored. A row about an Ansetzung the fixture has since
    left is settled as asked, and the next confirmation pass closes it.
    """

    async def settle_for_the_party(session: AsyncClientSession) -> Mapping[str, Any]:
        row = await pull_one_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": spielbestaetigung_id},
            projection=["saison_id", "answer", "closed"],
            session=session,
        )
        refuse(find_enter_refusal(spielbestaetigung_raw=row))

        try:
            # The state term as a seat's press writes it. A seat's answer committing under
            # this one conflicts with the write instead, and the retry's read above refuses.
            entered = await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_answerable_filter()},
                update=compose_enter_update(reason=enter_data.reason, today=today),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.AFTER,
            )
        except DocumentNotFoundError as miss:
            raise enter_refusal().error() from miss

        await record_act(
            collection=spielbestaetigungen_collection,
            action="spielbestaetigung.entered",
            record_id=spielbestaetigung_id,
            label=str(row["saison_id"]),
            session=session,
        )

        return entered

    async with transaction_session(db) as session:
        await session.with_transaction(settle_for_the_party)


@router.post(
    f"{by_id('spielbestaetigung_id')}/discard",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Discard a club's proposed date",
)
async def discard_spielbestaetigung(
    spielbestaetigung_id: CustomRouteObjectId,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> None:
    """
    Close a club's open decline that proposes another date, so the proposal stops asking the administrator to act.

    IRREVERSIBLE: the decline stays as the club gave it, and the row is closed `discarded`, which is that club's one
    answer to this Ansetzung: the confirmation pass never asks it about this Ansetzung again, and the public fixture
    counts it as the club's agreement, the league having kept the date, until a pass closes it again as it closes an
    agreement beside it. Where its day is still to come, the club is owed a notice that the date stands, at every
    address its season row's seats hold now, in the same transaction. Refused for any other row -- open, agreed,
    declined without a proposal, a referee's, closed, or about an Ansetzung the fixture has left, the fixture moving
    while this request runs included (`ansetzung_not_discardable`): the confirmation pass closes that row and tells its club of
    the move.
    """

    async def judged(row: Mapping[str, Any], session: AsyncClientSession | None) -> Mapping[str, Any]:
        # Through the name join: the notice names the clubs as the fixture fields them.
        found = await pull_named_spiele(
            spiele_collection=spiele_collection,
            db_filter={"_id": row["spiel_id"]},
            projection={key: 1 for key in (*ANSETZUNG_QUELLEN.values(), "team1.name", "team2.name")},
            session=session,
        )
        if not found:
            raise DocumentNotFoundError()
        spiel = found[0]
        refuse(find_discard_refusal(spielbestaetigung_raw=row, spiel=spiel))

        return spiel

    async def discard_the_proposal(session: AsyncClientSession) -> Mapping[str, Any]:
        row = await pull_one_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": spielbestaetigung_id},
            projection=["saison_id", "spiel_id", "party", "ansetzung", "answer", "closed"],
            session=session,
        )
        spiel = await judged(row, session)

        try:
            discarded = await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_discardable_filter()},
                update=compose_closing_update(reason="discarded", today=today),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.AFTER,
            )
        except DocumentNotFoundError as miss:
            raise discard_refusal().error() from miss

        await record_act(
            collection=spielbestaetigungen_collection,
            action="spielbestaetigung.vorschlag_discarded",
            record_id=spielbestaetigung_id,
            label=str(row["saison_id"]),
            session=session,
        )

        if discard_owes_a_notice(row=row, today=today):
            # The club's season row as it stands, its seats the mailboxes told and its name the one the notice states.
            vereine = await pull_many_from_db(
                collection=saison_teams_collection,
                db_filter={"saison_id": row["saison_id"], "team_id": {"$in": [row["ansetzung"]["team1_id"], row["ansetzung"]["team2_id"]]}},
                projection=["team_id", "name", "kontakte"],
                session=session,
            )
            # An open proposal's club stands on the fixture, whose every side holds a season row: a replacement moves both.
            verein = next(verein for verein in vereine if verein["team_id"] == row["party"]["team_id"])
            names = vereinsnamen_of(spielbestaetigung_raw=row, ansetzung_state=AnsetzungState(spiel=spiel, vereine=vereine))
            data = notice_data_of(
                reason="discarded", party_kind="team", appointment=spiel_mail_appointment_of(spielbestaetigung_raw=row, names=names)
            )
            mails = team_mails(spielbestaetigung_raw=row, kontakte=verein.get("kontakte"), data=data, occasion="discarded")
            if mails:
                # A seat emptied or an address moved beside this write conflicts with it rather than leaving the old mailbox told.
                await anchor_the_mailboxes_told(
                    saison_teams_collection=saison_teams_collection, saison_team_ids=[verein["_id"]], session=session
                )
            await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=now)

        # The fixture is judged and not written, so a move landing under this transaction raises no conflict: judged
        # again outside it before answering.
        await judged(row, None)

        return discarded

    async with transaction_session(db) as session:
        await session.with_transaction(discard_the_proposal)


@router.post(
    f"{by_id('spielbestaetigung_id')}/adopt",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Adopt a club's proposed date",
)
async def adopt_spielbestaetigung(
    spielbestaetigung_id: CustomRouteObjectId,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieltage_collection: SpieltageCollection,
    spielorte_collection: SpielorteCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spielberichte_collection: SpielberichteCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> None:
    """
    Move a fixture to the date and hour a club's open decline proposes, through the fixture's own save.

    Refused for any row but an open club decline proposing a date about the fixture's current Ansetzung, the row a
    discard closes (`ansetzung_not_adoptable`), and for a proposed day gone by (`ansetzung_vorschlag_past_as_stored`, the
    stored proposal's 409). The fixture is saved as the administrator's save would carry it on the proposed day and
    hour, everything else kept, so it meets every rule that save meets and is refused as that save is, by its code and
    status alone, as the draw answers the season write's refusals: no refusal names a field, the request carrying no
    body. A code the save names a field by is answered under its twin for that field instead, a 409: the ground or the
    referee booked beside the proposed slot (`spiel_double_booked_spielort_as_stored`,
    `spiel_double_booked_schiedsrichter_as_stored`), a side out of the season by then
    (`eligibility_disqualified_team1_as_stored`, `eligibility_disqualified_team2_as_stored`). The bracket is resolved
    as that save resolves it. The
    row is not closed here: the fixture has left the Ansetzung it answers, so its parties' pages read it `invalid` at once and the
    next confirmation pass closes every party's row `ansetzung_changed`, owing each party „Spiel verlegt“ and asking it
    about the new slot. IRREVERSIBLE as a save is: moving the fixture back is another save.
    """

    collections = SpielSaveCollections(
        spiele=spiele_collection,
        teams=teams_collection,
        saisons=saisons_collection,
        saison_teams=saison_teams_collection,
        spieltage=spieltage_collection,
        spielorte=spielorte_collection,
        schiedsrichter=schiedsrichter_collection,
        spielberichte=spielberichte_collection,
    )

    async def adopt_the_proposal(session: AsyncClientSession) -> None:
        row = await pull_one_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": spielbestaetigung_id},
            projection=["saison_id", "spiel_id", "party", "ansetzung", "answer", "closed"],
            session=session,
        )
        # The whole fixture: the save carries every field of it but the day and the hour.
        spiel = await pull_one_from_db(collection=spiele_collection, db_filter={"_id": row["spiel_id"]}, session=session)
        refuse(find_adoption_refusal(spielbestaetigung_raw=row, spiel=spiel))
        vorschlag = FLSpielbestaetigungAppointment.model_validate(row["answer"]["vorschlag"])
        refuse(as_judged_on_stored_state(find_vorschlag_past_refusal(vorschlag=vorschlag, today=today), twins=ADOPTION_TWINS))

        # A discard of the same proposal writes this row, so the two conflict and the retry refuses the later one: a club
        # is never told both that its date was taken and that the date stands.
        await anchor_in_db(collection=spielbestaetigungen_collection, db_filter={"_id": spielbestaetigung_id}, session=session)
        try:
            await save_spiel_in_session(
                spiel_id=row["spiel_id"],
                payload=proposal_payload(FLSpiel.model_validate(spiel), vorschlag),
                collections=collections,
                adopts_bericht=None,
                act="spielbestaetigung.vorschlag_adopted",
                session=session,
            )
        except APIError as refused:
            # As the draw answers the season write's refusals it shares: the paths the save names are its body's, and
            # this request carries none.
            refuse(as_judged_on_stored_state(WriteRefusal.of(refused), twins=ADOPTION_TWINS))

    async with transaction_session(db) as session:
        await session.with_transaction(adopt_the_proposal)
