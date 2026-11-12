from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.grants.guard import verify_actor_is_admin
from app.api.outbox.crud import state_of
from app.api.outbox.schemas import FLOutboxReference
from app.api.schiedsrichter.crud import owe_the_confirmation
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLPatchSchiedsrichterResponse,
    FLPostSchiedsrichterPayload,
    FLPostSchiedsrichterResponse,
    FLSchiedsrichter,
    FLSchiedsrichterFilterParams,
    FLSchiedsrichterListAdapter,
    FLSchiedsrichterListResponse,
    FLSchiedsrichterMint,
    FLSchiedsrichterMintResponse,
    FLSchiedsrichterReactivateResponse,
    FLSchiedsrichterSingleResponse,
)
from app.api.schiedsrichter.services import (
    CONFIRMATION_FIELD,
    EINWILLIGUNG_FIELD,
    INVITE_FIELDS,
    build_unplayed_assignment_filter,
    compose_correction_update,
    compose_mint_update,
    confirmation_deadline_from,
    deadline_passed,
    find_already_answered_refusal,
    find_confirmed_address_refusal,
    find_missing_address_refusal,
    find_referee_name_refusal,
    find_referee_retire_refusal,
    find_retired_refusal,
    owes_reactivation_mint,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    GERMAN_COLLATION,
    VERSION_FIELD,
    build_query,
    insert_live,
    is_held_elsewhere,
    patch_one_in_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import (
    DBClient,
    OutboxCollection,
    OutboxReadCollection,
    SchiedsrichterCollection,
    SchiedsrichterReadCollection,
    SpieleCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import record_act
from app.core.routing import by_id
from app.core.security import (
    bind_actor,
    verify_access_admin,
)
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId

# Admin-guarded, not base: a referee is a pupil, so their contact details and school are admin-tier, as is the fee,
# which is money.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


@router.get("", response_model=FLSchiedsrichterListResponse, summary="List Schiedsrichter")
async def get_schiedsrichter(
    schiedsrichter_collection: SchiedsrichterReadCollection,
    filters: FLSchiedsrichterFilterParams = Depends(),
) -> FLSchiedsrichterListResponse:
    """Every referee in name order, retired ones included where `include_inactive` asks, since a played match still names them."""

    schiedsrichter_raw = await pull_many_from_db(
        collection=schiedsrichter_collection,
        db_filter=build_query(filters, terms=frozenset(), include_inactive=filters.include_inactive),
        sort_by=[("name", 1)],
        collation=GERMAN_COLLATION,
    )

    return FLSchiedsrichterListResponse(schiedsrichter=FLSchiedsrichterListAdapter.validate_python(schiedsrichter_raw))


@router.get(
    by_id("schiedsrichter_id"),
    response_model=FLSchiedsrichterSingleResponse,
    summary="One Schiedsrichter",
)
async def get_schiedsrichter_by_id(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterReadCollection,
    outbox_collection: OutboxReadCollection,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterSingleResponse:
    """One referee, a retired one included, with whether their consent link has lapsed today and what became of their last confirmation mail.

    An erased referee's id answers 404.
    """

    schiedsrichter_raw = await pull_one_from_db(collection=schiedsrichter_collection, db_filter={"_id": schiedsrichter_id})

    return FLSchiedsrichterSingleResponse(
        schiedsrichter=FLSchiedsrichter(**schiedsrichter_raw),
        confirmation_expired=deadline_passed(schiedsrichter_raw.get(CONFIRMATION_FIELD), today=today),
        delivery=await state_of(
            outbox_collection=outbox_collection,
            reference=FLOutboxReference(collection=Collection.SCHIEDSRICHTER, id=schiedsrichter_raw["_id"], seat=None),
        ),
    )


@router.post(
    "",
    response_model=FLPostSchiedsrichterResponse,
    status_code=201,
    summary="Create a Schiedsrichter",
)
async def post_schiedsrichter(
    schiedsrichter_data: Annotated[FLPostSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLPostSchiedsrichterResponse:
    """Create a referee and owe them their confirmation link, answering the address and the deadline it goes to.

    Entering a referee is the invitation, with no second press deciding whether they are asked, since a referee nobody
    asked is a name nobody consented to publish.
    """

    email = schiedsrichter_data.kontakt.email

    async def judge_and_create(session: AsyncClientSession) -> Any:
        """Ask after the name, then write. The check is handed the transaction's session, so a retry re-asks it."""

        taken = await is_held_elsewhere(
            collection=schiedsrichter_collection, key="name", value=schiedsrichter_data.name, own_id=None, session=session
        )
        refuse(find_referee_name_refusal(taken=taken))

        created = await insert_live(
            collection=schiedsrichter_collection,
            document={
                **schiedsrichter_data.model_dump(mode="json"),
                **compose_mint_update(today=today),
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
            now=now,
            session=session,
        )

        return created

    # One transaction over the judgement, the insert and the mail: a row written outside it would stand with a link
    # owed that an administrator was then told had been refused.
    async with transaction_session(db) as session:
        post_operation = await session.with_transaction(judge_and_create)

    return FLPostSchiedsrichterResponse(
        created_id=post_operation.inserted_id,
        # The payload's own address, which this transaction wrote: there is no earlier row for a
        # rival save to have moved between the caller's read and the write.
        confirmation=FLSchiedsrichterMint(deadline=confirmation_deadline_from(today=today), email=email),
    )


@router.patch(
    by_id("schiedsrichter_id"),
    response_model=FLPatchSchiedsrichterResponse,
    summary="Update a Schiedsrichter",
)
async def patch_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_data: Annotated[FLPatchSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLPatchSchiedsrichterResponse:
    """Update a referee on the `version` the editor was served, answering the version stored.

    A corrected address on an unconfirmed referee retires their link and owes a fresh one, named in `confirmation`, and a
    confirmed referee's address moves only through an address change.
    """

    payload = schiedsrichter_data.model_dump(mode="json", exclude={"version"})
    email = schiedsrichter_data.kontakt.email

    async def correct_and_ask(session: AsyncClientSession) -> tuple[FLPatchSchiedsrichterResponse, bool]:
        # In-session, so the judgement below reads the address and the record this save replaces
        # rather than a snapshot a rival write has already moved. A fixture names the referee by id and reads the name
        # at its own read, so nothing else is written; each fixture keeps the `payment` agreed for it.
        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            projection={"kontakt.email": 1, EINWILLIGUNG_FIELD: 1, "inactive_since": 1},
            session=session,
        )
        taken = await is_held_elsewhere(
            collection=schiedsrichter_collection, key="name", value=schiedsrichter_data.name, own_id=schiedsrichter_id, session=session
        )
        refuse(find_referee_name_refusal(taken=taken))
        refuse(find_confirmed_address_refusal(stored=stored, payload_email=email))
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
                now=now,
                session=session,
            )

        return FLPatchSchiedsrichterResponse(version=updated_document.version), minted

    # One transaction: a save storing a corrected address without the link it owes, or owing one the save rolled
    # back, mails the wrong mailbox. Every write derives from the payload and an in-session read, so a
    # `with_transaction` retry is safe.
    async with transaction_session(db) as session:
        answer, re_minted = await session.with_transaction(correct_and_ask)

    if re_minted:
        answer.confirmation = FLSchiedsrichterMint(deadline=confirmation_deadline_from(today=today), email=email)

    return answer


@router.delete(
    by_id("schiedsrichter_id"),
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Deactivate a Schiedsrichter (soft delete)",
)
async def delete_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> None:
    """Deactivate a referee, who stays on record because a played match names them by id.

    Refused while a fixture still to be played books them.
    """

    async def retire_the_referee(session: AsyncClientSession) -> None:
        """Judge the referee's unplayed fixtures, then stamp them. Everything judged is read in-session, so a retry re-judges it."""

        # The row first: judging the fixtures of an id no row holds would answer 409 for a row the API says is not
        # there.
        await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            projection={"_id": 1},
            session=session,
        )

        assigned = await pull_many_from_db(
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
    async with transaction_session(db) as session:
        await session.with_transaction(retire_the_referee)


@router.post(
    f"{by_id('schiedsrichter_id')}/reactivate",
    response_model=FLSchiedsrichterReactivateResponse,
    summary="Bring a deactivated Schiedsrichter back",
)
async def reactivate_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterReactivateResponse:
    """Bring a retired referee back into the picker and every default read.

    One who has not answered is owed a fresh link, named in `confirmation`, since a retired referee's save mails nothing.
    """

    async def reactivate_and_ask(session: AsyncClientSession) -> str | None:
        """Judged on the row as the transaction reads it, so a retry re-judges it."""

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
                now=now,
                session=session,
            )

        return email

    # One transaction, so a row never comes back without the link it was owed.
    async with transaction_session(db) as session:
        minted_for = await session.with_transaction(reactivate_and_ask)

    return FLSchiedsrichterReactivateResponse(
        confirmation=None if minted_for is None else FLSchiedsrichterMint(deadline=confirmation_deadline_from(today=today), email=minted_for),
    )


@router.post(
    f"{by_id('schiedsrichter_id')}/confirmation/invite",
    response_model=FLSchiedsrichterMintResponse,
    summary="Send a Schiedsrichter a fresh confirmation link",
)
async def invite_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterMintResponse:
    """Owe this referee a fresh confirmation link, which the Postausgang mints and mails, and answer where it goes.

    The previous link stops working at once and the deadline restarts from today; a referee who has already answered is
    refused, since the new link could never be spent.
    """

    async def judge_and_mint(session: AsyncClientSession) -> str:
        """Judge, then replace the block and owe the link, and answer the address it is owed to.

        Everything judged is read in-session, so a retry re-judges it against the row as it stands
        rather than against a snapshot.
        """

        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            projection=dict(INVITE_FIELDS),
            session=session,
        )

        refuse(find_retired_refusal(inactive_since=stored.get("inactive_since")))
        refuse(find_already_answered_refusal(einwilligung=stored.get(EINWILLIGUNG_FIELD), confirmation=stored.get(CONFIRMATION_FIELD)))

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
        await owe_the_confirmation(
            outbox_collection=outbox_collection,
            schiedsrichter_id=updated["_id"],
            email=str(email),
            deadline=confirmation_deadline_from(today=today),
            version=updated[VERSION_FIELD],
            now=now,
            session=session,
        )

        return str(email)

    # The address answered is the one read in-session above, never one the caller read before this
    # request: a save moving it in between would otherwise send the link to the previous mailbox.
    async with transaction_session(db) as session:
        minted_for = await session.with_transaction(judge_and_mint)

    return FLSchiedsrichterMintResponse(confirmation=FLSchiedsrichterMint(deadline=confirmation_deadline_from(today=today), email=minted_for))
