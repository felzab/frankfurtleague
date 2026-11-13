from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.grants.guard import verify_actor_is_admin
from app.api.outbox.services import enqueue_mails
from app.api.spielbestaetigungen.crud import (
    JUDGED_SPIEL_FIELDS,
    JUDGED_VEREIN_FIELDS,
    anchor_the_mailboxes_told,
    pull_ansetzung_state,
    pull_named_spiele,
)
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAppointment,
    FLSpielbestaetigungEnterPayload,
)
from app.api.spielbestaetigungen.services import (
    ADOPTION_TWINS,
    AnsetzungState,
    build_answerable_filter,
    build_discardable_filter,
    compose_closing_update,
    compose_enter_update,
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
    AufstellungenCollection,
    DBClient,
    OutboxCollection,
    SaisonsCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
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


@router.post(
    f"{by_id('spielbestaetigung_id')}/enter",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Record a party's Zusage on its behalf",
)
async def enter_spielbestaetigung(
    spielbestaetigung_id: CustomRouteObjectId,
    enter_data: Annotated[FLSpielbestaetigungEnterPayload, Body()],
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spiele_collection: SpieleCollection,
    saison_teams_collection: SaisonTeamsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> None:
    """Record that the party of an open confirmation agreed to its Ansetzung elsewhere than signed in, the reason saying how.

    The answer is the league's record of how a date was agreed and is never rewritten; it names nobody, and its reason
    goes at the season's end.
    """

    async def judged(row: Mapping[str, Any], *, session: AsyncClientSession | None) -> None:
        # The fixture and the clubs' exits, as the pass's close judges them: an agreement it would shut settles nothing.
        state = await pull_ansetzung_state(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            spielbestaetigung_raw=row,
            verein_projection=JUDGED_VEREIN_FIELDS,
            session=session,
        )
        if state is None:
            raise DocumentNotFoundError()
        refuse(find_enter_refusal(spielbestaetigung_raw=row, ansetzung_state=state, now=now))

    async def settle_for_the_party(session: AsyncClientSession) -> Mapping[str, Any]:
        row = await pull_one_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": spielbestaetigung_id},
            projection=["saison_id", "spiel_id", "party", "ansetzung", "answer", "closed"],
            session=session,
        )
        await judged(row, session=session)

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

        # The settle writes no fixture and no season row, so a save or an exit landing under this transaction raises no
        # conflict: judged again outside it before answering.
        await judged(row, session=None)

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
    now: datetime = Depends(get_germany_now),
) -> None:
    """Close a club's open decline proposing another date, which then stands as that club's one answer to this Ansetzung.

    The public fixture counts it as the club's agreement, and the club is told that the date stands.
    """

    async def judged(row: Mapping[str, Any], *, verein_projection: Mapping[str, Any], session: AsyncClientSession | None) -> AnsetzungState:
        # The close's own read, through the name join: the notice names the clubs as the fixture fields them.
        found = await pull_named_spiele(
            spiele_collection=spiele_collection, db_filter={"_id": row["spiel_id"]}, projection=JUDGED_SPIEL_FIELDS, session=session
        )
        if not found:
            raise DocumentNotFoundError()
        vereine = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": row["saison_id"], "team_id": {"$in": [row["ansetzung"]["team1_id"], row["ansetzung"]["team2_id"]]}},
            projection=verein_projection,
            session=session,
        )
        state = AnsetzungState(spiel=found[0], vereine=vereine)
        refuse(find_discard_refusal(spielbestaetigung_raw=row, ansetzung_state=state, now=now))

        return state

    async def discard_the_proposal(session: AsyncClientSession) -> Mapping[str, Any]:
        row = await pull_one_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": spielbestaetigung_id},
            projection=["saison_id", "spiel_id", "party", "ansetzung", "answer", "closed"],
            session=session,
        )
        # The clubs' season rows with what the notice reads too: the seats are the mailboxes told, and the name the one stated.
        state = await judged(row, verein_projection={**JUDGED_VEREIN_FIELDS, "_id": 1, "name": 1, "kontakte": 1}, session=session)

        try:
            discarded = await patch_one_in_db(
                collection=spielbestaetigungen_collection,
                db_filter={"_id": spielbestaetigung_id, **build_discardable_filter()},
                update=compose_closing_update(reason="discarded"),
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

        # Owed though no request was ever stamped, as `notice_owed` asks: the decline it discards was the club's own
        # answer, given signed in. An open proposal's club stands on the fixture, whose every side holds a season row.
        verein = next(verein for verein in state.vereine if verein["team_id"] == row["party"]["team_id"])
        names = vereinsnamen_of(spielbestaetigung_raw=row, ansetzung_state=state)
        data = notice_data_of(
            reason="discarded", party_kind="team", appointment=spiel_mail_appointment_of(spielbestaetigung_raw=row, names=names)
        )
        mails = team_mails(spielbestaetigung_raw=row, kontakte=verein.get("kontakte"), data=data, occasion="discarded")
        if mails:
            # A seat emptied or an address moved beside this write conflicts with it rather than leaving the old mailbox told.
            await anchor_the_mailboxes_told(saison_teams_collection=saison_teams_collection, saison_team_ids=[verein["_id"]], session=session)
        await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=now)

        # The fixture and the clubs' season rows are judged, and the anchor writes one at most, so a move or an exit
        # landing under this transaction need raise no conflict: judged again outside it before answering.
        await judged(row, verein_projection=JUDGED_VEREIN_FIELDS, session=None)

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
    aufstellungen_collection: AufstellungenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> None:
    """Move a fixture to the date and hour a club's open decline proposes, through the fixture's own save and refused as it is.

    The next confirmation pass closes every party's row about the slot left, tells each of the move and asks about the
    new slot.
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
        aufstellungen=aufstellungen_collection,
    )

    async def adopt_the_proposal(session: AsyncClientSession) -> None:
        row = await pull_one_from_db(
            collection=spielbestaetigungen_collection,
            db_filter={"_id": spielbestaetigung_id},
            projection=["saison_id", "spiel_id", "party", "ansetzung", "answer", "closed"],
            session=session,
        )
        # The whole fixture, which the save carries every field of but the day and the hour, and the clubs' exits.
        state = await pull_ansetzung_state(
            spiele_collection=spiele_collection,
            saison_teams_collection=saison_teams_collection,
            spielbestaetigung_raw=row,
            verein_projection=JUDGED_VEREIN_FIELDS,
            session=session,
        )
        if state is None:
            raise DocumentNotFoundError()
        refuse(find_adoption_refusal(spielbestaetigung_raw=row, ansetzung_state=state, now=now))
        vorschlag = FLSpielbestaetigungAppointment.model_validate(row["answer"]["vorschlag"])
        refuse(as_judged_on_stored_state(find_vorschlag_past_refusal(vorschlag=vorschlag, today=today), twins=ADOPTION_TWINS))

        # A discard of the same proposal writes this row, so the two conflict and the retry refuses the later one: a club
        # is never told both that its date was taken and that the date stands.
        await anchor_in_db(collection=spielbestaetigungen_collection, db_filter={"_id": spielbestaetigung_id}, session=session)
        try:
            await save_spiel_in_session(
                spiel_id=row["spiel_id"],
                payload=proposal_payload(FLSpiel.model_validate(state.spiel), vorschlag),
                collections=collections,
                adopts_bericht=None,
                now=now,
                act="spielbestaetigung.vorschlag_adopted",
                session=session,
            )
        except APIError as refused:
            # As the draw answers the season write's refusals it shares: the paths the save names are its body's, and
            # this request carries none.
            refuse(as_judged_on_stored_state(WriteRefusal.of(refused), twins=ADOPTION_TWINS))

    async with transaction_session(db) as session:
        await session.with_transaction(adopt_the_proposal)
