from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

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
    ending_line,
    owe_the_notice_in_session,
    read_the_holdings,
    start_the_change_in_session,
)
from app.api.address_change.schemas import FLAddressChangeApprovalState
from app.api.address_change.services import (
    as_utc,
    build_address_filter,
    compose_approval,
    compose_record,
    find_no_approver_refusal,
    find_nothing_refusal,
    find_unchanged_refusal,
    is_expired,
    masked_address,
    waits_on,
)
from app.api.berechtigungen.crud import read_berechtigungen, read_the_announced
from app.api.berechtigungen.services import approver_of
from app.api.identity.crud import roles_from
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import is_own_schiedsrichter, is_own_spieler, may_grant_on_schiedsrichter, may_grant_on_spieler
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS, KontaktIdentifier
from app.api.sperrliste.lookup import BanListLookup, barred_addresses
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, refuse
from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    DBClient,
    GrantsAnnouncedCollection,
    GrantsCollection,
    OutboxCollection,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.security import (
    verify_access_admin,
)
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier

# Every person binder fixes a Funktion and this page is none's: `kontakt` is bound, its seat control
# having no page of its own. Its one write is the address change, which crosses every record the address holds.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/account",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


@router.get("/einwilligungen", response_model=FLAccountEinwilligungenResponse, summary="A signed-in person's own consent records")
async def get_einwilligungen(
    identifier: KontaktIdentifier,
    spieler_collection: SpielerCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLAccountEinwilligungenResponse:
    """
    Answer every confirmed consent record the signed-in address holds, its pupil, referee and contact-seat records alike.

    The seats come one entry per team season on which the address holds a confirmed seat, however many of its slots;
    `bewerbungen` one per PENDING application on which it does, whose two choices the account page may only withdraw;
    `registrierungen` one per pending registration its pupil confirmed, withdraw-only alike until the admission; a
    returning pupil's asked no choice, so it serves its stored data with both choices null and offers nothing to press.

    PERSON TIER, for the account page, which every signed-in person reaches: an address holding nothing is answered
    `spieler: null` and four empty lists, never refused. A retired record, a past season's seat and a withdrawn team's
    seat are served too, a withdrawal staying open wherever a consent stands; `givable` says whether a grant is
    admitted, `media_offered` whether the media consent may be switched on. A record awaiting its person's
    confirmation is not served: there is nothing on it yet to change.
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
            "spieler": None
            if pupil is None
            else compose_spieler_account(pupil, givable=may_grant_on_spieler(subject, pupil["_id"]), today=today),
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


# --- The ADDRESS CHANGE the person starts, approves and stops for themselves. Recorded under `kontakt`, as the erasure
# is: the change crosses every Funktion the address holds.


def _open(record: Mapping[str, Any], *, now: datetime) -> FLAccountAddressChangeOpen:
    approval = record.get("approval")
    approval_state = None
    if isinstance(approval, Mapping):
        until = as_utc(approval.get("until"))
        assert until is not None
        approval_state = FLAddressChangeApprovalState(
            admin_tier=approval["admin_tier"], approved=approval.get("approved_at") is not None, until=until
        )

    return FLAccountAddressChangeOpen(
        id=record["_id"],
        # The address the person typed here is theirs to see; one an administrator typed is shown recognisable alone.
        email=record["email"] if record["way"] == "account" else masked_address(str(record["email"])),
        way=record["way"],
        waits_on=waits_on(record),
        valid_until=as_utc(record.get("valid_until")),
        effective_from=as_utc(record.get("effective_from")),
        approval=approval_state,
        expired=is_expired(record, now=now),
    )


async def _address_change_answer(
    identifier: str,
    *,
    address_changes_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession | None,
) -> FLAccountAddressChangeResponse:
    record = await address_changes_collection.find_one(build_address_filter(identifier), session=session)

    return FLAccountAddressChangeResponse(open=None if record is None else _open(record, now=now))


@router.get("/address_change", response_model=FLAccountAddressChangeResponse, summary="The address change pending on a signed-in person")
async def get_address_change(
    identifier: KontaktIdentifier,
    address_changes_collection: AddressChangeCollection,
    germany_now: datetime = Depends(get_germany_now),
) -> FLAccountAddressChangeResponse:
    """
    Answer the change pending on the signed-in address, null where none is.

    PERSON TIER. Whether the address holds anything a change moves is the start's to answer, refused
    `address_change_nothing`. **The pending address is served masked where an administrator started the change**, whole
    only where the person typed it here: a change an administrator started may be a pretext whose target the holder of
    the address on file must not learn. `waits_on` names the step, `previous_address` the link the person's own change
    mailed the address on file, which this page answers nothing of. `approval` is the approval a change moving the
    person's grant waits on;
    `expired` says the step the change waits on lapsed, whose press is refused until the hourly pass ends the change.
    """

    return await _address_change_answer(identifier, address_changes_collection=address_changes_collection, now=germany_now, session=None)


@router.post(
    "/address_change",
    response_model=FLAccountAddressChangeMintResponse,
    summary="Start a change of the signed-in person's address",
)
async def post_address_change(
    identifier: KontaktIdentifier,
    address_change_data: Annotated[FLAccountAddressChangePayload, Body()],
    records: SubjectLookup,
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    ban_list: BanListLookup,
    action_log_collection: ActionLogCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLAccountAddressChangeMintResponse:
    """
    Start a change of the address the person signs in on, its first mail owed in the same transaction and no link answered.

    **The address on file confirms first**: it is owed a link, and only its confirmation owes the new mailbox the
    second; **everything the address holds as its person's own moves when the new mailbox confirms**, each link within
    `ADDRESS_CHANGE_VALID_HOURS`, and declining either ends the change. Where it holds a grant, the change also waits on
    another administrator's approval, an owner's for an owner's grant. The address's live change ends replaced, an
    administrator's too: a sign-in at the address on file proves the mailbox is not lost.
    **Nothing about the new address is judged here** -- the ban list, another pupil, a grant it holds -- so this start
    answers alike whatever the new address holds.

    Refused `address_change_nothing` where the address holds nothing a change moves; `address_change_unchanged` where the
    typed address is the one signed in; and `address_change_no_approver` where nobody could approve the grant's move, the
    last owner making another first.
    """

    email = address_change_data.email
    journal = Journal()

    @journal.attempted
    async def start_the_change(session: AsyncClientSession) -> FLAccountAddressChangeMintResponse:
        holdings = await read_the_holdings(identifier, records=records, grants_collection=grants_collection, session=session)
        refuse(find_nothing_refusal(empty=holdings.empty))
        refuse(find_unchanged_refusal(address=identifier, folded=sign_in_identifier(email)))

        approval = None
        if holdings.grant is not None:
            grants = await read_berechtigungen(grants_collection=grants_collection, session=session)
            announced = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)
            barred = await barred_addresses(ban_list, [str(row["address"]) for row in grants], session=session)
            admin_tier = str(holdings.grant["admin_tier"])
            approver = approver_of(
                admin_tier=admin_tier, excepted={identifier}, grants=grants, announced=announced, barred=barred, before=germany_now
            )
            refuse(find_no_approver_refusal(approver=len(approver)))
            approval = compose_approval(admin_tier=admin_tier, started_by=identifier, now=germany_now)

        record = compose_record(
            address=identifier,
            email=email,
            way="account",
            grund=None,
            approval=approval,
            now=germany_now,
        )
        address_change_id = await start_the_change_in_session(
            record=record,
            address_changes_collection=address_changes_collection,
            action_log_collection=action_log_collection,
            key=config.sperrliste_key,
            now=germany_now,
            journal=journal,
            session=session,
        )
        # The address on file's link alone: the new mailbox is asked once the address on file confirmed.
        await owe_the_notice_in_session(
            address_change_id=address_change_id,
            address=identifier,
            way="account",
            valid_until=record["valid_until"],
            vorname=holdings.vorname,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

        return FLAccountAddressChangeMintResponse(id=address_change_id, valid_until=record["valid_until"], email=email)

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(start_the_change)


@router.delete(
    "/address_change",
    response_model=FLAccountAddressChangeResponse,
    summary="Stop the address change pending on the signed-in person",
)
async def delete_address_change(
    identifier: KontaktIdentifier,
    address_changes_collection: AddressChangeCollection,
    action_log_collection: ActionLogCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLAccountAddressChangeResponse:
    """
    Stop the change pending on the signed-in address at any step: its new address goes, out of every log image too.

    Its address on file's question unanswered too, which the link mailed there declines rather than stops. Asks no fresh
    confirmation and counts nothing: a stop hands nothing over. 404 where no change is pending on the address.
    """

    stamp = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def stop_the_change(session: AsyncClientSession) -> FLAccountAddressChangeResponse:
        live = await address_changes_collection.find_one(build_address_filter(identifier), {"_id": 1}, session=session)
        if live is None:
            raise DocumentNotFoundError()

        stored = await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            action_log_collection=action_log_collection,
            db_filter={"_id": live["_id"]},
            kind="stopped",
            now=germany_now,
            stamp=stamp,
            session=session,
        )
        journal.note(
            ending_line(
                kind="address_change_stopped",
                new_address=str(stored["email"]),
                record_id=stored["_id"],
                at=stamp,
                key=config.sperrliste_key,
            )
        )

        return await _address_change_answer(identifier, address_changes_collection=address_changes_collection, now=germany_now, session=session)

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(stop_the_change)
