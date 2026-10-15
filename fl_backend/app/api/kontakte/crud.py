from collections.abc import Mapping, Sequence
from typing import Any

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.kontakte.schemas import FLKontaktErasureResponse
from app.api.kontakte.services import (
    build_clearing_update,
    build_matching_rows_pipeline,
    build_orphaned_images_pipeline,
    find_matching_slots,
    images_holding,
    rows_naming,
)
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, patch_many_in_db, patch_one_in_db
from app.core.recording import build_redaction_filter, build_redaction_update


async def _clear_each(collection: AsyncCollection, rows: Sequence[Mapping[str, Any]], identifier: str, session: AsyncClientSession) -> int:
    """Null this person's slots row by row, and answer how many slots.

    `patch_one_in_db` per row and never `patch_many_in_db`, which records no `document_id`
    (`docs/backend/spec.md :: I40`): the redaction below must be able to match the row it logs.
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
    # ONE stamp for both passes below, so a row cannot say which of the two reached it; the caller's,
    # so several erasures in one transaction redact under one instant.
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
    # this person. An `$in` of no ids matches nothing, so an address naming nobody redacts nothing
    # rather than everything.
    redacted = await patch_many_in_db(
        collection=aktionen_collection,
        db_filter=build_redaction_filter(
            [
                (Collection.SAISON_TEAMS, [row["_id"] for row in saison_team_rows]),
                (Collection.BEWERBUNGEN, [row["_id"] for row in bewerbung_rows]),
            ]
        ),
        update=build_redaction_update(at=stamp),
        session=session,
    )

    # SECOND, so the pass above has already nulled `before` on everything it took and the counts
    # never cover one row twice: what is left is a swap's orphan, an image of a row that has since
    # stopped naming this person.
    orphaned_candidates = await aggregate_many_from_db(
        collection=aktionen_collection,
        pipeline=build_orphaned_images_pipeline(identifier),
        session=session,
    )
    orphaned = await patch_many_in_db(
        collection=aktionen_collection,
        # Judged before the patch: the pre-filter's `i` ignores case beyond ASCII (ſ for s), the
        # fold lowers ASCII alone, and only the fold may say whose each image is.
        db_filter={"_id": {"$in": images_holding(orphaned_candidates, identifier)}},
        update=build_redaction_update(at=stamp),
        session=session,
    )

    return FLKontaktErasureResponse(
        cleared_saison_teams=len(saison_team_rows),
        cleared_bewerbungen=len(bewerbung_rows),
        cleared_kontakt_slots=cleared_slots,
        redacted_aktionen=redacted.modified_count + orphaned.modified_count,
    )
