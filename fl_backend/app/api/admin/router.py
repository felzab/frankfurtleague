"""
ADMIN · every mutation in the system

Eight endpoints, and the only write path the product has. Everything else in `app/api/` is read-only.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level. Any endpoint added to this file is guarded by
    construction -- do not move the guard onto individual endpoints.
  • `patch_spiel_data` runs inside one transaction and depends on `patch_one_in_db` returning the
    PRE-WRITE document: the statistics deltas are computed from the old goal counts. Switching it to
    `ReturnDocument.AFTER` corrupts every team's table without raising anything.
  • `ergebnis` is DERIVED from the two `tore` values, never accepted from the client.
  • The payload is written wholesale with `$set`, so a field absent from the payload is overwritten,
    not preserved. This is why the money fields carry no Pydantic default.
  • Venue and referee deletion is SOFT (`is_inactive`). Matches embed copies of both, so a hard delete
    would orphan them.
  • Renaming a venue or referee fans the change out into every match embedding it. Without the
    fan-out, match cards show stale names indefinitely.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- section 3, the write path step by step
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends, status
from fastapi.responses import JSONResponse
from pymongo import ReturnDocument

from app.api.admin.schemas import FLPatchSpielDataResponse
from app.api.admin.services import get_stats_contribution, update_team_statistik
from app.api.schiedsrichter.schemas import (
    FLDeleteSchiedsrichterPayload,
    FLDeleteSchiedsrichterResponse,
    FLPatchSchiedsrichterPayload,
    FLPatchSchiedsrichterResponse,
    FLPostSchiedsrichterPayload,
    FLPostSchiedsrichterResponse,
    FLSchiedsrichter,
)
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpiel, FLSpieleListResponse, FLSpielListAdapter
from app.api.spielorte.schemas import (
    FLDeleteSpielortPayload,
    FLDeleteSpielortResponse,
    FLPatchSpielortPayload,
    FLPatchSpielortResponse,
    FLPostSpielortPayload,
    FLPostSpielortResponse,
    FLSpielort,
)
from app.core.config import backend_config
from app.core.crud import patch_many_in_db, patch_one_in_db, post_one_to_db, pull_many_from_db
from app.core.dependencies import (
    DBClient,
    SchiedsrichterCollection,
    SpieleCollection,
    SpielorteCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exceptions import DocumentNotFoundException
from app.core.security import verify_access_admin

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/admin",
    dependencies=[Depends(verify_access_admin)],
)


@router.get("/action_required", response_model=FLSpieleListResponse, summary="Spiele needing attention")
async def get_spiele_action_required(spiele_collection: SpieleCollection, today: str = Depends(get_german_date_str)) -> FLSpieleListResponse:
    """
    List Spiele that need an admin's attention.

    A match qualifies if it is cancelled, is missing a date, time, venue or referee, or is in the past
    with no result recorded. Not season-filtered: it spans every season.
    """

    # Fetch all games with either a missing attribute or games which have a date in the past but don't have a final score
    spiele_raw = await pull_many_from_db(
        collection=spiele_collection,
        db_filter={
            "$or": [
                {"is_canceled": True},
                {"datum": None},
                {"uhrzeit": None},
                {"ort": None},
                {"schiedsrichter": None},
                {"datum": {"$lt": today}, "ergebnis": None},
            ]
        },
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    return FLSpieleListResponse(spiele=spiele)


@router.patch("/update_spiel_data", response_model=FLPatchSpielDataResponse, summary="Update a Spiel and both teams' statistics")
async def patch_spiel_data(
    spiel_data: Annotated[FLPatchSpielDataPayload, Body()],
    db: DBClient,
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
) -> JSONResponse:
    """
    Update one Spiel and adjust both teams' statistics, in a single transaction.

    `ergebnis` is derived from the two `tore` values and must not be submitted. The payload is written
    wholesale, so every field must be present -- an omitted field is overwritten, not preserved.

    `saison_id` is deliberately not part of the payload: it is not declared on the model and Pydantic
    would discard it. The frontend passes it separately, for cache invalidation only.
    """

    updated_ergebnis_field = (
        f"{spiel_data.team1.tore}:{spiel_data.team2.tore}" if spiel_data.team1.tore is not None and spiel_data.team2.tore is not None else None
    )

    async with await db.start_session() as session:
        async with session.start_transaction():
            # Update the spiel data
            old_game_data_raw = await patch_one_in_db(
                collection=spiele_collection,
                filter={"_id": spiel_data.spiel_id},
                update={
                    "$set": {
                        **spiel_data.model_dump(exclude={"spiel_id"}, context={"keep_oid": True}),
                        "ergebnis": updated_ergebnis_field,
                    }
                },
                session=session,
            )
            if old_game_data_raw is None:
                raise DocumentNotFoundException(
                    filter={"_id": spiel_data.spiel_id},
                    error_code="DB-COMMON-001",
                )

            old_game_data = FLSpiel(**old_game_data_raw)

            # Get the contributions to the statistics for the new and old spiel state
            old_contribution_team1 = get_stats_contribution(old_game_data.team1.tore, old_game_data.team2.tore)
            old_contribution_team2 = get_stats_contribution(old_game_data.team2.tore, old_game_data.team1.tore)

            new_contribution_team1 = get_stats_contribution(spiel_data.team1.tore, spiel_data.team2.tore)
            new_contribution_team2 = get_stats_contribution(spiel_data.team2.tore, spiel_data.team1.tore)

            # Update Team1
            await update_team_statistik(
                teams_collection=teams_collection,
                old_team_id=old_game_data.team1.team_id,
                new_team_id=spiel_data.team1.team_id,
                old_team_contribution=old_contribution_team1,
                new_team_contribution=new_contribution_team1,
                session=session,
            )
            # Update Team2
            await update_team_statistik(
                teams_collection=teams_collection,
                old_team_id=old_game_data.team2.team_id,
                new_team_id=spiel_data.team2.team_id,
                old_team_contribution=old_contribution_team2,
                new_team_contribution=new_contribution_team2,
                session=session,
            )

    return JSONResponse(
        content={
            "acknowledged": 1,
        },
        status_code=status.HTTP_200_OK,
    )


@router.post("/post_spielort", response_model=FLPostSpielortResponse, summary="Create a Spielort")
async def post_spielort(
    spielort_data: Annotated[FLPostSpielortPayload, Body()],
    spielorte_collection: SpielorteCollection,
) -> FLPostSpielortResponse:
    """
    Create a venue.

    `maps_link` is built server-side from the name and address and must not be submitted. Despite the
    name it is a Google Maps search string, not a URL.
    """

    maps_link = f"{spielort_data.name}, {spielort_data.address.to_string}, Deutschland"

    post_operation = await post_one_to_db(
        collection=spielorte_collection,
        document={**spielort_data.model_dump(mode="json"), "maps_link": maps_link, "is_inactive": False},
    )

    return FLPostSpielortResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=post_operation.inserted_id,
    )


@router.patch("/patch_spielort", response_model=FLPatchSpielortResponse, summary="Update a Spielort and fan the change out")
async def patch_spielort(
    spielort_data: Annotated[FLPatchSpielortPayload, Body()], spielorte_collection: SpielorteCollection, spiele_collection: SpieleCollection
) -> FLPatchSpielortResponse:
    """
    Update a venue, then update every Spiel that embeds it.

    Matches carry an embedded copy of the venue's name and maps link, so the fan-out is not optional:
    without it, match cards keep showing the old name indefinitely.
    """
    maps_link = f"{spielort_data.name}, {spielort_data.address.to_string}, Deutschland"

    updated_document_raw = await patch_one_in_db(
        collection=spielorte_collection,
        filter={"_id": spielort_data.id},
        update={"$set": {**spielort_data.model_dump(mode="json", exclude={"id"}), "maps_link": maps_link}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(
            filter={"_id": spielort_data.id},
            error_code="DB-COMMON-001",
        )
    updated_document = FLSpielort(**updated_document_raw)

    # Fan-out the update to all Games that use this Spielort
    await patch_many_in_db(
        collection=spiele_collection,
        filter={"ort.spielort_id": updated_document.id},
        update={"$set": {"ort.maps_link": updated_document.maps_link, "ort.name": updated_document.name}},
    )

    return FLPatchSpielortResponse(updated_document=updated_document)


@router.delete("/delete_spielort", response_model=FLDeleteSpielortResponse, summary="Deactivate a Spielort (soft delete)")
async def delete_spielort(
    spielort_data: Annotated[FLDeleteSpielortPayload, Body()],
    spielorte_collection: SpielorteCollection,
) -> FLDeleteSpielortResponse:
    """
    Deactivate a venue. This is a SOFT delete: it sets `is_inactive`, and the document stays.

    Matches embed a copy of the venue, so a hard delete would orphan every historical match that used
    it. Returns the updated document rather than a bare acknowledgement.
    """

    updated_document_raw = await patch_one_in_db(
        collection=spielorte_collection,
        filter={"_id": spielort_data.id},
        update={"$set": {"is_inactive": True}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(
            filter={"_id": spielort_data.id},
            error_code="DB-COMMON-001",
        )
    updated_document = FLSpielort(**updated_document_raw)

    return FLDeleteSpielortResponse(updated_document=updated_document)


@router.post("/post_schiedsrichter", response_model=FLPostSchiedsrichterResponse, summary="Create a Schiedsrichter")
async def post_schiedsrichter(
    schiedsrichter_data: Annotated[FLPostSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLPostSchiedsrichterResponse:
    """Create a referee. `is_inactive` is set to False here and is not part of the payload."""

    post_operation = await post_one_to_db(
        collection=schiedsrichter_collection,
        document={**schiedsrichter_data.model_dump(mode="json"), "is_inactive": False},
    )

    return FLPostSchiedsrichterResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=post_operation.inserted_id,
    )


@router.patch("/patch_schiedsrichter", response_model=FLPatchSchiedsrichterResponse, summary="Update a Schiedsrichter and fan the change out")
async def patch_schiedsrichter(
    schiedsrichter_data: Annotated[FLPatchSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
) -> FLPatchSchiedsrichterResponse:
    """
    Update a referee, then update the embedded name on every Spiel that uses them.

    Only the name is fanned out. `payment` is deliberately not propagated: the fee recorded on a match
    is what was agreed for that match, and rewriting it would rewrite history.
    """

    updated_document_raw = await patch_one_in_db(
        collection=schiedsrichter_collection,
        filter={"_id": schiedsrichter_data.id},
        update={"$set": {**schiedsrichter_data.model_dump(mode="json", exclude={"id"})}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(
            filter={"_id": schiedsrichter_data.id},
            error_code="DB-COMMON-001",
        )
    updated_document = FLSchiedsrichter(**updated_document_raw)

    # Fan-out the update to all Games that use this Spielort
    await patch_many_in_db(
        collection=spiele_collection,
        filter={"schiedsrichter.schiedsrichter_id": updated_document.id},
        update={"$set": {"schiedsrichter.name": updated_document.name}},
    )

    return FLPatchSchiedsrichterResponse(updated_document=updated_document)


@router.delete("/delete_schiedsrichter", response_model=FLDeleteSchiedsrichterResponse, summary="Deactivate a Schiedsrichter (soft delete)")
async def delete_schiedsrichter(
    schiedsrichter_data: Annotated[FLDeleteSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLDeleteSchiedsrichterResponse:
    """Deactivate a referee. SOFT delete, for the same reason as venues: matches embed a copy."""

    updated_document_raw = await patch_one_in_db(
        collection=schiedsrichter_collection,
        filter={"_id": schiedsrichter_data.id},
        update={"$set": {"is_inactive": True}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(
            filter={"_id": schiedsrichter_data.id},
            error_code="DB-COMMON-001",
        )
    updated_document = FLSchiedsrichter(**updated_document_raw)

    return FLDeleteSchiedsrichterResponse(updated_document=updated_document)
