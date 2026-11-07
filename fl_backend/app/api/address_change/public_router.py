from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.address_change.crud import (
    Occupancy,
    end_the_change_in_session,
    judge_the_effect_in_session,
    live_grant_of,
    move_the_address_in_session,
    owe_the_link_in_session,
    read_the_holdings,
    refusal_of,
    tell_the_holders_in_session,
    tell_the_holders_of_the_end_in_session,
)
from app.api.address_change.schemas import (
    FLAddressChangeAnswer,
    FLAddressChangeAnswerPayload,
    FLAddressChangeAnswerResponse,
    FLAddressChangeStopResponse,
    FLAddressChangeViewEnded,
    FLAddressChangeViewNew,
    FLAddressChangeViewPrevious,
    FLAddressChangeViewResponse,
)
from app.api.address_change.services import (
    asks_the_address_on_file,
    build_either_link_filter,
    build_open_link_terms,
    build_previous_link_terms,
    compose_confirmation_update,
    compose_link_update,
    find_ended_refusal,
    find_expired_refusal,
    find_nothing_refusal,
    find_unknown_refusal,
    is_expired,
    new_state,
    previous_state,
    side_of,
    stored_instant,
    wait_after_confirmation,
)
from app.api.identity.lookup import SubjectLookup
from app.core.clock import german_day
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    AddressChangeReadCollection,
    BanListCollection,
    BewerbungenCollection,
    DBClient,
    GrantsCollection,
    GrantsReadCollection,
    InvitationsCollection,
    OutboxCollection,
    RegistrierungenCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielbestaetigungenCollection,
    SpielerCollection,
    SpielerReadCollection,
    get_germany_now,
)
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.routing import SAFE
from app.core.security import verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token

# The token is the whole credential, so these endpoints are base-tier.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/address_change/confirmation",
    dependencies=[Depends(verify_access_base)],
)

# What a link's view reads: never `change_reason`, the addresses for the judgement alone, and the new link's hashes, which say
# which of the two links a token is.
_FIELDS: Mapping[str, int] = {
    "address": 1,
    "email": 1,
    "way": 1,
    "released_at": 1,
    "valid_until": 1,
    "confirmed_at": 1,
    "effective_from": 1,
    "ended": 1,
    "token_hashes": 1,
}

# Causes the press refuses for the replaced address's sake, which the view reads alike as unconfirmable.
_NOT_CONFIRMABLE = frozenset({"taken", "new_granted", "occupied"})


@router.post(
    "/view",
    response_model=FLAddressChangeViewResponse,
    summary="What one address link opens",
    openapi_extra=SAFE,
)
async def get_address_change_view(
    view_data: Annotated[FLTokenPayload, Body()],
    address_changes_collection: AddressChangeReadCollection,
    records: SubjectLookup,
    spieler_collection: SpielerReadCollection,
    grants_collection: GrantsReadCollection,
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeViewResponse:
    """
    Answer what this token opens: the new mailbox's link, the link the address on file was mailed, or how either's change ended.

    **Nothing else about the change**: never a name or the id, and the new address only on the two questions, the new
    mailbox's `valid` link and the address on file's `release_open` link of the person's own change. A POST that reads,
    so the token travels in a body and never in a second URL. Refuses only a token no change holds (`link_invalid`); an ended change's
    links answer `ended`, how it ended and on which day, for as long as its record is kept.

    The new mailbox's side is served in a state: once pressed, `confirmed`; else `expired`, then `not_confirmable` wherever
    the press would be refused for the address on file's sake or would
    find it holding nothing to move, each a state the confirmation is refused in. Those read alike here, though the press
    answers each by its own code; what keeps the link's holder from telling them apart is the edge, where
    the proxy routes no public call to this service. The address on file's side answers the step the change waits on
    and until when, `release_open` while the person's own change waits on this link's confirmation and `release_expired` once that lapsed,
    never whether the new mailbox could confirm, and the day it confirmed once it has.
    """

    token_hash = hash_token(view_data.token)
    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    record = await address_changes_collection.find_one(build_either_link_filter(token_hash), projection=dict(_FIELDS))
    refuse(find_unknown_refusal(found=record is not None))
    assert record is not None
    side = side_of(record, token_hash)

    ended = record.get("ended")
    if isinstance(ended, Mapping):
        # Marked UTC first: the driver reads the stored instant back with no offset, which a conversion would take as local.
        ended_at = stored_instant(ended["at"])
        assert ended_at is not None
        released_at = stored_instant(record.get("released_at")) if side == "previous" else None
        return FLAddressChangeViewResponse(
            view=FLAddressChangeViewEnded(
                side=side,
                state="ended",
                kind=ended["kind"],
                ended_on=german_day(ended_at),
                way=record["way"],
                released_on=None if released_at is None else german_day(released_at),
            )
        )

    valid_until, effective_from = stored_instant(record.get("valid_until")), stored_instant(record.get("effective_from"))
    if side == "previous":
        state_previous = previous_state(record, now=germany_now)
        released_at = stored_instant(record.get("released_at"))
        return FLAddressChangeViewResponse(
            view=FLAddressChangeViewPrevious(
                side="previous",
                state=state_previous,
                valid_until=valid_until,
                effective_from=effective_from,
                way=record["way"],
                # Only while the person's own change asks this link its question, never once that lapsed.
                email=str(record["email"]) if state_previous == "release_open" else None,
                released_on=None if released_at is None else german_day(released_at),
            )
        )

    not_confirmable = False
    if record.get("confirmed_at") is None:
        # Every judgement the press makes, read here too, so the page never offers a confirmation the press refuses.
        holdings = await read_the_holdings(str(record["address"]), records=records, grants_collection=grants_collection, session=None)
        verdict = await judge_the_effect_in_session(
            record=record,
            holdings=holdings,
            records=records,
            spieler_collection=spieler_collection,
            grants_collection=grants_collection,
            occupancy=Occupancy(grants_collection=grants_collection, address_changes_collection=address_changes_collection),
            expired=False,
            session=None,
        )
        # An address left holding nothing to move too: the press refuses `address_change_nothing`, and the link lapses.
        not_confirmable = verdict.cause in _NOT_CONFIRMABLE or verdict.empty

    state = new_state(record, now=germany_now, not_confirmable=not_confirmable)

    return FLAddressChangeViewResponse(
        view=FLAddressChangeViewNew(
            side="new",
            state=state,
            valid_until=valid_until,
            effective_from=effective_from,
            way=record["way"],
            email=str(record["email"]) if state == "valid" else None,
        )
    )


@router.post(
    "",
    response_model=FLAddressChangeAnswerResponse,
    summary="Confirm or decline a pending address",
    # `uniq_spieler_email` and `uniq_grant_address` are published by the duplicate-key trace and stay unreached: the
    # in-session reads of another pupil and of the new address's grant include every row either index holds.
)
async def post_address_change_answer(
    answer_data: Annotated[FLAddressChangeAnswerPayload, Body()],
    address_changes_collection: AddressChangeCollection,
    records: SubjectLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    invitations_collection: InvitationsCollection,
    ban_list_collection: BanListCollection,
    action_log_collection: ActionLogCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeAnswerResponse:
    """
    Record whether the mailbox this link was sent to is the person's: `confirmed` confirms it, `declined` ends the change.

    **The person's own change asks the address on file first**: its link's confirmation owes the new mailbox its link,
    and nothing moves yet, answering `confirmed` with `effective` false and `effective_from` null; refused `link_expired`
    past that link's deadline and `address_change_ended` once answered or ended, a decline refused only the latter, and a
    decline is the one way this link ends the change before it confirmed (`/stop` refuses it). Every other link the
    address on file was mailed answers no confirmation (`link_invalid`).

    The new mailbox's link: **a confirmation moves the person, not a record.** Unless the change waits -- on the lost-mailbox
    way, or because the address holds a grant -- it takes effect in this transaction: every pupil row, confirmed referee row,
    confirmed contact seat and registration the address on file holds moves to the new one, asking no consent and writing
    none, and `effective` says so; its completion notice is owed in this transaction, and so is its sign-in account's
    carry. A change that waits is confirmed alone, answering `effective_from`, the old address working until the hourly pass
    moves it; a holder's tells every holder in effect, in this transaction.
    Either answer spends the link, which keeps answering what became of the change.

    Refuses a token no change holds (`link_invalid`), a link already answered or a change ended
    (`address_change_ended`), and, in the order the link's view ranks its states, a CONFIRMATION past its deadline
    (`link_expired`), one moving a pupil onto an address another pupil signs in on (`address_change_taken`), one moving a
    grant onto an address holding one (`address_change_new_granted`), and one whose new address any entry names, confirmed
    or not (`address_change_occupied`): moving the person onto it would join two people's records. **A decline is refused
    none of these**: it removes an address nobody proved.

    A confirmation whose address has come to hold nothing to move is refused `address_change_nothing`, writing nothing, and
    the change lapses with its link. The codes past `link_expired` tell a caller what the view's `not_confirmable` keeps
    alike; only the edge keeps them from the link's holder.
    """

    token_hash = hash_token(answer_data.token)

    async def answer_the_link(session: AsyncClientSession) -> FLAddressChangeAnswerResponse:
        """Judge, then write, everything judged read in-session, so a second press is refused by the spent link rather than writing twice."""

        record = await address_changes_collection.find_one(build_either_link_filter(token_hash), session=session)
        refuse(find_unknown_refusal(found=record is not None))
        assert record is not None
        if side_of(record, token_hash) == "previous":
            return await _answer_for_the_address_on_file(
                record,
                answer=answer_data.answer,
                stop_hash=token_hash,
                address_changes_collection=address_changes_collection,
                grants_collection=grants_collection,
                outbox_collection=outbox_collection,
                germany_now=germany_now,
                session=session,
            )

        refuse(find_ended_refusal(is_open=record.get("ended") is None and record.get("confirmed_at") is None))
        db_filter = {"_id": record["_id"], **build_open_link_terms(token_hash)}

        if answer_data.answer == "declined":
            await end_the_change_in_session(
                address_changes_collection=address_changes_collection,
                db_filter=db_filter,
                kind="declined",
                now=germany_now,
                session=session,
            )
            return FLAddressChangeAnswerResponse(answer="declined", effective_from=None, effective=False)

        holdings = await read_the_holdings(str(record["address"]), records=records, grants_collection=grants_collection, session=session)
        verdict = await judge_the_effect_in_session(
            record=record,
            holdings=holdings,
            records=records,
            spieler_collection=spieler_collection,
            grants_collection=grants_collection,
            occupancy=Occupancy(grants_collection=grants_collection, address_changes_collection=address_changes_collection),
            expired=is_expired(record, now=germany_now),
            session=session,
        )
        refuse(refusal_of(verdict.cause))
        # Refused rather than ended, so this 409 keeps the promise of `app/core/codes.py`: the hourly pass ends the change as its link lapses.
        refuse(find_nothing_refusal(empty=verdict.empty))

        wait = wait_after_confirmation(way=record["way"], admin_tier=holdings.admin_tier)
        if wait is None:
            await move_the_address_in_session(
                record=record,
                holdings=holdings,
                address_changes_collection=address_changes_collection,
                spieler_collection=spieler_collection,
                schiedsrichter_collection=schiedsrichter_collection,
                saison_teams_collection=saison_teams_collection,
                bewerbungen_collection=bewerbungen_collection,
                registrierungen_collection=registrierungen_collection,
                spielbestaetigungen_collection=spielbestaetigungen_collection,
                grants_collection=grants_collection,
                outbox_collection=outbox_collection,
                invitations_collection=invitations_collection,
                ban_list_collection=ban_list_collection,
                action_log_collection=action_log_collection,
                now=germany_now,
                session=session,
            )
            return FLAddressChangeAnswerResponse(answer="confirmed", effective_from=None, effective=True)

        confirmed: Mapping[str, Any] = await patch_one_in_db(
            collection=address_changes_collection,
            db_filter=db_filter,
            update=compose_confirmation_update(wait=wait, now=germany_now),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
        effective_from = stored_instant(confirmed["effective_from"])
        if holdings.grant is not None:
            await record_act(
                collection=address_changes_collection,
                action="grant.address_change_started",
                by=holdings.identifier if record["way"] == "account" else ACT_BY_SYSTEM,
                record_id=record["_id"],
                label=holdings.identifier,
                session=session,
            )
            await tell_the_holders_in_session(
                record,
                stage="started",
                # The person's own change is theirs; a lost-mailbox one's confirmation is nobody's the league knows.
                changed_by=holdings.identifier if record["way"] == "account" else None,
                effective_from=effective_from,
                grants_collection=grants_collection,
                outbox_collection=outbox_collection,
                now=germany_now,
                session=session,
            )

        return FLAddressChangeAnswerResponse(answer="confirmed", effective_from=effective_from, effective=False)

    async with transaction_session(db) as session:
        return await session.with_transaction(answer_the_link)


async def _answer_for_the_address_on_file(
    record: Mapping[str, Any],
    *,
    answer: FLAddressChangeAnswer,
    stop_hash: str,
    address_changes_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    germany_now: datetime,
    session: AsyncClientSession,
) -> FLAddressChangeAnswerResponse:
    """The address on file's answer to the person's own change, in the press's transaction: its confirmation owes the new mailbox its link."""

    # A link of another way's notice offers its stop alone, so it answers no confirmation.
    refuse(find_unknown_refusal(found=record["way"] == "account"))
    refuse(find_ended_refusal(is_open=record.get("ended") is None and record.get("released_at") is None))
    db_filter = {"_id": record["_id"], **build_previous_link_terms(stop_hash)}

    if answer == "declined":
        await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            db_filter=db_filter,
            kind="declined",
            now=germany_now,
            session=session,
        )
        return FLAddressChangeAnswerResponse(answer="declined", effective_from=None, effective=False)

    refuse(find_expired_refusal(expired=is_expired(record, now=germany_now)))
    released: Mapping[str, Any] = await patch_one_in_db(
        collection=address_changes_collection,
        db_filter=db_filter,
        update=compose_link_update(now=germany_now, released=True),
        session=session,
        expected_version=None,
        return_document=ReturnDocument.AFTER,
    )
    valid_until = stored_instant(released["valid_until"])
    assert valid_until is not None
    grant = await live_grant_of(str(released["address"]), grants_collection=grants_collection, session=session)
    await owe_the_link_in_session(
        address_change_id=released["_id"],
        email=str(released["email"]),
        way="account",
        valid_until=valid_until,
        holder=None if grant is None else grant["admin_tier"],
        outbox_collection=outbox_collection,
        now=germany_now,
        session=session,
    )

    return FLAddressChangeAnswerResponse(answer="confirmed", effective_from=None, effective=False)


@router.post(
    "/stop",
    response_model=FLAddressChangeStopResponse,
    summary="Stop a pending address change",
)
async def post_address_change_stop(
    stop_data: Annotated[FLTokenPayload, Body()],
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeStopResponse:
    """
    Stop the change the address on file was mailed about: its new address goes.

    **Refused nothing but a token no change holds, a change ended, and the person's own change before its address on
    file confirmed it**: a stop hands nothing over, so it answers past every deadline until the change ends. A token no
    change holds answers `link_invalid` and an ended change `address_change_ended`. The person's own change offers this
    link no stop until its address on file confirmed it, and answers `link_invalid` as the unknown token does, the page
    offering no stop then: the question's decline is the one way that link ends it before, so one act keeps one ending.
    From that confirmation on, the same link is the change's stop on every way. A holder's change in its wait tells
    every holder.
    """

    stop_hash = hash_token(stop_data.token)

    async def stop_the_change(session: AsyncClientSession) -> FLAddressChangeStopResponse:
        record = await address_changes_collection.find_one({"stop.token_hashes": stop_hash}, session=session)
        refuse(find_unknown_refusal(found=record is not None))
        assert record is not None
        refuse(find_ended_refusal(is_open=record.get("ended") is None))
        refuse(find_unknown_refusal(found=not asks_the_address_on_file(record)))

        await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            db_filter={"_id": record["_id"]},
            kind="stopped",
            now=germany_now,
            session=session,
        )
        await tell_the_holders_of_the_end_in_session(
            record,
            changed_by=str(record["address"]),
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

        return FLAddressChangeStopResponse(stopped=True)

    async with transaction_session(db) as session:
        return await session.with_transaction(stop_the_change)
