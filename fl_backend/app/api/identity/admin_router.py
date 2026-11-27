from typing import Annotated

from fastapi import APIRouter, Query, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.services import AddressRecords, preview_withdrawal_at_address, withdraw_at_address
from app.api.address_change.crud import others_naming
from app.api.grants.crud import read_grants
from app.api.grants.guard import ADMIN_TIER
from app.api.identity.crud import erase_everything, resolve_subject
from app.api.identity.lookup import ErasureHandles
from app.api.identity.schemas import (
    FLEinwilligungWithdrawalPayload,
    FLEinwilligungWithdrawalReport,
    FLErasureAddressPayload,
    FLErasurePayload,
    FLErasureViewResponse,
)
from app.api.identity.services import (
    address_change_viewable_denied,
    build_booked_spiele_pipeline,
    compose_erasure_view,
    find_foreign_address_change_refusal,
    find_off_limits_refusal,
)
from app.api.spiele.schemas import is_played
from app.core.crud import aggregate_many_from_db, refuse, refuse_faults
from app.core.dependencies import (
    AddressChangeReadCollection,
    BewerbungenCollection,
    BewerbungenReadCollection,
    DBClient,
    GermanyNow,
    GrantsReadCollection,
    RegistrierungenCollection,
    RegistrierungenReadCollection,
    SaisonTeamsCollection,
    SaisonTeamsReadCollection,
    SchiedsrichterCollection,
    SchiedsrichterReadCollection,
    SnapshotSession,
    SpielerCollection,
    SpieleReadCollection,
    SpielerReadCollection,
    TeamsReadCollection,
)
from app.core.journal import Journal
from app.core.recording import record_act
from app.core.routing import SAFE, SAFE_WHEN
from app.core.security import ActorEmail
from app.core.transactions import transact
from app.shared.folding import sign_in_identifier

router = APIRouter(
    prefix="/identity",
    dependencies=ADMIN_TIER,
)


@router.post(
    "/erasure/view",
    summary="Count what an erasure of an address would remove",
    openapi_extra=SAFE,
)
async def get_erasure_view(
    view_data: FLErasureAddressPayload,
    saison_teams_collection: SaisonTeamsReadCollection,
    bewerbungen_collection: BewerbungenReadCollection,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    spieler_collection: SpielerReadCollection,
    registrierungen_collection: RegistrierungenReadCollection,
    spiele_collection: SpieleReadCollection,
    grants_collection: GrantsReadCollection,
    address_changes_collection: AddressChangeReadCollection,
    session: SnapshotSession,
    operator: ActorEmail,
    germany_now: GermanyNow,
) -> FLErasureViewResponse:
    """Count what `POST /identity/erasure` would remove or empty for this address, by kind, naming nothing and storing nothing.

    It is refused as that erasure is, and leaves out of `address_change` a grant holder's change this administrator may not see.
    """

    identifier = sign_in_identifier(view_data.email)
    # Every read in the request's snapshot session, so the counts are of one moment; never a transaction,
    # a read writing nothing having no conflict to retry for.
    grants = await read_grants(grants_collection=grants_collection, session=session)
    refuse_faults(find_off_limits_refusal(identifier=identifier, actor=operator, grants=grants, path=("email",)))

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
    booked = (
        await aggregate_many_from_db(
            collection=spiele_collection,
            pipeline=build_booked_spiele_pipeline(row["_id"] for row in subject.schiedsrichter),
            session=session,
        )
        if subject.schiedsrichter
        else []
    )
    # A grant holder's change is left out for whoever the tool refuses it: counting it would answer whether a typed
    # address is its new one.
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
        pupil_row=subject.spieler,
        registrierung_rows=subject.registrierungen,
        address_change_rows=[row for row in subject.address_change if row not in withheld],
        grant_rows=subject.grants,
        # Partitioned as the erasure partitions them, so the count is the bookings it takes off.
        spiele=sum(not is_played(date=spiel.get("date"), time=spiel.get("time"), now=germany_now) for spiel in booked),
    )


@router.post(
    "/erasure",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Erase every record an address holds, on that person's request",
)
async def post_erasure(
    erasure_data: FLErasurePayload,
    collections: ErasureHandles,
    db: DBClient,
    operator: ActorEmail,
    germany_now: GermanyNow,
) -> None:
    """Erase every record an address holds, on a request that person made by mail, at once and as one write, as their own erasure does.

    Nothing about the person's own state refuses it, and the sign-in account is the caller's to delete once this has answered.
    """

    identifier = sign_in_identifier(erasure_data.email)
    journal = Journal()

    @journal.attempted
    async def erase_the_address(session: AsyncClientSession) -> None:
        # Inside the attempt, so a grant landing before its retry is judged by that retry.
        grants = await read_grants(grants_collection=collections.grants_collection, session=session)
        refuse_faults(find_off_limits_refusal(identifier=identifier, actor=operator, grants=grants, path=("email",)))

        subject = await resolve_subject(
            identifier,
            saison_teams_collection=collections.saison_teams_collection,
            bewerbungen_collection=collections.bewerbungen_collection,
            schiedsrichter_collection=collections.schiedsrichter_collection,
            spieler_collection=collections.spieler_collection,
            registrierungen_collection=collections.registrierungen_collection,
            address_changes_collection=collections.address_changes_collection,
            grants_collection=collections.grants_collection,
            session=session,
        )
        # Ending a grant holder's change is a discard, which only the owner makes. Behind the address's own refusal: it
        # names changes of addresses this administrator may not see, which an address off limits must not answer.
        refuse(
            find_foreign_address_change_refusal(
                addresses=[str(row["address"]) for row in others_naming(subject.address_change, identifier)],
                actor=operator,
                grants=grants,
            )
        )

        erasure = await erase_everything(identifier, collections=collections, now=germany_now, session=session)
        await record_act(collection=collections.action_log_collection, action="erasure.on_request", label=erasure_data.reason, session=session)
        journal.note("erasure", erasure.records, seats=erasure.seats, rows=erasure.rows)

    async with journal:
        await transact(db, erase_the_address)


@router.post(
    "/withdrawal",
    summary="Enter a withdrawal of the consents an address holds, on that person's request by mail",
    openapi_extra=SAFE_WHEN,
)
async def post_withdrawal(
    withdrawal_data: FLEinwilligungWithdrawalPayload,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    teams_collection: TeamsReadCollection,
    grants_collection: GrantsReadCollection,
    db: DBClient,
    session: SnapshotSession,
    operator: ActorEmail,
    germany_now: GermanyNow,
    dry_run: Annotated[bool, Query(description="Report what this entry would end, and write nothing")] = False,
) -> FLEinwilligungWithdrawalReport:
    """Withhold each named choice on every record the address holds that grants it, answering per kind what it ended.

    A choice already withheld is left out of the answer and written nothing, nothing is ever granted, and a `dry_run`
    writes nothing and answers the same report.
    """

    identifier = sign_in_identifier(withdrawal_data.email)
    # Refused as the erasure is, its `dry_run` too. In the snapshot and not the entry's transaction: the entry writes no
    # row a grant's addition writes, and ends no grant, so judging inside it would close no race.
    grants = await read_grants(grants_collection=grants_collection, session=session)
    refuse_faults(find_off_limits_refusal(identifier=identifier, actor=operator, grants=grants, path=("email",)))
    records = AddressRecords(
        spieler=spieler_collection,
        schiedsrichter=schiedsrichter_collection,
        saison_teams=saison_teams_collection,
        bewerbungen=bewerbungen_collection,
        registrierungen=registrierungen_collection,
        teams=teams_collection,
    )

    if dry_run:
        return await preview_withdrawal_at_address(identifier, choices=withdrawal_data.choices, records=records, session=session)

    return await withdraw_at_address(identifier, choices=withdrawal_data.choices, records=records, db=db, now=germany_now)
