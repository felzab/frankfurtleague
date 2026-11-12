from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.grants.crud import owe_in_session, pull_the_list_to_judge
from app.api.grants.services import compose_handover_end, compose_notice
from app.api.kontakte.services import same_address
from app.core.crud import aggregate_many_from_db, delete_many_from_db
from app.shared.folding import sign_in_identifier


async def _grants_of(grants_collection: AsyncCollection, identifier: str, session: AsyncClientSession) -> list[Mapping[str, Any]]:
    """Every grant this person holds, unbounded: a capped read leaves the rest naming them."""

    rows = await aggregate_many_from_db(
        collection=grants_collection, pipeline=[{"$match": {"address": same_address(identifier)}}], session=session
    )

    # The fold decides: the pattern reads every mailbox sharing the local part, its `i` beyond ASCII (ſ for s).
    return [row for row in rows if sign_in_identifier(str(row["address"])) == identifier]


async def erase_grants_in_session(
    *,
    grants_collection: AsyncCollection,
    outbox_collection: AsyncCollection,
    # Folded.
    identifier: str,
    now: datetime,
    # Required: the grants and their notices go in one transaction or none.
    session: AsyncClientSession,
) -> None:
    """Remove every grant this person holds, an `owner` grant included, refusing nothing.

    Who may erase an owner is the caller's judgement, and so is any line once the transaction commits.
    """

    # Anchored, so an addition of this address landing beside the erasure conflicts, and the retry judges a grant it can see.
    await pull_the_list_to_judge(grants_collection=grants_collection, session=session)

    # Read before the removal, after which no grant matches.
    grants = await _grants_of(grants_collection, identifier, session)
    grant_ids = [grant["_id"] for grant in grants]

    # Naming no address: every holder hears that a grant ended, and nothing of whose.
    notices = [
        notice
        for grant in grants
        for notice in (
            compose_notice(grant_id=grant["_id"], change="revoked", stage="completed", address=None),
            *compose_handover_end(grant, address=None),
        )
    ]

    if grant_ids:
        await delete_many_from_db(collection=grants_collection, db_filter={"_id": {"$in": grant_ids}}, session=session)

    # After the removal, so the person is no holder told: every holder who remains is.
    await owe_in_session(notices, outbox_collection=outbox_collection, grants_collection=grants_collection, now=now, session=session)
