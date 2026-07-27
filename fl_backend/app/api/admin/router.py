from typing import Annotated

from fastapi import APIRouter, Body, Depends, status
from fastapi.responses import JSONResponse
from pymongo import ReturnDocument

from app.api.admin.services import get_stats_contribution, update_team_statistik
from app.api.schiedsrichter.schemas import FLPostSchiedsrichterPayload, FLPostSchiedsrichterResponse
from app.api.spiele.schemas import FLSpiel, FLSpieleListResponse, FLSpielListAdapter, PatchSpielDataPayload
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


@router.get("/action_required", response_model=FLSpieleListResponse)
async def get_spiele_action_required(spiele_collection: SpieleCollection, today: str = Depends(get_german_date_str)) -> FLSpieleListResponse:

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


@router.patch("/update_spiel_data")
async def patch_spiel_data(
    spiel_data: Annotated[PatchSpielDataPayload, Body()],
    db: DBClient,
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
) -> JSONResponse:

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


@router.post("/post_spielort", response_model=FLPostSpielortResponse)
async def post_spielort(
    spielort_data: Annotated[FLPostSpielortPayload, Body()],
    spielorte_collection: SpielorteCollection,
) -> FLPostSpielortResponse:

    maps_link = f"{spielort_data.name}, {spielort_data.address.to_string}, Deutschland"

    post_operation = await post_one_to_db(
        collection=spielorte_collection,
        document={**spielort_data.model_dump(mode="json"), "maps_link": maps_link, "is_inactive": False},
    )

    return FLPostSpielortResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=post_operation.inserted_id,
    )


@router.patch("/patch_spielort", response_model=FLPatchSpielortResponse)
async def patch_spielort(
    spielort_data: Annotated[FLPatchSpielortPayload, Body()], spielorte_collection: SpielorteCollection, spiele_collection: SpieleCollection
) -> FLPatchSpielortResponse:
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


# This is a soft delete
@router.delete("/delete_spielort", response_model=FLDeleteSpielortResponse)
async def delete_spielort(
    spielort_data: Annotated[FLDeleteSpielortPayload, Body()],
    spielorte_collection: SpielorteCollection,
) -> FLDeleteSpielortResponse:

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


@router.post("/post_schiedsrichter", response_model=FLPostSchiedsrichterResponse)
async def post_schiedsrichter(
    schiedsrichter_data: Annotated[FLPostSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLPostSchiedsrichterResponse:

    post_operation = await post_one_to_db(
        collection=schiedsrichter_collection,
        document=schiedsrichter_data.model_dump(mode="json"),
    )

    return FLPostSchiedsrichterResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=post_operation.inserted_id,
    )
