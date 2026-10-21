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

from app.api.aktionen.services import (
    EFFECT_IMAGE_COLLECTIONS,
    IMAGE_ADDRESSES,
    address_image_edits,
    build_address_images_filter,
    carried_by_the_effect,
)
from app.core.collections import Collection as DbCollection
from app.core.crud import aggregate_many_from_db, patch_many_in_db
from app.core.recording import ERASED_ACTOR_MARKER, ImageEdits, build_image_redactions
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

    # Folded again, the fold being idempotent: an unfolded spelling matches no stored image, and the
    # erasure would commit having removed nothing.
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


async def reattribute_administrator_in_session(
    *, aktionen_collection: AsyncCollection, identifier: str, value: str, session: AsyncClientSession
) -> int:
    """Put `value` where this folded address stood as the administrator writing a log row, answering how many rows changed.

    The erasure's marker, or the address an effect moved the administrator to (`docs/backend/spec.md :: I845`).
    """

    # Read first and written by id, so the update walks the `_id` index: nothing indexes `actor.email`, which every
    # recorded write would pay for. Folded, as `app/core/security.py :: bind_actor` stores every actor's address.
    candidates = await aggregate_many_from_db(
        collection=aktionen_collection,
        pipeline=[{"$match": {"actor.email": sign_in_identifier(identifier)}}, {"$project": {"_id": 1}}],
        session=session,
    )
    if not candidates:
        return 0

    marked = await patch_many_in_db(
        collection=aktionen_collection,
        db_filter={"_id": {"$in": [row["_id"] for row in candidates]}},
        update={"$set": {"actor.email": value}},
        session=session,
    )

    return marked.modified_count


async def carry_the_replaced_address_in_images(
    *,
    aktionen_collection: AsyncCollection,
    # Both folded (`app/shared/folding.py :: sign_in_identifier`).
    alt: str,
    neue: str,
    collections: Sequence[DbCollection],
    stamp: str,
    session: AsyncClientSession,
) -> int:
    """Re-key the replaced address in these collections' log images as an address change's effect owes them.

    Every other collection keeps its subject's address, its record reached by id; who acted carries everywhere.
    """

    changed = 0
    for collection in collections:
        addresses = tuple(
            address
            for address in IMAGE_ADDRESSES[collection]
            if collection in EFFECT_IMAGE_COLLECTIONS or address.replacement == ERASED_ACTOR_MARKER
        )
        if not addresses:
            continue
        changed += await redact_images_in_session(
            aktionen_collection=aktionen_collection,
            db_filter=build_address_images_filter(collection, alt),
            judge=partial(address_image_edits, identifier=alt, addresses=carried_by_the_effect(addresses, neue)),
            stamp=stamp,
            session=session,
        )

    return changed
