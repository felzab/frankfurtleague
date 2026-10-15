"""
API · the action log's redactions, each run inside the transaction of the write that owes it

Here rather than beside `app/core/recording.py :: build_image_redactions`: a redaction reads and writes
through `app/core/crud.py`, which imports that module, so the call would close a cycle there.
"""

from collections.abc import Callable, Mapping, Sequence
from functools import partial
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.services import IMAGE_ADDRESSES, address_image_edits, build_address_images_filter
from app.core.crud import aggregate_many_from_db, patch_many_in_db
from app.core.recording import ImageEdits, build_image_redactions
from app.shared.folding import sign_in_identifier


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

    rows = await read_imaged_rows(aktionen_collection=aktionen_collection, db_filter=db_filter, session=session)

    return await redact_rows_in_session(aktionen_collection=aktionen_collection, rows=rows, judge=judge, stamp=stamp, session=session)


async def read_imaged_rows(
    *, aktionen_collection: AsyncCollection, db_filter: Mapping[str, Any], session: AsyncClientSession
) -> list[Mapping[str, Any]]:
    """The selected rows still holding an image, each projected to it."""

    # Unbounded: a capped read leaves an image holding them that nothing selects again.
    return await aggregate_many_from_db(
        collection=aktionen_collection,
        pipeline=[{"$match": {**db_filter, "before": {"$ne": None}}}, {"$project": {"before": 1}}],
        session=session,
    )


async def redact_rows_in_session(
    *,
    aktionen_collection: AsyncCollection,
    # Read by `read_imaged_rows` in this same session, so the overwrite meets the images it judged.
    rows: Sequence[Mapping[str, Any]],
    judge: Callable[[Mapping[str, Any]], ImageEdits],
    stamp: str,
    session: AsyncClientSession,
) -> int:
    """Overwrite what `judge` finds of the departing person in each of these rows' images, and answer how many rows changed."""

    changed = 0
    for ids, update in build_image_redactions(rows, judge=judge, at=stamp):
        result = await patch_many_in_db(collection=aktionen_collection, db_filter={"_id": {"$in": ids}}, update=update, session=session)
        changed += result.modified_count

    return changed


async def redact_address_in_images(
    *,
    aktionen_collection: AsyncCollection,
    # Folded (`app/shared/folding.py :: sign_in_identifier`): every image is judged on the fold.
    identifier: str,
    stamp: str,
    session: AsyncClientSession,
) -> int:
    """Take the erased address out of every log image no step removed or cleared.

    Run LAST and in the full scope alone: the steps' writes file images still holding it, and a
    standing role keeps its own.
    """

    # Folded again, the fold being idempotent: an unfolded spelling passes the pre-filter's `i` and
    # matches nothing on the fold, so the erasure would commit having removed nothing.
    identifier = sign_in_identifier(identifier)

    changed = 0
    for collection, addresses in IMAGE_ADDRESSES.items():
        changed += await redact_images_in_session(
            aktionen_collection=aktionen_collection,
            db_filter=build_address_images_filter(collection, identifier),
            judge=partial(address_image_edits, identifier=identifier, addresses=addresses),
            stamp=stamp,
            session=session,
        )

    return changed
