from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import APIRouter, Response, status
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.results import InsertOneResult

from app.api.address_change.services import build_incoming_filter
from app.api.ban_list.crud import find_address_barred_refusal, read_ban_list
from app.api.ban_list.schemas import FLBanListResponse, FLBanListRow, FLPostBanListEntryPayload
from app.api.ban_list.services import compose_barred_until_saison_id, find_admin_refusal, find_no_saison_refusal
from app.api.grants.crud import pull_the_list_to_judge, read_grants
from app.api.grants.guard import ADMIN_TIER
from app.api.outbox.schemas import FLBanData
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.saisons.crud import pull_governing_saison_id
from app.core.crud import anchor_in_db, delete_many_from_db, post_one_to_db, pull_one_from_db, refuse, refuse_faults
from app.core.dependencies import (
    AddressChangeReadCollection,
    BanListCollection,
    BanListReadCollection,
    DBClient,
    GermanDay,
    GermanyNow,
    GrantsCollection,
    OutboxCollection,
    SaisonsCollection,
    SnapshotSession,
)
from app.core.recording import record_act
from app.core.routing import DRY_RUN_PASSED, SAFE_WHEN, DryRun, by_id, dry_run_passed
from app.core.transactions import transact
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import FLCreatedResponse

router = APIRouter(
    prefix="/ban_list",
    dependencies=ADMIN_TIER,
)


@router.get("", summary="List the banned addresses")
async def get_ban_list_entries(ban_list_collection: BanListReadCollection) -> FLBanListResponse:
    """Every ban, newest first, with the address, why, on which day and the last season it covers."""

    rows = await read_ban_list(ban_list_collection=ban_list_collection)

    return FLBanListResponse(ban_list=[FLBanListRow.model_validate(row) for row in rows])


@router.post(
    "",
    status_code=201,
    summary="Ban an email address",
    response_model=FLCreatedResponse,
    openapi_extra=SAFE_WHEN,
    responses=DRY_RUN_PASSED,
)
async def post_ban_list_entry(
    ban_list_data: FLPostBanListEntryPayload,
    ban_list_collection: BanListCollection,
    saisons_collection: SaisonsCollection,
    grants_collection: GrantsCollection,
    address_changes_collection: AddressChangeReadCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    session: SnapshotSession,
    today: GermanDay,
    germany_now: GermanyNow,
    dry_run: DryRun = False,
) -> FLCreatedResponse | Response:
    """Ban an address: it cannot sign in, and no mail leaves for it but the ban's own notice, sent where `notify` is set.

    The ban runs a fixed number of seasons past the running one, and it and its reason outlive the person's erasure. A
    `dry_run` is refused as the ban would be, and answers 204 and writes nothing where it would land.
    """

    address = str(ban_list_data.email)

    async def judge(grants: Sequence[Mapping[str, Any]], session: AsyncClientSession) -> str:
        # Every refusal of the ban, in the write's transaction or the dry run's snapshot alike, and the season it counts from.
        # Through the session: the rollover moves the season and sweeps the lapsed bans in one
        # transaction, and a season read outside this snapshot counts a ban one season short against
        # a list already swept.
        running_saison_id = await pull_governing_saison_id(saisons_collection=saisons_collection, session=session)
        refuse(find_no_saison_refusal(running_saison_id=running_saison_id))

        holders = [sign_in_identifier(str(grant["address"])) for grant in grants]
        incoming = await address_changes_collection.find_one(
            build_incoming_filter(email=address, holders=holders), projection={"_id": 1}, session=session
        )
        refuse_faults(
            find_admin_refusal(address=address, administrators=holders, incoming=incoming is not None),
            # Read as well as indexed: a dry run inserts nothing for `uniq_ban_list_address` to refuse, and the index
            # still refuses the second of two bans racing past this read.
            await find_address_barred_refusal(ban_list_collection=ban_list_collection, address=address, path=("email",), session=session),
        )

        # `str` past the refusal: the composer refuses the spelling `None` would take rather than
        # storing a bound off it.
        return str(running_saison_id)

    if dry_run:
        await judge(await read_grants(grants_collection=grants_collection, session=session), session)
        return dry_run_passed()

    async def judge_and_ban(session: AsyncClientSession) -> InsertOneResult:
        # Through the grants' anchor: a grant of this address committing beside this ban writes the
        # same rows, so one of the two retries and meets the other's refusal.
        running_saison_id = await judge(await pull_the_list_to_judge(grants_collection=grants_collection, session=session), session)
        # The rollover demotes this season, and its sweep cannot see a row inserted after its snapshot:
        # without this write both commit, and a bound the sweep never judged stands past its season.
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": running_saison_id}, session=session)
        barred_until_saison_id = compose_barred_until_saison_id(running_saison_id=running_saison_id)

        document: dict[str, Any] = {
            "address": address,
            "ban_reason": ban_list_data.ban_reason,
            "created_at": today,
            # Inclusive: the season named here is still barred, and „bis“ alone does not say so.
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
                now=germany_now,
            )

        return created

    post_operation = await transact(db, judge_and_ban)

    return FLCreatedResponse(created_id=post_operation.inserted_id)


@router.delete(
    by_id("ban_list_entry_id"),
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Lift a ban",
)
async def delete_ban_list_entry(
    ban_list_entry_id: CustomObjectId,
    ban_list_collection: BanListCollection,
    db: DBClient,
) -> None:
    """Lift a ban before it lapses, deleting its row for good."""

    async def lift_the_ban(session: AsyncClientSession) -> None:
        # Resolved first so a miss is a 404: a removal taking no row is an ordinary empty result and would answer 204.
        await pull_one_from_db(collection=ban_list_collection, db_filter={"_id": ban_list_entry_id}, projection=["_id"], session=session)

        await delete_many_from_db(collection=ban_list_collection, db_filter={"_id": ban_list_entry_id}, session=session)
        await record_act(collection=ban_list_collection, action="ban.removed", record_id=ban_list_entry_id, session=session)

    await transact(db, lift_the_ban)
