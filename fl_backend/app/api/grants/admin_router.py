from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.address_change.crud import end_the_change_in_session
from app.api.address_change.services import build_address_filter
from app.api.ban_list.crud import address_is_barred
from app.api.grants.crud import (
    grant_in_session,
    pull_the_list_to_judge,
    read_grants,
    revoke_in_session,
    start_the_handover_in_session,
    stop_the_handover_in_session,
)
from app.api.grants.guard import verify_actor_is_admin
from app.api.grants.schemas import FLGrantRecord, FLGrantRow, FLGrantsListResponse, FLGrantWriteResponse, FLPostGrantPayload
from app.api.grants.services import (
    find_barred_refusal,
    find_exists_refusal,
    find_handover_refusal,
    find_only_owner_refusal,
    find_owner_row_refusal,
)
from app.core.config import API_VERSION
from app.core.crud import refuse
from app.core.dependencies import (
    AddressChangeCollection,
    BanListCollection,
    DBClient,
    GrantsCollection,
    GrantsReadCollection,
    OutboxCollection,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.routing import by_id
from app.core.security import bind_actor, get_actor_email, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/grants",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


@router.get("", response_model=FLGrantsListResponse, summary="List who may enter the administration")
async def get_grants(grants_collection: GrantsReadCollection) -> FLGrantsListResponse:
    """
    List every grant by address: its tier, when it holds, and when a handover to it completes.

    Uncapped, as few people hold one. A future `effective_from` is an addition still waiting, and `owner_from` a handover still waiting.
    """

    rows = [FLGrantRecord.model_validate(row) for row in await read_grants(grants_collection=grants_collection)]

    return FLGrantsListResponse(
        grants=[
            FLGrantRow(
                id=row.id,
                address=row.address,
                admin_tier=row.admin_tier,
                effective_from=row.effective_from,
                owner_from=row.owner_from,
            )
            for row in rows
        ]
    )


@router.post("", response_model=FLGrantWriteResponse, status_code=201, summary="Add an administrator")
async def post_grant(
    payload: Annotated[FLPostGrantPayload, Body()],
    grants_collection: GrantsCollection,
    ban_list_collection: BanListCollection,
    address_changes_collection: AddressChangeCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    granted_by: str = Depends(get_actor_email),
    now: datetime = Depends(get_germany_now),
) -> FLGrantWriteResponse:
    """
    Add an address as `administration`, holding once `GRANT_WAIT_HOURS` have passed. No request grants `owner`.

    Only the owner adds (`grant_only_owner`). The address is stored folded to its sign-in identifier, the spelling every admin-tier
    request is judged by. Refused where a grant already holds the address, a waiting one included (`grant_exists`), and where the ban
    list holds it (`grant_barred`). Any live address change at that address ends here: left standing, its switch could carry a grant
    to an address nobody named. Every holder in effect and the person named are told in the same transaction, and told what date
    it holds from.
    """

    address = sign_in_identifier(str(payload.email))

    async def judge_and_grant(session: AsyncClientSession) -> FLGrantWriteResponse:
        """Anchor and read the list, judge the actor and the address, end a change standing at it, then write the row, owing its notice."""

        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        refuse(find_only_owner_refusal(actor=granted_by, grants=grants))
        refuse(find_exists_refusal(address=address, grants=grants))
        refuse(find_barred_refusal(barred=await address_is_barred(ban_list_collection=ban_list_collection, address=address, session=session)))

        live = await address_changes_collection.find_one(build_address_filter(address), {"_id": 1}, session=session)
        if live is not None:
            await end_the_change_in_session(
                address_changes_collection=address_changes_collection,
                db_filter={"_id": live["_id"]},
                kind="discarded",
                now=now,
                session=session,
            )

        grant_id = await grant_in_session(
            address=address,
            granted_by=granted_by,
            grants_collection=grants_collection,
            address_changes_collection=address_changes_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )

        return FLGrantWriteResponse(grant_id=grant_id)

    async with transaction_session(db) as session:
        return await session.with_transaction(judge_and_grant)


@router.delete(by_id("grant_id"), response_model=FLGrantWriteResponse, summary="Remove an administrator, or withdraw a waiting addition")
async def delete_grant(
    grant_id: CustomRouteObjectId,
    grants_collection: GrantsCollection,
    address_changes_collection: AddressChangeCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    revoked_by: str = Depends(get_actor_email),
    now: datetime = Depends(get_germany_now),
) -> FLGrantWriteResponse:
    """
    Remove one grant at once, HARD, no soft form: the removed address meets `actor_not_admin` on its next request.

    Only the owner removes (`grant_only_owner`), judged before anything about the target is answered. 404 where no grant has the id.
    Refused for the `owner` row (`grant_owner`), which leaves only by a handover. A row still waiting is withdrawn by the same press,
    and a handover waiting on the row ends with it, told apart. Every holder in effect and the person named are told in the same
    transaction, but for an address a lost-mailbox change stands on. An address change standing on the row is left to run, as a
    change of an address holding no grant.
    """

    async def judge_and_revoke(session: AsyncClientSession) -> None:
        """Anchor and read the list, judge the actor and the row against it, then remove the row, owing its notice."""

        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        refuse(find_only_owner_refusal(actor=revoked_by, grants=grants))

        grant = next((row for row in grants if row["_id"] == grant_id), None)
        if grant is None:
            # Resolved from the list already read rather than a second query, so a miss is a 404 before
            # anything is removed: `delete_many_from_db` taking no row would answer 200.
            raise DocumentNotFoundError()

        refuse(find_owner_row_refusal(grant=grant))
        await revoke_in_session(
            grant=grant,
            grants_collection=grants_collection,
            address_changes_collection=address_changes_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(judge_and_revoke)

    return FLGrantWriteResponse(grant_id=grant_id)


@router.post(f"{by_id('grant_id')}/handover", response_model=FLGrantWriteResponse, summary="Hand the owner role over to an administrator")
async def post_handover(
    grant_id: CustomRouteObjectId,
    grants_collection: GrantsCollection,
    ban_list_collection: BanListCollection,
    address_changes_collection: AddressChangeCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    started_by: str = Depends(get_actor_email),
    now: datetime = Depends(get_germany_now),
) -> FLGrantWriteResponse:
    """
    Start handing the owner role to a current administrator, completed by the hourly pass once `OWNER_WAIT_DAYS` have passed.

    Only the owner starts one (`grant_only_owner`), and the owner stays the owner until it completes. 404 where no grant has the id.
    Refused for the owner's own row (`grant_owner`), while any handover waits (`grant_handover_waiting`), for a row whose own wait
    still runs (`grant_not_in_effect`), and where the ban list holds the address (`grant_barred`). Every holder in effect is told in
    the same transaction, and told what date it completes on.
    """

    async def judge_and_start(session: AsyncClientSession) -> None:
        """Anchor and read the list, judge the actor and the row against it, then date the handover, owing its notice."""

        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        refuse(find_only_owner_refusal(actor=started_by, grants=grants))

        grant = next((row for row in grants if row["_id"] == grant_id), None)
        if grant is None:
            raise DocumentNotFoundError()

        refuse(find_owner_row_refusal(grant=grant))
        refuse(find_handover_refusal(grant=grant, grants=grants, now=now))
        refuse(
            find_barred_refusal(
                barred=await address_is_barred(ban_list_collection=ban_list_collection, address=str(grant["address"]), session=session)
            )
        )
        await start_the_handover_in_session(
            grant,
            grants_collection=grants_collection,
            address_changes_collection=address_changes_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(judge_and_start)

    return FLGrantWriteResponse(grant_id=grant_id)


@router.delete(f"{by_id('grant_id')}/handover", response_model=FLGrantWriteResponse, summary="Stop a waiting handover")
async def delete_handover(
    grant_id: CustomRouteObjectId,
    grants_collection: GrantsCollection,
    address_changes_collection: AddressChangeCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    stopped_by: str = Depends(get_actor_email),
    now: datetime = Depends(get_germany_now),
) -> FLGrantWriteResponse:
    """
    Stop a waiting handover, the role staying with the owner.

    Only the owner stops one (`grant_only_owner`), which a press landing after the pass no longer is. 404 where the row waits on
    no handover. Every holder in effect is told in the same transaction.
    """

    async def judge_and_stop(session: AsyncClientSession) -> None:
        """Anchor and read the list, judge the actor and the row against it, then take the date off, owing its notice."""

        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        refuse(find_only_owner_refusal(actor=stopped_by, grants=grants))

        grant = next((row for row in grants if row["_id"] == grant_id and row.get("owner_from") is not None), None)
        if grant is None:
            raise DocumentNotFoundError()

        await stop_the_handover_in_session(
            grant,
            grants_collection=grants_collection,
            address_changes_collection=address_changes_collection,
            outbox_collection=outbox_collection,
            now=now,
            session=session,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(judge_and_stop)

    return FLGrantWriteResponse(grant_id=grant_id)
