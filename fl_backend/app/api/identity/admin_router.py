from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.address_change.crud import others_naming
from app.api.grants.crud import read_grants
from app.api.grants.guard import verify_actor_is_admin
from app.api.identity.crud import EACH_PERSON_GROUP, erase_everything, resolve_subject
from app.api.identity.schemas import FLErasureAddressPayload, FLErasurePayload, FLErasureViewResponse
from app.api.identity.services import (
    address_change_viewable_denied,
    build_unplayed_count_pipeline,
    compose_erasure_view,
    find_admin_address_refusal,
    find_foreign_address_change_refusal,
    find_own_address_refusal,
)
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, refuse
from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    AddressChangeReadCollection,
    AufstellungenCollection,
    BewerbungenCollection,
    BewerbungenReadCollection,
    DBClient,
    GrantsCollection,
    GrantsReadCollection,
    OutboxCollection,
    RegistrierungenCollection,
    RegistrierungenReadCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SchiedsrichterCollection,
    SchiedsrichterReadCollection,
    SnapshotSession,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    SpieleCollection,
    SpielerCollection,
    SpieleReadCollection,
    SpielerReadCollection,
    get_germany_now,
)
from app.core.journal import Journal
from app.core.recording import record_act
from app.core.routing import SAFE
from app.core.security import bind_actor, get_actor_email, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/identity",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


@router.post(
    "/erasure/view",
    response_model=FLErasureViewResponse,
    summary="Count what an erasure of an address would remove",
    openapi_extra=SAFE,
)
async def get_erasure_view(
    view_data: Annotated[FLErasureAddressPayload, Body()],
    saison_teams_collection: SaisonTeamsReadCollection,
    bewerbungen_collection: BewerbungenReadCollection,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    spieler_collection: SpielerReadCollection,
    registrierungen_collection: RegistrierungenReadCollection,
    spiele_collection: SpieleReadCollection,
    grants_collection: GrantsReadCollection,
    address_changes_collection: AddressChangeReadCollection,
    session: SnapshotSession,
    operator: str = Depends(get_actor_email),
) -> FLErasureViewResponse:
    """
    Count what `POST /identity/erasure` would remove or empty for this address, by kind, and name nothing.

    ADMIN TIER. Takes that erasure's own payload address and reads through its own selections in one snapshot. `spiele`
    counts the fixtures still to be played that a referee row is booked on. `address_change` counts the address's own live
    change and each other address's change naming it, leaving out a grant holder's for an administrator without an owner's
    power, since counting it would answer whether a typed address is its new one. Stores nothing.

    Refused as the erasure is: the administrator's own address (`own_address`), an address holding a grant unless the
    administrator holds an owner's power (`admin_address`).
    """

    identifier = sign_in_identifier(view_data.email)
    refuse(find_own_address_refusal(identifier=identifier, actor=operator))

    # Every read in the request's snapshot session, so the counts are of one moment; never a transaction,
    # a read writing nothing having no conflict to retry for.
    grants = await read_grants(grants_collection=grants_collection, session=session)
    refuse(find_admin_address_refusal(identifier=identifier, actor=operator, grants=grants))

    subject = await resolve_subject(
        identifier,
        saison_teams_collection=saison_teams_collection,
        bewerbungen_collection=bewerbungen_collection,
        schiedsrichter_collection=schiedsrichter_collection,
        spieler_collection=spieler_collection,
        registrierungen_collection=registrierungen_collection,
        address_changes_collection=address_changes_collection,
        grants_collection=grants_collection,
        session=session,
    )
    unplayed = (
        await aggregate_many_from_db(
            collection=spiele_collection,
            pipeline=build_unplayed_count_pipeline(row["_id"] for row in subject.schiedsrichter),
            session=session,
        )
        if subject.schiedsrichter
        else []
    )
    # A grant holder's change is left out for whoever the tool refuses it.
    withheld = [
        row
        for row in others_naming(subject.address_change, identifier)
        if address_change_viewable_denied(str(row["address"]), actor=operator, grants=grants) == "admin_address"
    ]

    return compose_erasure_view(
        identifier,
        saison_team_rows=subject.saison_teams,
        bewerbung_rows=subject.bewerbungen,
        referee_rows=subject.schiedsrichter,
        pupil_rows=subject.spieler,
        registrierung_rows=subject.registrierungen,
        address_change_rows=[row for row in subject.address_change if row not in withheld],
        grant_rows=subject.grants,
        spiele=sum(row["count"] for row in unplayed),
    )


@router.post(
    "/erasure",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Erase every record an address holds, on that person's request",
)
async def post_erasure(
    erasure_data: Annotated[FLErasurePayload, Body()],
    spieler_collection: SpielerCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    aufstellungen_collection: AufstellungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    action_log_collection: ActionLogCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    address_changes_collection: AddressChangeCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    germany_now: datetime = Depends(get_germany_now),
) -> None:
    """
    Erase every record an address holds, on a request that person made by mail, at once and as one write.

    ADMIN TIER. It runs the erasure `POST /identity/account/erasure` runs and refuses nothing about the person's own
    state: a pupil in a live squad and a referee booked on a fixture still to be played are erased on one pass. Three
    refusals are about who asks. The administrator's own address is refused (`own_address`): their account page serves it,
    or the owner. An address holding a grant is refused unless the administrator holds an owner's power (`admin_address`),
    judged inside the write. An address another address's pending change would move to is refused, judged inside the write,
    where that address holds a grant and the administrator no owner's power (`foreign_address_change`): the erasure ends the
    change, a discard only the owner makes of it.

    `reason` names the request the erasure answers, as free text. An address holding nothing is no refusal. The 404 and the
    409 answer only a database changed by hand under the request. The sign-in account is not touched here: deleting it is
    the caller's, once this has answered.
    """

    identifier = sign_in_identifier(erasure_data.email)
    # Before the transaction: who asks is known from the token alone.
    refuse(find_own_address_refusal(identifier=identifier, actor=operator))

    journal = Journal()

    @journal.attempted
    async def erase_the_address(session: AsyncClientSession) -> None:
        grants = await read_grants(grants_collection=grants_collection, session=session)
        refuse(find_admin_address_refusal(identifier=identifier, actor=operator, grants=grants))

        # Ahead of the erasure's first write, and in its snapshot: a retry judges the changes afresh.
        subject = await resolve_subject(
            identifier,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            spieler_collection=spieler_collection,
            registrierungen_collection=registrierungen_collection,
            address_changes_collection=address_changes_collection,
            grants_collection=grants_collection,
            session=session,
        )
        # Ending a grant holder's change is a discard, which only the owner makes.
        refuse(
            find_foreign_address_change_refusal(
                addresses=[str(row["address"]) for row in others_naming(subject.address_change, identifier)],
                actor=operator,
                grants=grants,
            )
        )

        erasure = await erase_everything(
            identifier,
            scope=EACH_PERSON_GROUP,
            spieler_collection=spieler_collection,
            saison_spieler_collection=saison_spieler_collection,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            spiele_collection=spiele_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            spielberichte_collection=spielberichte_collection,
            aufstellungen_collection=aufstellungen_collection,
            registrierungen_collection=registrierungen_collection,
            action_log_collection=action_log_collection,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            address_changes_collection=address_changes_collection,
            now=germany_now,
            session=session,
        )
        await record_act(collection=action_log_collection, action="erasure.on_request", label=erasure_data.reason, session=session)
        journal.note("erasure", erasure.records, seats=erasure.seats, rows=erasure.rows)

    async with journal, transaction_session(db) as session:
        await session.with_transaction(erase_the_address)
