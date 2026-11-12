from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.schemas import (
    FLAccountAddressChangeMintResponse,
    FLAccountAddressChangeOpen,
    FLAccountAddressChangePayload,
    FLAccountAddressChangeResponse,
    FLAccountEinwilligungenResponse,
)
from app.api.account.services import (
    account_arms,
    build_account_pipeline,
    compose_bewerbung_seats_self,
    compose_registrierungen_self,
    compose_schiedsrichter_account,
    compose_seats_self,
    compose_spieler_account,
)
from app.api.address_change.crud import (
    end_the_change_in_session,
    live_grant_of,
    owe_the_notice_in_session,
    read_the_holdings,
    start_the_change_in_session,
    tell_the_holders_of_the_end_in_session,
)
from app.api.address_change.services import (
    build_address_filter,
    compose_record,
    find_nothing_refusal,
    find_restart_refusal,
    find_unchanged_refusal,
    is_expired,
    masked_address,
    stored_instant,
    wait_tier,
    waits_on,
)
from app.api.identity.crud import roles_from
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import is_own_schiedsrichter, is_own_spieler, may_grant_on_schiedsrichter
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, refuse
from app.core.dependencies import (
    AddressChangeCollection,
    AddressChangeReadCollection,
    DBClient,
    GrantsCollection,
    GrantsReadCollection,
    OutboxCollection,
    SpielerReadCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier

# Its one write is the address change, which crosses every record the address holds.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/account",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)


@router.get("/einwilligungen", response_model=FLAccountEinwilligungenResponse, summary="A signed-in person's own consent records")
async def get_einwilligungen(
    identifier: PersonIdentifier,
    spieler_collection: SpielerReadCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLAccountEinwilligungenResponse:
    """Every confirmed consent record the signed-in address holds, pending applications and registrations as withdraw-only.

    An address holding nothing is answered empty, never refused, and retired and past records are served too, so a
    withdrawal stays open wherever a consent stands.
    """

    # One aggregation, every kind of own record unioned and each joined to what it names, so the page costs one round trip;
    # in a snapshot, so its arms and their joins are read as of one moment.
    async with db.start_session(snapshot=True) as session:
        rows = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_account_pipeline(identifier), session=session)

    arms = account_arms(rows)
    pupils, referees, seat_rows = arms["spieler"], arms["schiedsrichter"], arms["seats"]
    # From the rows read above, which the subject's own selections choose: a second read would answer the same.
    subject = roles_from(identifier, seat_rows=seat_rows, referee_rows=referees, pupil_rows=pupils)
    teams = {team["_id"]: team for row in rows for team in row.get("teams", [])}

    pupil = next((row for row in pupils if is_own_spieler(row)), None)

    return FLAccountEinwilligungenResponse.model_validate(
        {
            "spieler": None if pupil is None else compose_spieler_account(pupil, today=today),
            "schiedsrichter": [
                compose_schiedsrichter_account(row, givable=may_grant_on_schiedsrichter(subject, row["_id"]), today=today)
                for row in referees
                if is_own_schiedsrichter(row, identifier)
            ],
            "seats": compose_seats_self(seat_rows, identifier, seats_with_panel=subject.seats, today=today),
            "bewerbungen": compose_bewerbung_seats_self(arms["bewerbungen"], identifier, teams=teams),
            "registrierungen": compose_registrierungen_self(arms["registrierungen"], identifier, teams=teams),
        }
    )


def _pending_addresses(record: Mapping[str, Any], *, now: datetime) -> FLAccountAddressChangeOpen:
    return FLAccountAddressChangeOpen(
        id=record["_id"],
        # The address the person typed here is theirs to see; one an administrator typed is shown recognisable alone.
        email=record["email"] if record["way"] == "account" else masked_address(str(record["email"])),
        way=record["way"],
        waits_on=waits_on(record),
        valid_until=stored_instant(record.get("valid_until")),
        effective_from=stored_instant(record.get("effective_from")),
        expired=is_expired(record, now=now),
    )


async def _address_change_answer(
    identifier: str,
    *,
    address_changes_collection: ReadCollection,
    grants_collection: ReadCollection,
    now: datetime,
    session: AsyncClientSession | None,
) -> FLAccountAddressChangeResponse:
    record = await address_changes_collection.find_one(build_address_filter(identifier), session=session)
    grant = await live_grant_of(identifier, grants_collection=grants_collection, session=session)

    return FLAccountAddressChangeResponse(open=None if record is None else _pending_addresses(record, now=now), wait_tier=wait_tier(grant))


@router.get("/address_change", response_model=FLAccountAddressChangeResponse, summary="The address change pending on a signed-in person")
async def get_address_change(
    identifier: PersonIdentifier,
    address_changes_collection: AddressChangeReadCollection,
    grants_collection: GrantsReadCollection,
    germany_now: datetime = Depends(get_germany_now),
) -> FLAccountAddressChangeResponse:
    """The change pending on the signed-in address, null where none is, and the tier whose wait a change of it serves.

    The pending address is served whole only where the person typed it, and masked where an administrator started the change.
    """

    return await _address_change_answer(
        identifier, address_changes_collection=address_changes_collection, grants_collection=grants_collection, now=germany_now, session=None
    )


@router.post(
    "/address_change",
    response_model=FLAccountAddressChangeMintResponse,
    summary="Start a change of the signed-in person's address",
)
async def post_address_change(
    identifier: PersonIdentifier,
    address_change_data: Annotated[FLAccountAddressChangePayload, Body()],
    records: SubjectLookup,
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLAccountAddressChangeMintResponse:
    """Start a change of the address the person signs in on: the address on file is mailed a link, and its confirmation mails the new one.

    Everything the address holds moves once the new address confirms, after a wait where it holds a grant; declining
    either link ends the change, and a live change of the address is replaced.
    """

    email = address_change_data.email

    async def start_the_change(session: AsyncClientSession) -> FLAccountAddressChangeMintResponse:
        # First: a press repeated inside the interval asks nothing of the records.
        live = await address_changes_collection.find_one(build_address_filter(identifier), {"valid_until": 1}, session=session)
        restart = find_restart_refusal(live_valid_until=None if live is None else live["valid_until"], now=germany_now)
        if restart is not None:
            raise restart
        holdings = await read_the_holdings(identifier, records=records, grants_collection=grants_collection, session=session)
        refuse(find_nothing_refusal(empty=holdings.empty))
        # What the new address holds, another pupil or a grant, is never judged, so the start answers alike whatever it holds.
        refuse(find_unchanged_refusal(address=identifier, folded=sign_in_identifier(email)))

        record = compose_record(address=identifier, email=email, way="account", now=germany_now)
        # Replaces the address's live change, an administrator's too: a sign-in at the address on file proves the mailbox
        # is not lost.
        address_change_id = await start_the_change_in_session(
            record=record,
            address_changes_collection=address_changes_collection,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )
        # The address on file's link alone: the new mailbox is asked once the address on file confirmed.
        await owe_the_notice_in_session(
            address_change_id=address_change_id,
            address=identifier,
            way="account",
            valid_until=record["valid_until"],
            holder=holdings.waits_as,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

        return FLAccountAddressChangeMintResponse(id=address_change_id, valid_until=record["valid_until"], email=email)

    async with transaction_session(db) as session:
        return await session.with_transaction(start_the_change)


@router.delete(
    "/address_change",
    response_model=FLAccountAddressChangeResponse,
    summary="Stop the address change pending on the signed-in person",
)
async def delete_address_change(
    identifier: PersonIdentifier,
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLAccountAddressChangeResponse:
    """Stop the change pending on the signed-in address at any step, its new address going; a holder's change in its wait tells every holder."""

    # Asks no fresh confirmation: a stop hands nothing over.
    async def stop_the_change(session: AsyncClientSession) -> FLAccountAddressChangeResponse:
        live = await address_changes_collection.find_one(build_address_filter(identifier), {"_id": 1}, session=session)
        if live is None:
            raise DocumentNotFoundError()

        stopped = await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            db_filter={"_id": live["_id"]},
            kind="stopped",
            now=germany_now,
            session=session,
        )
        await tell_the_holders_of_the_end_in_session(
            stopped,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

        return await _address_change_answer(
            identifier,
            address_changes_collection=address_changes_collection,
            grants_collection=grants_collection,
            now=germany_now,
            session=session,
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(stop_the_change)
