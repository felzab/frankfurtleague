from collections.abc import Mapping, Sequence
from typing import Any

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import redact_images_in_session
from app.api.kontakte.schemas import FLKontaktErasureResponse
from app.api.kontakte.services import (
    build_clearing_update,
    build_matching_rows_pipeline,
    build_seat_images_filter,
    find_matching_slots,
    rows_naming,
    seat_image_edits,
)
from app.core.crud import aggregate_many_from_db, patch_one_in_db


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


async def erase_kontaktperson_in_session(
    *,
    saison_teams_collection: AsyncCollection,
    bewerbungen_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    # Folded (`app/shared/folding.py :: sign_in_identifier`): every match below compares the fold.
    identifier: str,
    # The caller's, so several erasures in one transaction redact under one instant.
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one
    # (`docs/backend/spec.md :: I42`).
    session: AsyncClientSession,
) -> FLKontaktErasureResponse:
    """Find, then clear, then redact. Everything judged is read in-session, so a retry re-reads it."""

    # BOTH reads before either write, and unbounded: the `$set` below stops the address matching,
    # and a capped read would leave rows holding the person with nothing left to find them by
    # (`app/api/spieler/crud.py :: erase_person_in_session` does the same).
    saison_team_rows = rows_naming(
        await aggregate_many_from_db(collection=saison_teams_collection, pipeline=build_matching_rows_pipeline(identifier), session=session),
        identifier,
    )
    bewerbung_rows = rows_naming(
        await aggregate_many_from_db(collection=bewerbungen_collection, pipeline=build_matching_rows_pipeline(identifier), session=session),
        identifier,
    )

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

    return FLKontaktErasureResponse(
        cleared_saison_teams=len(saison_team_rows),
        cleared_bewerbungen=len(bewerbung_rows),
        cleared_kontakt_slots=cleared_slots,
        redacted_aktionen=redacted,
    )
