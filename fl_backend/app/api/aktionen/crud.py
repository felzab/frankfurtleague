"""
API · the action log's redactions, each run inside the transaction of the write that owes it

Here rather than beside `app/core/recording.py :: build_image_redactions`: a redaction reads and writes
through `app/core/crud.py`, which imports that module, so the call would close a cycle there.
"""

from collections.abc import Callable, Mapping
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.core.crud import aggregate_many_from_db, patch_many_in_db
from app.core.recording import ImageEdits, build_image_redactions


async def redact_images_in_session(
    *,
    aktionen_collection: AsyncCollection,
    db_filter: Mapping[str, Any],
    judge: Callable[[Mapping[str, Any]], ImageEdits],
    stamp: str,
    # REQUIRED: the read deciding each overwrite and the overwrite must see one snapshot, or a retry
    # judges images another writer has already moved.
    session: AsyncClientSession,
) -> int:
    """Overwrite what `judge` finds of the departing person in every image the selected rows hold, and answer how many rows changed."""

    # Unbounded: a capped read leaves an image holding them that nothing selects again.
    rows = await aggregate_many_from_db(
        collection=aktionen_collection,
        pipeline=[{"$match": {**db_filter, "before": {"$ne": None}}}, {"$project": {"before": 1}}],
        session=session,
    )

    changed = 0
    for ids, update in build_image_redactions(rows, judge=judge, at=stamp):
        result = await patch_many_in_db(collection=aktionen_collection, db_filter={"_id": {"$in": ids}}, update=update, session=session)
        changed += result.modified_count

    return changed

