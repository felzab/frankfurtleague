from datetime import datetime

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.berechtigungen.crud import owe_in_session, pull_the_list_to_judge, read_berechtigungen, read_the_announced
from app.api.berechtigungen.schemas import FLGrantReconciliationResponse
from app.api.berechtigungen.services import compare, compose_announced, compose_mitteilung, ernannt, found_ids
from app.api.sperrliste.lookup import SperrlisteLookup, barred_addresses
from app.core.config import API_VERSION
from app.core.crud import erase_many_from_db, patch_many_in_db, post_many_to_db
from app.core.dependencies import (
    DBClient,
    GrantsAnnouncedCollection,
    GrantsCollection,
    OutboxCollection,
    get_germany_now,
)
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import transaction_session

# System tier and the system actor, as the application sweep's own router is: the pass holds no
# session, and an out-of-band change has no administrator to attribute its rows to.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/grants/reconciliation",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


@router.post(
    "",
    response_model=FLGrantReconciliationResponse,
    summary="Owe a notice of every change to the grants made in the database",
)
async def post_grants_reconciliation(
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLGrantReconciliationResponse:
    """
    Compare the grants with what the administrators were last told, and owe each change made in the database to every one of them.

    A change found here names nobody (`author` is `datenbank`), and no barred address is named in it. A write through the
    application owes its own notice in its own transaction, so only an edit in the database is found here, once: the record
    it is compared with moves in the same transaction.
    """

    async def compare_and_owe(session: AsyncClientSession) -> int:
        """Read the grants, the record and the ban list, then owe and record what differs, each on this transaction's session."""

        grants = await read_berechtigungen(grants_collection=grants_collection, session=session)
        announced = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)
        changes = compare(grants=grants, announced=announced)
        if changes:
            # Anchored before the pass writes, so a revoke or a ban judging these rows conflicts with it.
            # The read repeats this snapshot's, and a pass owing nothing logs no anchor.
            await pull_the_list_to_judge(grants_collection=grants_collection, session=session)

            named = {
                stand.address for _, _, after, before in changes for stand in (after, before) if stand is not None and stand.address is not None
            }
            barred = await barred_addresses(sperrliste, {str(row["address"]) for row in grants} | named, session=session)
            await owe_in_session(
                [
                    compose_mitteilung(grant_id=grant_id, kind=kind, current=after, before=before, changed_by=None, now=now, barred=barred)
                    for grant_id, kind, after, before in changes
                ],
                outbox_collection=outbox_collection,
                grants_collection=grants_collection,
                now=now,
                session=session,
            )
            # The record now accounts for each change, its notice owed. Bookkeeping, so removed with no image: an image
            # carries the address into a log every administrator reads for twelve months.
            await erase_many_from_db(
                collection=grants_announced_collection,
                db_filter={"_id": {"$in": [grant_id for grant_id, _, _, _ in changes]}},
                session=session,
            )
            current = [compose_announced(grant_id=grant_id, stand=after, now=now) for grant_id, _, after, _ in changes if after is not None]
            if current:
                await post_many_to_db(collection=grants_announced_collection, documents=current, session=session)
            # This pass's clock and not the row's `granted_at`, which a paste typed and a repoint kept
            # from the address before.
            if found := found_ids(changes):
                await patch_many_in_db(
                    collection=grants_collection,
                    db_filter={"_id": {"$in": found}},
                    update={"$set": {"gefunden_am": now}},
                    session=session,
                )
            # Nothing dates the promotion's edit, so its owner's power dates from this pass, as the tier
            # change dates one made there.
            if raised := ernannt(changes):
                await patch_many_in_db(
                    collection=grants_collection,
                    db_filter={"_id": {"$in": raised}},
                    update={"$set": {"appointed_at": now}},
                    session=session,
                )

        # Every row no pass has read: once its record is gone, this mark tells an
        # edit made since from a paste nothing has seen. The unseen
        # alone, so a quiet pass writes nothing.
        if unseen := [row["_id"] for row in grants if row.get("gesehen_am") is None]:
            await patch_many_in_db(
                collection=grants_collection,
                db_filter={"_id": {"$in": unseen}},
                update={"$set": {"gesehen_am": now}},
                session=session,
            )

        return len(changes)

    async with transaction_session(db) as session:
        aenderungen = await session.with_transaction(compare_and_owe)

    return FLGrantReconciliationResponse(changes=aenderungen)
