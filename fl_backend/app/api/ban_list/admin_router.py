from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.results import InsertOneResult

from app.api.address_change.services import build_incoming_filter
from app.api.ban_list.crud import read_ban_list
from app.api.ban_list.schemas import (
    FLBanListResponse,
    FLBanListRow,
    FLBanListWriteResponse,
    FLPostBanListEntryPayload,
    FLPostBanListEntryResponse,
)
from app.api.ban_list.services import compose_barred_until_saison_id, find_admin_refusal, find_no_saison_refusal
from app.api.grants.crud import pull_the_list_to_judge
from app.api.grants.guard import verify_actor_is_admin
from app.api.outbox.schemas import FLBanData
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.saisons.crud import pull_governing_saison_id
from app.core.config import API_VERSION
from app.core.crud import anchor_in_db, delete_many_from_db, post_one_to_db, pull_one_from_db, refuse
from app.core.dependencies import (
    AddressChangeReadCollection,
    BanListCollection,
    DBClient,
    GrantsCollection,
    OutboxCollection,
    SaisonsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import record_act
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_email, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/ban_list",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


async def _pull_the_season_a_ban_counts_from(
    *,
    saisons_collection: AsyncCollection,
    # REQUIRED: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> str:
    """The season a ban's `BAN_DURATION_SAISONS` are counted from, refused `ban_list_no_saison` while no season is running."""

    # Through the session: the rollover moves the season and sweeps the lapsed bans in one
    # transaction, and a season read outside this snapshot counts a ban one season short against
    # a list already swept.
    running_saison_id = await pull_governing_saison_id(saisons_collection=saisons_collection, session=session)
    refuse(find_no_saison_refusal(running_saison_id=running_saison_id))

    # The rollover demotes this season, and its sweep cannot see a row inserted after its snapshot:
    # without this write both commit, and a bound the sweep never judged stands past its season.
    await anchor_in_db(
        collection=saisons_collection,
        db_filter={"_id": running_saison_id},
        session=session,
    )

    # `str` past the refusal: the composer refuses the spelling `None` would take rather than
    # storing a bound off it.
    return str(running_saison_id)


@router.get("", response_model=FLBanListResponse, summary="List the banned addresses")
async def get_ban_list_entries(ban_list_collection: BanListCollection) -> FLBanListResponse:
    """
    List every ban, newest first: the address, why, on which day and the last season covered.

    Read whole: the list holds few rows, and a ban left out is one nobody can lift.
    """

    rows = await read_ban_list(ban_list_collection=ban_list_collection)

    return FLBanListResponse(ban_list=[FLBanListRow.model_validate(row) for row in rows])


@router.post(
    "",
    response_model=FLPostBanListEntryResponse,
    status_code=201,
    summary="Ban an email address",
)
async def post_ban_list_entry(
    ban_list_data: Annotated[FLPostBanListEntryPayload, Body()],
    ban_list_collection: BanListCollection,
    saisons_collection: SaisonsCollection,
    grants_collection: GrantsCollection,
    address_changes_collection: AddressChangeReadCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    created_by: str = Depends(get_actor_email),
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLPostBanListEntryResponse:
    """
    Ban an address: it cannot sign in and no mail leaves for it, the ban's own notice alone excepted.

    Refused where the list already holds the address (`duplicate_key`, `uniq_ban_list_address` answering), while no season
    is running, there being nothing to count the ban's five seasons from (`ban_list_no_saison`), and where the address has
    a row in `grants`, in effect or waiting, or a holder's live change moves to it (`ban_list_admin`). The ban covers the
    fifth season after the one running now, the last one it covers answered as `barred_until_saison_id`, and it survives
    that person's erasure. Where `notify` is set the ban's own notice is owed to the address in the same transaction.

    `ban_reason` is served, mailed to the address and kept past that person's erasure.
    """

    address = str(ban_list_data.email)

    async def judge_and_ban(session: AsyncClientSession) -> tuple[InsertOneResult, str]:
        """Ask the grants, read the season, then write. Each takes this transaction's session, so a retry re-runs all three."""

        # Through the grants' anchor: a grant of this address committing beside this ban writes the
        # same rows, so one of the two retries and meets the other's refusal.
        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        holders = [sign_in_identifier(str(grant["address"])) for grant in grants]
        incoming = await address_changes_collection.find_one(
            build_incoming_filter(email=address, holders=holders), projection={"_id": 1}, session=session
        )
        refuse(find_admin_refusal(address=address, administrators=holders, incoming=incoming is not None))

        running_saison_id = await _pull_the_season_a_ban_counts_from(saisons_collection=saisons_collection, session=session)
        barred_until_saison_id = compose_barred_until_saison_id(running_saison_id=running_saison_id)

        document: dict[str, Any] = {
            "address": address,
            "ban_reason": ban_list_data.ban_reason,
            "created_by": created_by,
            "created_at": today,
            # INCLUSIVE: the season named here is still barred, and „bis“ alone does not say so.
            "barred_until_saison_id": barred_until_saison_id,
        }

        created = await post_one_to_db(collection=ban_list_collection, document=document, session=session)
        # No label: the log holds no person's address.
        await record_act(collection=ban_list_collection, action="ban.added", record_id=created.inserted_id, session=session)
        if ban_list_data.notify:
            await enqueue_mails(
                outbox_collection=outbox_collection,
                session=session,
                mails=[
                    OwedMail(
                        key=f"ban/{created.inserted_id}",
                        to=address,
                        data=FLBanData(kind="ban", ban_reason=ban_list_data.ban_reason, barred_until_saison_id=barred_until_saison_id),
                    )
                ],
                now=now,
            )

        return created, barred_until_saison_id

    async with transaction_session(db) as session:
        post_operation, barred_until_saison_id = await session.with_transaction(judge_and_ban)

    return FLPostBanListEntryResponse(
        created_id=post_operation.inserted_id,
        barred_until_saison_id=barred_until_saison_id,
    )


@router.delete(
    by_id("ban_list_entry_id"),
    response_model=FLBanListWriteResponse,
    summary="Lift a ban",
)
async def delete_ban_list_entry(
    ban_list_entry_id: CustomRouteObjectId,
    ban_list_collection: BanListCollection,
    db: DBClient,
) -> FLBanListWriteResponse:
    """Lift a ban before it lapses, removing the row. HARD, and no copy of it stays. 404 where no row holds the id."""

    async def lift_the_ban(session: AsyncClientSession) -> None:
        """Resolve the row, then remove it. Both in-session, so a retry re-resolves it."""

        # Resolved first so a miss is a 404: a removal taking no row is an ordinary empty result and would answer 200.
        await pull_one_from_db(collection=ban_list_collection, db_filter={"_id": ban_list_entry_id}, projection=["_id"], session=session)

        await delete_many_from_db(collection=ban_list_collection, db_filter={"_id": ban_list_entry_id}, session=session)
        await record_act(collection=ban_list_collection, action="ban.removed", record_id=ban_list_entry_id, session=session)

    async with transaction_session(db) as session:
        await session.with_transaction(lift_the_ban)

    return FLBanListWriteResponse(ban_list_entry_id=ban_list_entry_id)
