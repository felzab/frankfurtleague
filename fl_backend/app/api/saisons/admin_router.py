"""
SAISONS · write endpoints

Creating a season, editing its dates and scoring rules, and the rollover that moves the league from one
season to the next.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level, so every endpoint added to this file is guarded
    by construction. Never move the guard onto an individual endpoint.
  • EXACTLY ONE season is `active`, and nothing in the database can express that -- not a `$jsonSchema`
    validator, not a unique index (ADR-0027). `activate_saison` is the only code path that writes
    `status` at all, which is what makes the invariant enforceable in one place (ADR-0033).
  • There is NO delete. A season that is over is `past`; deleting one would orphan every spiel,
    spieltag and junction row referencing its id, none of which carries a cascade.
  • A created season is always `future`. Creating and activating in one step would make an ordinary
    typo in a new season's id a silent rollover of the live one.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/_decisions/0033-one-active-season-and-one-path-to-it.md -- the decision and what it rejected
  docs/backend/spec.md -- section 3, the write path
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument

from app.api.saisons.schemas import (
    FLActivateSaisonResponse,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLPostSaisonPayload,
    FLPostSaisonResponse,
    FLSaison,
)
from app.core.config import backend_config
from app.core.crud import patch_many_in_db, patch_one_in_db, post_one_to_db, pull_one_from_db
from app.core.dependencies import DBClient, SaisonsCollection
from app.core.exceptions import DocumentNotFoundException
from app.core.security import verify_access_admin

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/saisons",
    dependencies=[Depends(verify_access_admin)],
)


@router.post("", response_model=FLPostSaisonResponse, status_code=201, summary="Create a Saison")
async def post_saison(
    saison_data: Annotated[FLPostSaisonPayload, Body()],
    saisons_collection: SaisonsCollection,
) -> FLPostSaisonResponse:
    """
    Create a season. It is always created `future` and never `active`.

    The id is supplied rather than generated: `saisons._id` is the four-character season string that
    every `saison_id` elsewhere in the database references. Reusing an existing one is refused by the
    `_id` index and comes back as a 409.

    Making it live is a separate, deliberate step — `POST /saisons/{saison_id}/activate`.
    """

    post_operation = await post_one_to_db(
        collection=saisons_collection,
        # `_id` rather than `id`: this payload's `id` IS the document key, and the read model reads it
        # back through a `_id` validation alias.
        document={**saison_data.model_dump(mode="json", exclude={"id"}), "_id": saison_data.id, "status": "future"},
    )

    return FLPostSaisonResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=str(post_operation.inserted_id),
    )


@router.patch("/{saison_id}", response_model=FLPatchSaisonResponse, summary="Update a Saison's dates and rules")
async def patch_saison(
    saison_id: str,
    saison_data: Annotated[FLPatchSaisonPayload, Body()],
    saisons_collection: SaisonsCollection,
) -> FLPatchSaisonResponse:
    """
    Update a season's dates and scoring rules. `status` is deliberately not part of the payload.

    Editing `rules.win_points` or `draw_points` changes **every league table for this season on the
    next read** — the standings are derived from the matches rather than stored (ADR-0026), so there is
    no migration to run and equally nothing to announce that the numbers moved.
    """

    updated_document_raw = await patch_one_in_db(
        collection=saisons_collection,
        filter={"_id": saison_id},
        update={"$set": saison_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(filter={"_id": saison_id}, error_code="DB-COMMON-001")

    return FLPatchSaisonResponse(updated_document=FLSaison.model_validate(updated_document_raw))


@router.post("/{saison_id}/activate", response_model=FLActivateSaisonResponse, summary="Make this the active Saison")
async def activate_saison(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    db: DBClient,
) -> FLActivateSaisonResponse:
    """
    Make this the active season, moving whichever season currently holds `active` to `past`.

    This is the **only** path to `status: "active"` — no other endpoint writes the field, so "exactly
    one active season" holds by construction rather than by convention. `pull_current_saison` and every
    endpoint defaulting an omitted `saison_id` (ADR-0002) depend on it.

    Both writes run in one transaction, so the league is never briefly without an active season and
    never briefly with two.

    It does **not** check that the outgoing season's matches are all played. An early rollover is a
    legitimate decision, and refusing one here would put the backend in the way of it; the admin page
    is where that precondition is presented to a person.
    """

    # A read first, so a bad id is a 404 rather than a rollover that deactivates the live season and
    # then promotes nothing. Inside the transaction it would roll back, but the ordering makes the
    # failure legible without relying on that.
    target_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})

    async with await db.start_session() as session:
        async with session.start_transaction():
            # `update_many`, not `update_one`: if the database has somehow ended up with two active
            # seasons, this is the operation that repairs it rather than preserving one of them.
            # `$ne` on the target so re-activating the current season is a no-op instead of demoting
            # the very row it is about to promote.
            demoted = await patch_many_in_db(
                collection=saisons_collection,
                filter={"status": "active", "_id": {"$ne": saison_id}},
                update={"$set": {"status": "past"}},
                session=session,
            )

            activated_raw = await patch_one_in_db(
                collection=saisons_collection,
                filter={"_id": saison_id},
                update={"$set": {"status": "active"}},
                session=session,
                return_document=ReturnDocument.AFTER,
            )

    # The read above already proved the row exists, so this is a type narrowing rather than a branch
    # anything is expected to reach.
    activated = FLSaison.model_validate(activated_raw if activated_raw is not None else target_raw)

    return FLActivateSaisonResponse(updated_document=activated, deactivated=demoted.modified_count)
