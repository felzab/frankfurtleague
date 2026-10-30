from datetime import datetime

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.berechtigungen.crud import owe_in_session, pull_the_list_to_judge, read_berechtigungen, read_the_announced
from app.api.berechtigungen.schemas import FLGrantReconciliationResponse
from app.api.berechtigungen.services import compare, compose_announced, compose_mitteilung, ernannt, gefunden
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt
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
    berechtigungen_collection: GrantsCollection,
    berechtigungen_angekuendigt_collection: GrantsAnnouncedCollection,
    postausgang_collection: OutboxCollection,
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

        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        changes = compare(grants=grants, announced=announced)
        if changes:
            # Anchored before the pass writes, so a revoke or a ban judging these rows conflicts with it.
            # The read repeats this snapshot's, and a pass owing nothing logs no anchor.
            await pull_the_list_to_judge(berechtigungen_collection=berechtigungen_collection, session=session)

            named = {
                stand.adresse for _, _, jetzt, vorher in changes for stand in (jetzt, vorher) if stand is not None and stand.adresse is not None
            }
            barred = await adressen_gesperrt(sperrliste, {str(row["adresse"]) for row in grants} | named, session=session)
            await owe_in_session(
                [
                    compose_mitteilung(grant_id=grant_id, art=art, jetzt=jetzt, before=vorher, changed_by=None, now=now, barred=barred)
                    for grant_id, art, jetzt, vorher in changes
                ],
                postausgang_collection=postausgang_collection,
                berechtigungen_collection=berechtigungen_collection,
                now=now,
                session=session,
            )
            # The record now accounts for each change, its notice owed. Bookkeeping, so removed with no image: an image
            # carries the address into a log every administrator reads for twelve months.
            await erase_many_from_db(
                collection=berechtigungen_angekuendigt_collection,
                db_filter={"_id": {"$in": [grant_id for grant_id, _, _, _ in changes]}},
                session=session,
            )
            current = [compose_announced(grant_id=grant_id, stand=jetzt, now=now) for grant_id, _, jetzt, _ in changes if jetzt is not None]
            if current:
                await post_many_to_db(collection=berechtigungen_angekuendigt_collection, documents=current, session=session)
            # This pass's clock and not the row's `granted_at`, which a paste typed and a repoint kept
            # from the address before.
            if found := gefunden(changes):
                await patch_many_in_db(
                    collection=berechtigungen_collection,
                    db_filter={"_id": {"$in": found}},
                    update={"$set": {"gefunden_am": now}},
                    session=session,
                )
            # Nothing dates the promotion's edit, so its owner's power dates from this pass, as the tier
            # change dates one made there.
            if raised := ernannt(changes):
                await patch_many_in_db(
                    collection=berechtigungen_collection,
                    db_filter={"_id": {"$in": raised}},
                    update={"$set": {"appointed_at": now}},
                    session=session,
                )

        # Every row no pass has read: once its record is gone, this mark tells an
        # edit made since from a paste nothing has seen. The unseen
        # alone, so a quiet pass writes nothing.
        if unseen := [row["_id"] for row in grants if row.get("gesehen_am") is None]:
            await patch_many_in_db(
                collection=berechtigungen_collection,
                db_filter={"_id": {"$in": unseen}},
                update={"$set": {"gesehen_am": now}},
                session=session,
            )

        return len(changes)

    async with transaction_session(db) as session:
        aenderungen = await session.with_transaction(compare_and_owe)

    return FLGrantReconciliationResponse(changes=aenderungen)
