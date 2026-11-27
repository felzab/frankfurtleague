from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter, Response, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.grants.guard import ADMIN_TIER
from app.api.outbox.crud import state_of
from app.api.outbox.schemas import FLOutboxReference
from app.api.schiedsrichter.crud import owe_the_confirmation
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLPatchSchiedsrichterResponse,
    FLPostSchiedsrichterPayload,
    FLPostSchiedsrichterResponse,
    FLSchiedsrichter,
    FLSchiedsrichterAdmin,
    FLSchiedsrichterAdminRow,
    FLSchiedsrichterListResponse,
    FLSchiedsrichterMint,
    FLSchiedsrichterReactivateResponse,
    FLSchiedsrichterSingleResponse,
)
from app.api.schiedsrichter.services import (
    ADMIN_ROW_FIELDS,
    EINWILLIGUNG_FIELD,
    INVITE_FIELDS,
    build_unplayed_assignment_filter,
    compose_admin,
    compose_correction_update,
    compose_entry,
    compose_mint_update,
    confirmation_deadline_from,
    find_already_answered_refusal,
    find_confirmed_address_refusal,
    find_missing_address_refusal,
    find_referee_name_refusal,
    find_referee_retire_refusal,
    find_retired_refusal,
    owes_reactivation_mint,
)
from app.core.collections import Collection
from app.core.crud import (
    GERMAN_COLLATION,
    VERSION_FIELD,
    find_stale_save_refusal,
    insert_live,
    is_held_elsewhere,
    patch_one_in_db,
    pull_one_from_db,
    pull_whole_from_db,
    refuse,
    refuse_faults,
    set_inactive_since,
)
from app.core.dependencies import (
    DBClient,
    GermanDay,
    GermanyNow,
    OutboxCollection,
    OutboxReadCollection,
    SchiedsrichterCollection,
    SchiedsrichterReadCollection,
    SnapshotSession,
    SpieleCollection,
)
from app.core.recording import record_act
from app.core.routing import DRY_RUN_PASSED, SAFE_WHEN, DryRun, by_id, dry_run_passed
from app.core.transactions import transact
from app.shared.schemas.custom import CustomObjectId

# Admin-guarded, not base: a referee is a pupil, so their contact details and school are admin-tier, as is the fee,
# which is money.
router = APIRouter(
    prefix="/schiedsrichter",
    dependencies=ADMIN_TIER,
)


@router.get("", summary="List Schiedsrichter")
async def get_schiedsrichter(
    schiedsrichter_collection: SchiedsrichterReadCollection,
    today: GermanDay,
) -> FLSchiedsrichterListResponse:
    """Every referee in name order, retired ones included, each with where their entry stands today.

    The list is the one way into a retired referee's page, and a played match still names them.
    """

    schiedsrichter_raw = await pull_whole_from_db(
        collection=schiedsrichter_collection,
        db_filter={},
        projection=dict(ADMIN_ROW_FIELDS),
        sort_by=[("name", 1)],
        collation=GERMAN_COLLATION,
    )

    return FLSchiedsrichterListResponse(
        schiedsrichter=[FLSchiedsrichterAdminRow.model_validate(compose_admin(row, today=today)) for row in schiedsrichter_raw]
    )


@router.get(
    by_id("schiedsrichter_id"),
    summary="One Schiedsrichter",
)
async def get_schiedsrichter_by_id(
    schiedsrichter_id: CustomObjectId,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    outbox_collection: OutboxReadCollection,
    today: GermanDay,
) -> FLSchiedsrichterSingleResponse:
    """One referee, a retired one included, with where their entry stands today and what became of their last confirmation mail.

    An erased referee's id answers 404.
    """

    schiedsrichter_raw = await pull_one_from_db(collection=schiedsrichter_collection, db_filter={"_id": schiedsrichter_id})

    return FLSchiedsrichterSingleResponse(
        schiedsrichter=FLSchiedsrichterAdmin.model_validate(compose_admin(schiedsrichter_raw, today=today)),
        delivery=await state_of(
            outbox_collection=outbox_collection,
            reference=FLOutboxReference(collection=Collection.SCHIEDSRICHTER, id=schiedsrichter_raw["_id"], seat=None),
        ),
    )


@router.post(
    "",
    status_code=201,
    summary="Create a Schiedsrichter",
    response_model=FLPostSchiedsrichterResponse,
    openapi_extra=SAFE_WHEN,
    responses=DRY_RUN_PASSED,
)
async def post_schiedsrichter(
    schiedsrichter_data: FLPostSchiedsrichterPayload,
    schiedsrichter_collection: SchiedsrichterCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    session: SnapshotSession,
    today: GermanDay,
    germany_now: GermanyNow,
    dry_run: DryRun = False,
) -> FLPostSchiedsrichterResponse | Response:
    """Create a referee and owe them their confirmation link, answering the address it goes to.

    Entering a referee is the invitation, with no second press deciding whether they are asked, since a referee nobody
    asked is a name nobody consented to publish. A `dry_run` is refused as the create would be, and answers 204 and
    writes nothing where it would land.
    """

    email = schiedsrichter_data.kontakt.email

    async def judge(session: AsyncClientSession) -> None:
        # Every refusal of the create, in its transaction or the dry run's snapshot alike.
        taken = await is_held_elsewhere(
            collection=schiedsrichter_collection, key="name", value=schiedsrichter_data.name, own_id=None, session=session
        )
        refuse_faults(find_referee_name_refusal(taken=taken))

    if dry_run:
        await judge(session)
        return dry_run_passed()

    async def judge_and_create(session: AsyncClientSession) -> Any:
        await judge(session)

        created = await insert_live(
            collection=schiedsrichter_collection,
            document={
                **schiedsrichter_data.model_dump(mode="json"),
                **compose_entry(today=today),
            },
            session=session,
        )
        await record_act(collection=schiedsrichter_collection, action="schiedsrichter.created", record_id=created.inserted_id, session=session)
        await owe_the_confirmation(
            outbox_collection=outbox_collection,
            schiedsrichter_id=created.inserted_id,
            email=email,
            deadline=confirmation_deadline_from(today=today),
            version=0,
            now=germany_now,
            session=session,
        )

        return created

    # One transaction over the judgement, the insert and the mail: a row written outside it would stand with a link
    # owed that an administrator was then told had been refused.
    post_operation = await transact(db, judge_and_create)

    return FLPostSchiedsrichterResponse(created_id=post_operation.inserted_id, confirmation=FLSchiedsrichterMint(email=email))


@router.patch(
    by_id("schiedsrichter_id"),
    summary="Update a Schiedsrichter",
    response_model=FLPatchSchiedsrichterResponse,
    openapi_extra=SAFE_WHEN,
    responses=DRY_RUN_PASSED,
)
async def patch_schiedsrichter(
    schiedsrichter_id: CustomObjectId,
    schiedsrichter_data: FLPatchSchiedsrichterPayload,
    schiedsrichter_collection: SchiedsrichterCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    session: SnapshotSession,
    today: GermanDay,
    germany_now: GermanyNow,
    dry_run: DryRun = False,
) -> FLPatchSchiedsrichterResponse | Response:
    """Update a referee on the `version` the editor was served, answering the version stored.

    A corrected address on an unconfirmed referee retires their link and owes a fresh one, named in `confirmation`, and a
    confirmed referee's address moves only through an address change. A `dry_run` is refused as the update would be, and
    answers 204 and writes nothing where it would land.
    """

    payload = schiedsrichter_data.model_dump(mode="json", exclude={"version"})
    email = schiedsrichter_data.kontakt.email

    async def judge(session: AsyncClientSession) -> Mapping[str, Any]:
        # Every refusal of the update, in its transaction or the dry run's snapshot alike.
        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            projection={"kontakt.email": 1, EINWILLIGUNG_FIELD: 1, "inactive_since": 1, VERSION_FIELD: 1},
            session=session,
        )
        taken = await is_held_elsewhere(
            collection=schiedsrichter_collection, key="name", value=schiedsrichter_data.name, own_id=schiedsrichter_id, session=session
        )
        refuse_faults(find_referee_name_refusal(taken=taken))
        refuse(find_confirmed_address_refusal(stored=stored, payload_email=email))
        # Read as well as filtered on: a dry run patches nothing for the version to refuse, and the patch's filter still
        # refuses a write racing past this read.
        refuse(find_stale_save_refusal(stored, version=schiedsrichter_data.version))
        return stored

    if dry_run:
        await judge(session)
        return dry_run_passed()

    async def correct_and_ask(session: AsyncClientSession) -> tuple[FLPatchSchiedsrichterResponse, bool]:
        # A fixture names the referee by id and reads the name at its own read, so nothing else is written; each
        # fixture keeps the `payment` agreed for it.
        stored = await judge(session)
        update, minted = compose_correction_update(stored=stored, payload=payload, payload_email=email, today=today)

        updated_document_raw = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            update=update,
            expected_version=schiedsrichter_data.version,
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        updated_document = FLSchiedsrichter(**updated_document_raw)
        await record_act(collection=schiedsrichter_collection, action="schiedsrichter.changed", record_id=schiedsrichter_id, session=session)
        if minted:
            # The corrected address this transaction wrote, never the stored one it replaced: mailing the link to the
            # address the save moved away from is the defect the fresh link exists to end.
            await owe_the_confirmation(
                outbox_collection=outbox_collection,
                schiedsrichter_id=updated_document.id,
                email=email,
                deadline=confirmation_deadline_from(today=today),
                version=updated_document.version,
                now=germany_now,
                session=session,
            )

        return FLPatchSchiedsrichterResponse(version=updated_document.version), minted

    # One transaction: a save storing a corrected address without the link it owes, or owing one the save rolled
    # back, mails the wrong mailbox.
    answer, re_minted = await transact(db, correct_and_ask)

    if re_minted:
        answer.confirmation = FLSchiedsrichterMint(email=email)

    return answer


@router.delete(
    by_id("schiedsrichter_id"),
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Deactivate a Schiedsrichter (soft delete)",
)
async def delete_schiedsrichter(
    schiedsrichter_id: CustomObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
    today: GermanDay,
) -> None:
    """Deactivate a referee, who stays on record because a played match names them by id.

    Refused while a fixture still to be played books them.
    """

    async def retire_the_referee(session: AsyncClientSession) -> None:
        # The row first: judging the fixtures of an id no row holds would answer 409 for a row the API says is not
        # there.
        await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            projection={"_id": 1},
            session=session,
        )

        assigned = await pull_whole_from_db(
            collection=spiele_collection,
            db_filter=build_unplayed_assignment_filter(schiedsrichter_id),
            projection={"spiel_nr": 1},
            session=session,
        )
        refuse(find_referee_retire_refusal(upcoming_spiel_nrs=sorted(int(row["spiel_nr"]) for row in assigned)))

        retired = await set_inactive_since(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            # An earlier press's day stands: it is the day a fee is reconciled against.
            when=today,
            session=session,
        )
        if retired is not None:
            await record_act(
                collection=schiedsrichter_collection, action="schiedsrichter.retired", record_id=schiedsrichter_id, session=session
            )

    # The stamp inside the judgement's transaction, so a booking committing after the read of the
    # fixtures conflicts on the referee it anchors rather than landing unseen.
    await transact(db, retire_the_referee)


@router.post(
    f"{by_id('schiedsrichter_id')}/reactivate",
    summary="Bring a deactivated Schiedsrichter back",
)
async def reactivate_schiedsrichter(
    schiedsrichter_id: CustomObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> FLSchiedsrichterReactivateResponse:
    """Bring a retired referee back into the picker and every default read, answering where a fresh link goes.

    One who has not answered is owed a fresh link, named in `confirmation`, since a retired referee's save mails nothing;
    one who has answered, holds no address a link can go to, or is back already, is owed none.
    """

    async def reactivate_and_ask(session: AsyncClientSession) -> str | None:
        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            projection=dict(INVITE_FIELDS),
            session=session,
        )
        # A second press finds the referee back: nothing moves, so nothing is recorded.
        if stored.get("inactive_since") is None:
            return None

        email = stored["kontakt"]["email"] if owes_reactivation_mint(stored=stored) else None

        # One write, the mint riding the revival's `$set`: the press is one action.
        minted = compose_mint_update(today=today) if email is not None else {}
        updated = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            update={"$set": {"inactive_since": None, **minted}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
        await record_act(
            collection=schiedsrichter_collection, action="schiedsrichter.reactivated", record_id=schiedsrichter_id, session=session
        )
        if email is not None:
            await owe_the_confirmation(
                outbox_collection=outbox_collection,
                schiedsrichter_id=updated["_id"],
                email=email,
                deadline=confirmation_deadline_from(today=today),
                version=updated[VERSION_FIELD],
                now=germany_now,
                session=session,
            )

        return email

    # One transaction, so a row never comes back without the link it was owed. The address answered is the one read
    # in-session above, never one the page read before the press: a save moving it in between would otherwise name the
    # previous mailbox.
    minted_for = await transact(db, reactivate_and_ask)

    return FLSchiedsrichterReactivateResponse(confirmation=None if minted_for is None else FLSchiedsrichterMint(email=minted_for))


@router.post(
    f"{by_id('schiedsrichter_id')}/confirmation/resend",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Send a Schiedsrichter a fresh confirmation link",
)
async def resend_confirmation(
    schiedsrichter_id: CustomObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> None:
    """Owe this referee a fresh confirmation link, which the Postausgang mints and mails, to the address they hold.

    The previous link stops working at once and the deadline restarts from today; a referee who has already answered is
    refused, since the new link could never be spent.
    """

    async def judge_and_mint(session: AsyncClientSession) -> None:
        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            projection=dict(INVITE_FIELDS),
            session=session,
        )

        refuse(find_retired_refusal(inactive_since=stored.get("inactive_since")))
        refuse(find_already_answered_refusal(einwilligung=stored.get(EINWILLIGUNG_FIELD)))

        email = stored["kontakt"]["email"]
        refuse(find_missing_address_refusal(email=email))

        updated = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            update={"$set": compose_mint_update(today=today)},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
        # The address read in-session above, never one the caller read before this request: a save moving it in between
        # would otherwise send the link to the previous mailbox.
        await owe_the_confirmation(
            outbox_collection=outbox_collection,
            schiedsrichter_id=updated["_id"],
            email=str(email),
            deadline=confirmation_deadline_from(today=today),
            version=updated[VERSION_FIELD],
            now=germany_now,
            session=session,
        )

    await transact(db, judge_and_mint)
