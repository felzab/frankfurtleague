from collections.abc import Mapping, Sequence, Set
from typing import Any, NamedTuple

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import redact_images_in_session
from app.api.kontakte.services import (
    build_clearing_update,
    build_seat_images_filter,
    departing_names,
    find_matching_slots,
    seat_image_edits,
)
from app.core.crud import aggregate_many_from_db, patch_one_in_db
from app.core.recording import RedactionTarget, build_redaction_filter


async def _clear_each(collection: AsyncCollection, rows: Sequence[Mapping[str, Any]], identifier: str, session: AsyncClientSession) -> int:
    """Null this person's slots row by row, and answer how many slots.

    `patch_one_in_db` per row and never `patch_many_in_db`, which records no `document_id`
    (`docs/backend/spec.md :: I40`): each row's own history keeps the write that emptied the seat.
    """

    cleared = 0
    for row in rows:
        slots = find_matching_slots(row, identifier)
        update = build_clearing_update(slots, bestaetigungen=isinstance(row.get("bestaetigungen"), Mapping))
        await patch_one_in_db(
            collection=collection, db_filter={"_id": row["_id"]}, update=update, session=session, return_document=ReturnDocument.BEFORE
        )
        cleared += len(slots)

    return cleared


class SeatsCleared(NamedTuple):
    kontakt_slots: int
    redacted_aktionen: int


async def erase_kontaktperson_in_session(
    *,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    # Folded (`app/shared/folding.py :: sign_in_identifier`): every match below compares the fold.
    identifier: str,
    # The rows naming the address in a seat, of every status, each carrying its seats' addresses and its
    # `bestaetigungen`, read unbounded in the caller's transaction BEFORE any clearing: a cleared row stops matching.
    saison_team_rows: Sequence[Mapping[str, Any]],
    bewerbung_rows: Sequence[Mapping[str, Any]],
    # The caller's, so several erasures in one transaction redact under one instant.
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one
    # (`docs/backend/spec.md :: I52`).
    session: AsyncClientSession,
) -> SeatsCleared:
    """Clear, then redact, the rows the caller read in-session, so a retry re-reads them."""

    cleared_slots = await _clear_each(saison_teams_collection, saison_team_rows, identifier, session)
    cleared_slots += await _clear_each(bewerbungen_collection, bewerbung_rows, identifier, session)

    # LAST, so it reaches the pre-images the clearing patches above just filed, each still holding
    # this person; their seats alone, the people beside them keeping theirs.
    redacted = await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_seat_images_filter(identifier),
        judge=lambda image: seat_image_edits(image, (identifier,), links=True),
        stamp=stamp,
        session=session,
    )

    return SeatsCleared(kontakt_slots=cleared_slots, redacted_aktionen=redacted)


async def redact_seats_in_documents(
    *,
    aktionen_collection: AsyncCollection,
    documents: Sequence[RedactionTarget],
    # Folded (`app/shared/folding.py :: sign_in_identifier`): every image is judged on the fold.
    identifiers: Set[str],
    links: bool,
    stamp: str,
    session: AsyncClientSession,
) -> int:
    """The departing person's seats out of every log image of documents the caller reached by id, and how many rows changed."""

    db_filter = build_redaction_filter(documents)

    # Read whole before any image is judged: a name is theirs wherever ANY image of the document
    # seats it at their address, the write's own pre-image included.
    imaged = await aggregate_many_from_db(
        collection=aktionen_collection,
        pipeline=[{"$match": {**db_filter, "before": {"$ne": None}}}, {"$project": {"before._id": 1, "before.kontakte": 1}}],
        session=session,
    )
    names = departing_names(imaged, identifiers)

    return await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=db_filter,
        judge=lambda image: seat_image_edits(image, identifiers, links=links, names=names.get(image.get("_id"), frozenset())),
        stamp=stamp,
        session=session,
    )
