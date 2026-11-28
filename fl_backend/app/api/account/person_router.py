from collections.abc import Mapping
from datetime import datetime
from typing import Any

from fastapi import APIRouter, status
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.schemas import (
    FLAccountAddressChangeOpen,
    FLAccountAddressChangePayload,
    FLAccountAddressChangeResponse,
    FLAccountEinwilligungenResponse,
)
from app.api.account.services import (
    build_account_pupil_pipeline,
    build_account_referee_pipeline,
    build_self_bewerbung_pipeline,
    build_self_registrierung_pipeline,
    build_self_seat_pipeline,
    compose_bewerbung_seats_self,
    compose_registrierungen_self,
    compose_schiedsrichter_account,
    compose_seats_self,
    compose_spieler_account,
)
from app.api.address_change.crud import (
    Holdings,
    end_the_change_in_session,
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
    waits_on,
)
from app.api.identity.crud import roles_from
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import is_own_schiedsrichter, is_own_spieler, may_grant_on_schiedsrichter
from app.core.concurrency import concurrently
from app.core.crud import aggregate_many_from_db, refuse, refuse_faults
from app.core.dependencies import (
    AddressChangeCollection,
    AddressChangeReadCollection,
    DBClient,
    GermanDay,
    GermanyNow,
    GrantsCollection,
    OutboxCollection,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.routing import SAFE_WHEN, DryRun
from app.core.security import PERSON_TIER, PersonIdentifier
from app.core.transactions import transact
from app.shared.folding import sign_in_identifier

# Its one write is the address change, which crosses every record the address holds.
router = APIRouter(
    prefix="/account",
    dependencies=PERSON_TIER,
)


@router.get("/einwilligungen", summary="A signed-in person's own consent records")
async def get_einwilligungen(
    identifier: PersonIdentifier,
    records: SubjectLookup,
    today: GermanDay,
) -> FLAccountEinwilligungenResponse:
    """Every confirmed consent record the signed-in address holds, pending applications and registrations as withdraw-only.

    An address holding nothing is answered empty, never refused, and retired and past records are served too, so a
    withdrawal stays open wherever a consent stands.
    """

    # One read per kind of own record, each joined to what it names and sent at once, so the page waits one round trip.
    # No snapshot: each press is judged against the `evidence_state` its entry served, so an entry read a moment apart
    # from the others refuses a stale press rather than writing it.
    pupils, referees, seat_rows, bewerbung_rows, registrierung_rows = await concurrently(
        aggregate_many_from_db(collection=records.spieler_collection, pipeline=build_account_pupil_pipeline(identifier)),
        aggregate_many_from_db(collection=records.schiedsrichter_collection, pipeline=build_account_referee_pipeline(identifier)),
        aggregate_many_from_db(collection=records.saison_teams_collection, pipeline=build_self_seat_pipeline(identifier)),
        aggregate_many_from_db(collection=records.bewerbungen_collection, pipeline=build_self_bewerbung_pipeline(identifier)),
        aggregate_many_from_db(collection=records.registrierungen_collection, pipeline=build_self_registrierung_pipeline(identifier)),
    )

    # From the rows read above, which the subject's own selections choose: a second read would answer the same.
    subject = roles_from(identifier, seat_rows=seat_rows, referee_rows=referees, pupil_rows=pupils)
    teams = {team["_id"]: team for row in registrierung_rows for team in row["teams"]}

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
            "bewerbungen": compose_bewerbung_seats_self(bewerbung_rows, identifier),
            "registrierungen": compose_registrierungen_self(registrierung_rows, identifier, teams=teams),
        }
    )


def _open_change(record: Mapping[str, Any], *, now: datetime) -> FLAccountAddressChangeOpen:
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


@router.get("/address_change", summary="The address change pending on a signed-in person")
async def get_address_change(
    identifier: PersonIdentifier,
    address_changes_collection: AddressChangeReadCollection,
    germany_now: GermanyNow,
) -> FLAccountAddressChangeResponse:
    """The change pending on the signed-in address, null where none is.

    The pending address is served whole only where the person typed it, and masked where an administrator started the change.
    """

    record = await address_changes_collection.find_one(build_address_filter(identifier))

    return FLAccountAddressChangeResponse(open=None if record is None else _open_change(record, now=germany_now))


@router.post(
    "/address_change",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Start a change of the signed-in person's address",
    openapi_extra=SAFE_WHEN,
)
async def post_address_change(
    identifier: PersonIdentifier,
    address_change_data: FLAccountAddressChangePayload,
    records: SubjectLookup,
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    germany_now: GermanyNow,
    dry_run: DryRun = False,
) -> None:
    """Start a change of the address the person signs in on: the address on file is mailed a link, and its confirmation mails the new one.

    Everything the address holds moves once the new address confirms, after a wait where it holds a grant; declining
    either link ends the change, and a live change of the address is replaced. A `dry_run` is refused as the start would
    be, and writes nothing where it would land.
    """

    email = address_change_data.email

    async def judge(session: AsyncClientSession) -> Holdings:
        # Every refusal of the start, in its transaction or the dry run's snapshot alike. First: a press repeated inside
        # the interval asks nothing of the records.
        live = await address_changes_collection.find_one(build_address_filter(identifier), {"valid_until": 1}, session=session)
        refuse(find_restart_refusal(live_valid_until=None if live is None else live["valid_until"], now=germany_now))
        holdings = await read_the_holdings(identifier, records=records, grants_collection=grants_collection, session=session)
        refuse(find_nothing_refusal(empty=holdings.empty))
        # What the new address holds, another pupil or a grant, is never judged, so the start answers alike whatever it holds.
        refuse_faults(find_unchanged_refusal(address=identifier, folded=sign_in_identifier(email)))
        return holdings

    if dry_run:
        # Opened here as `get_snapshot_session` opens one, not declared: the person's tier opens no snapshot, and the dry
        # run alone reads outside a transaction.
        async with db.start_session(snapshot=True) as session:
            await judge(session)
        return

    async def start_the_change(session: AsyncClientSession) -> None:
        holdings = await judge(session)

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

    await transact(db, start_the_change)


@router.delete(
    "/address_change",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Stop the address change pending on the signed-in person",
)
async def delete_address_change(
    identifier: PersonIdentifier,
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    germany_now: GermanyNow,
) -> None:
    """Stop the change pending on the signed-in address at any step, its new address going; a holder's change in its wait tells every holder."""

    # Asks no fresh confirmation: a stop hands nothing over.
    async def stop_the_change(session: AsyncClientSession) -> None:
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

    await transact(db, stop_the_change)
