"""
SPIELTAGE · write endpoints

Matchdays: named blocks of fixtures inside a season.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level, so every endpoint added here is guarded by
    construction. Never move the guard onto an individual endpoint.
  • **No payload here carries a position, and none may gain one** (ADR-0064). A matchday's place in its
    season is derived from `saison_phase` and `beginn` -- both of which have to be right anyway -- so
    there is nothing to set and no two matchdays can claim the same place.
  • Deletion is SOFT. `spiele.spieltag_id` points here and nothing cascades, so a hard delete would
    leave matches referencing a matchday that no longer exists.
  • **Soft is not harmless.** A retired matchday leaves `GET /spieltage`, and the public Spielplan joins
    fixtures onto the matchdays it received -- so retiring one takes its matches off that page with it.
    `REQ-RETIRE-002` refuses the retirement while any of them carries a result (owner, 2026-08-08).
  • `anzahl_spiele` is on no payload here. It is derived from the season's rules and this matchday's
    phase (ADR-0065), so the PHASE is what a write can get wrong -- and `REQ-SPIELTAG-002` refuses one
    accounting for fewer fixtures than the matchday already holds.
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument

from app.api.saisons.schedule import expected_matches
from app.api.saisons.schemas import FLSaisonRules
from app.api.spieltage.schemas import (
    FLPatchSpieltagPayload,
    FLPostSpieltagPayload,
    FLSpieltag,
    FLSpieltagWriteResponse,
)
from app.api.spieltage.services import find_spieltag_phase_refusal, find_spieltag_retire_refusal, find_spieltag_span_refusal
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, post_one_to_db, pull_one_from_db
from app.core.dependencies import SaisonsCollection, SpieleCollection, SpieltageCollection, get_german_date_str
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieltage",
    dependencies=[Depends(verify_access_admin)],
)


@router.post("", response_model=FLSpieltagWriteResponse, status_code=201, summary="Create a Spieltag")
async def post_spieltag(
    spieltag_data: Annotated[FLPostSpieltagPayload, Body()],
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
) -> FLSpieltagWriteResponse:
    """
    Create a matchday.

    Where it sits in the season follows from what it is: the phase in bracket order, then `beginn`. So a
    matchday created out of sequence is not a matchday in the wrong place — it is one whose phase or date
    is wrong, and correcting either moves it (ADR-0064).
    """

    # The span has to sit inside the season it names (`REQ-DATE-002`). A new matchday has no fixtures, so
    # the second half of that rule has nothing to check yet.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": spieltag_data.saison_id})
    span_refusal = find_spieltag_span_refusal(
        beginn=spieltag_data.beginn,
        ende=spieltag_data.ende,
        saison_start=str(saison_raw["start_date"]),
        saison_end=str(saison_raw["end_date"]),
        fixture_dates=[],
    )
    if span_refusal is not None:
        error_code, detail = span_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    post_operation = await post_one_to_db(
        collection=spieltage_collection,
        document={**spieltag_data.model_dump(mode="json"), "inactive_since": None},
    )

    return FLSpieltagWriteResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        spieltag_id=post_operation.inserted_id,
    )


@router.patch(by_id("spieltag_id"), response_model=FLSpieltagWriteResponse, summary="Update a Spieltag")
async def patch_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltag_data: Annotated[FLPatchSpieltagPayload, Body()],
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
) -> FLSpieltagWriteResponse:
    """
    Update a matchday.

    No fan-out: matches reference a matchday by id and embed no copy of it, so a renamed or re-dated
    matchday is picked up by every consumer on the next read.

    **The phase is refused if the matchday already holds more fixtures than it accounts for**
    (`REQ-SPIELTAG-002`, ADR-0065). A single round robin per group fixes that number, so moving a matchday
    of eight group fixtures into a Finale would leave seven of them with nowhere to be played. The other
    direction -- fewer fixtures than expected -- is left alone, because that is every season part-way
    through being set up.
    """

    stored_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})

    # The season's rules decide what the PROPOSED phase accounts for, so the refusal needs both. A
    # matchday whose season document is missing is left to the write below: 404 on the matchday is the
    # honest answer, and inventing an expected count from a default nobody chose is not (ADR-0043).
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": stored_raw["saison_id"]})
    attached = await spiele_collection.count_documents({"spieltag_id": spieltag_id})
    refusal = find_spieltag_phase_refusal(
        attached_count=attached,
        expected_count=expected_matches(FLSaisonRules.model_validate(saison_raw["rules"]), spieltag_data.saison_phase),
    )
    if refusal is not None:
        error_code, detail = refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    # The span, against the season above and against this matchday's own fixtures. Undated fixtures are
    # filtered out rather than passed as nulls: one constrains nothing, and a season being scheduled is
    # full of them.
    fixture_dates = [
        str(row["datum"]) async for row in spiele_collection.find({"spieltag_id": spieltag_id, "datum": {"$ne": None}}, {"datum": 1})
    ]
    span_refusal = find_spieltag_span_refusal(
        beginn=spieltag_data.beginn,
        ende=spieltag_data.ende,
        saison_start=str(saison_raw["start_date"]),
        saison_end=str(saison_raw["end_date"]),
        fixture_dates=fixture_dates,
    )
    if span_refusal is not None:
        error_code, detail = span_refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    updated_raw = await patch_one_in_db(
        collection=spieltage_collection,
        filter={"_id": spieltag_id},
        update={"$set": spieltag_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieltag_id}, error_code="DB-COMMON-001")

    return FLSpieltagWriteResponse(spieltag_id=spieltag_id, updated_document=FLSpieltag.model_validate(updated_raw))


@router.delete(by_id("spieltag_id"), response_model=FLSpieltagWriteResponse, summary="Retire a Spieltag (soft delete)")
async def delete_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltage_collection: SpieltageCollection,
    spiele_collection: SpieleCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpieltagWriteResponse:
    """
    Retire a matchday. SOFT: it stamps `inactive_since` and the document stays.

    Its matches are **not** touched and stay resolvable — `GET /spiele` never joins `spieltage`. That is
    the reason this is soft rather than a delete: a hard one would leave every one of those matches
    pointing at nothing.

    **It is refused while any of them carries a result** (`REQ-RETIRE-002`, owner, 2026-08-08). Resolvable
    is not the same as visible: a retired matchday leaves `GET /spieltage`, and the public Spielplan joins
    fixtures onto the matchdays it received — so this retirement takes played results off that page. An
    unplayed matchday retires freely, which is the one somebody created by mistake.
    """

    played = await spiele_collection.count_documents({"spieltag_id": spieltag_id, "ergebnis": {"$ne": None}})
    refusal = find_spieltag_retire_refusal(played_count=played)
    if refusal is not None:
        error_code, detail = refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    updated_raw = await patch_one_in_db(
        collection=spieltage_collection,
        filter={"_id": spieltag_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieltag_id}, error_code="DB-COMMON-001")

    return FLSpieltagWriteResponse(spieltag_id=spieltag_id, updated_document=FLSpieltag.model_validate(updated_raw))


@router.post(f"{by_id('spieltag_id')}/reactivate", response_model=FLSpieltagWriteResponse, summary="Bring a retired Spieltag back")
async def reactivate_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltage_collection: SpieltageCollection,
) -> FLSpieltagWriteResponse:
    """Clear `inactive_since`, restoring the matchday to every read that hides retired ones."""

    updated_raw = await patch_one_in_db(
        collection=spieltage_collection,
        filter={"_id": spieltag_id},
        update={"$set": {"inactive_since": None}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieltag_id}, error_code="DB-COMMON-001")

    return FLSpieltagWriteResponse(spieltag_id=spieltag_id, updated_document=FLSpieltag.model_validate(updated_raw))
