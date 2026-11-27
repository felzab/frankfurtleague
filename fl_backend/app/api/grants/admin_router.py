from collections.abc import Mapping, Sequence
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status
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
from app.api.grants.guard import ADMIN_TIER
from app.api.grants.schemas import FLGrantRemovedResponse, FLGrantRow, FLGrantsListResponse, FLPostGrantPayload
from app.api.grants.services import (
    find_barred_refusal,
    find_exists_refusal,
    find_handover_refusal,
    find_only_owner_refusal,
    find_owner_row_refusal,
)
from app.core.crud import refuse, refuse_faults
from app.core.dependencies import (
    AddressChangeCollection,
    BanListCollection,
    DBClient,
    GermanyNow,
    GrantsCollection,
    GrantsReadCollection,
    OutboxCollection,
    SnapshotSession,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.routing import DRY_RUN_PASSED, SAFE_WHEN, DryRun, by_id, dry_run_passed
from app.core.security import ActorEmail, SessionActor, verify_admin_actor
from app.core.transactions import transact
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import FLCreatedResponse

router = APIRouter(
    prefix="/grants",
    dependencies=ADMIN_TIER,
)


@router.get("", summary="List who may enter the administration")
async def get_grants(grants_collection: GrantsReadCollection) -> FLGrantsListResponse:
    """Every grant by address: its tier, when it holds, and when a handover to it completes.

    A future `effective_from` is an addition still waiting, and `owner_from` a handover still waiting.
    """

    rows = await read_grants(grants_collection=grants_collection)

    return FLGrantsListResponse(grants=[FLGrantRow.model_validate(row) for row in rows])


@router.post(
    "",
    status_code=201,
    summary="Add an administrator",
    response_model=FLCreatedResponse,
    openapi_extra=SAFE_WHEN,
    responses=DRY_RUN_PASSED,
)
async def post_grant(
    payload: FLPostGrantPayload,
    grants_collection: GrantsCollection,
    ban_list_collection: BanListCollection,
    address_changes_collection: AddressChangeCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    session: SnapshotSession,
    operator: ActorEmail,
    signed_in: Annotated[SessionActor, Depends(verify_admin_actor)],
    germany_now: GermanyNow,
    dry_run: DryRun = False,
) -> FLCreatedResponse | Response:
    """Add an address as `administration`, holding once its wait has passed; only the owner adds one, and no request grants `owner`.

    Every holder in effect and the address named are told, with the date it holds from. A `dry_run` is refused as the
    addition would be, and answers 204 and writes nothing where it would land.
    """

    # The spelling every admin-tier request is judged by.
    address = sign_in_identifier(str(payload.email))

    async def judge(grants: Sequence[Mapping[str, Any]], session: AsyncClientSession) -> None:
        # Every refusal of the addition, in the write's transaction or the dry run's snapshot alike.
        refuse(find_only_owner_refusal(actor=operator, auth_time=signed_in.auth_time, grants=grants))
        refuse_faults(find_exists_refusal(address=address, grants=grants))
        refuse(find_barred_refusal(barred=await address_is_barred(ban_list_collection=ban_list_collection, address=address, session=session)))

    if dry_run:
        await judge(await read_grants(grants_collection=grants_collection, session=session), session)
        return dry_run_passed()

    async def judge_and_grant(session: AsyncClientSession) -> FLCreatedResponse:
        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        await judge(grants, session)

        # A live address change at that address ends here: left standing, its switch could carry a grant to an address
        # nobody named.
        live = await address_changes_collection.find_one(build_address_filter(address), {"_id": 1}, session=session)
        if live is not None:
            await end_the_change_in_session(
                address_changes_collection=address_changes_collection,
                db_filter={"_id": live["_id"]},
                kind="discarded",
                now=germany_now,
                session=session,
            )

        grant_id = await grant_in_session(
            address=address,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

        return FLCreatedResponse(created_id=grant_id)

    return await transact(db, judge_and_grant)


@router.delete(by_id("grant_id"), summary="Remove an administrator, or withdraw a waiting addition")
async def delete_grant(
    grant_id: CustomObjectId,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    operator: ActorEmail,
    signed_in: Annotated[SessionActor, Depends(verify_admin_actor)],
    germany_now: GermanyNow,
) -> FLGrantRemovedResponse:
    """Remove a grant for good, its address losing access on its next request, or withdraw an addition still waiting.

    Only the owner removes one, the owner's own row leaving only by a handover; every holder in effect and the address named are told.
    """

    async def judge_and_revoke(session: AsyncClientSession) -> FLGrantRemovedResponse:
        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        # Judged before anything about the target is answered.
        refuse(find_only_owner_refusal(actor=operator, auth_time=signed_in.auth_time, grants=grants))

        grant = next((row for row in grants if row["_id"] == grant_id), None)
        if grant is None:
            # Resolved from the list already read rather than a second query, so a miss is a 404 before
            # anything is removed: `delete_many_from_db` taking no row would answer as a removal.
            raise DocumentNotFoundError()

        refuse(find_owner_row_refusal(grant=grant))
        # An address change standing on the row is left to run, as a change of an address holding no grant.
        await revoke_in_session(
            grant=grant,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

        return FLGrantRemovedResponse(address=str(grant["address"]))

    return await transact(db, judge_and_revoke)


@router.post(
    f"{by_id('grant_id')}/handover",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Hand the owner role over to an administrator",
    openapi_extra=SAFE_WHEN,
)
async def post_handover(
    grant_id: CustomObjectId,
    grants_collection: GrantsCollection,
    ban_list_collection: BanListCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    session: SnapshotSession,
    operator: ActorEmail,
    signed_in: Annotated[SessionActor, Depends(verify_admin_actor)],
    germany_now: GermanyNow,
    dry_run: DryRun = False,
) -> None:
    """Start handing the owner role to an administrator in effect, completing once its wait has passed; the owner stays the owner until then.

    Only the owner starts one, and every holder in effect is told the date it completes on. A `dry_run` is refused as
    the handover would be, and writes nothing.
    """

    async def judge(grants: Sequence[Mapping[str, Any]], session: AsyncClientSession) -> Mapping[str, Any]:
        # Every refusal of the handover, in the write's transaction or the dry run's snapshot alike.
        refuse(find_only_owner_refusal(actor=operator, auth_time=signed_in.auth_time, grants=grants))

        grant = next((row for row in grants if row["_id"] == grant_id), None)
        if grant is None:
            raise DocumentNotFoundError()

        refuse(find_owner_row_refusal(grant=grant))
        refuse(find_handover_refusal(grant=grant, grants=grants, now=germany_now))
        refuse(
            find_barred_refusal(
                barred=await address_is_barred(ban_list_collection=ban_list_collection, address=str(grant["address"]), session=session)
            )
        )
        return grant

    if dry_run:
        await judge(await read_grants(grants_collection=grants_collection, session=session), session)
        return

    async def judge_and_start(session: AsyncClientSession) -> None:
        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        grant = await judge(grants, session)
        await start_the_handover_in_session(
            grant,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

    await transact(db, judge_and_start)


@router.delete(f"{by_id('grant_id')}/handover", status_code=status.HTTP_204_NO_CONTENT, summary="Stop a waiting handover")
async def delete_handover(
    grant_id: CustomObjectId,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    operator: ActorEmail,
    signed_in: Annotated[SessionActor, Depends(verify_admin_actor)],
    germany_now: GermanyNow,
) -> None:
    """Stop a waiting handover, the role staying with the owner; only the owner stops one, and every holder in effect is told."""

    async def judge_and_stop(session: AsyncClientSession) -> None:
        grants = await pull_the_list_to_judge(grants_collection=grants_collection, session=session)
        refuse(find_only_owner_refusal(actor=operator, auth_time=signed_in.auth_time, grants=grants))

        grant = next((row for row in grants if row["_id"] == grant_id and row.get("owner_from") is not None), None)
        if grant is None:
            raise DocumentNotFoundError()

        await stop_the_handover_in_session(
            grant,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

    await transact(db, judge_and_stop)
