from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_current_saison_id
from app.api.spiele.schemas import (
    FLSpieleFilterParams,
    FLSpieleListResponse,
    FLSpieleSingleResponse,
    FLSpielJoined,
    FLSpielJoinedListAdapter,
)
from app.api.spiele.services import build_spiele_filter, build_spiele_pipeline, build_spiele_sort
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import SaisonsCollection, SpieleCollection, get_german_date_str
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spiele",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSpieleListResponse, summary="List Spiele")
async def get_spiele(
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieleFilterParams = Depends(),
    today: str = Depends(get_german_date_str),
) -> FLSpieleListResponse:
    """
    List Spiele matching the given filters.

    Omitting `saison_id` returns the CURRENT season. `saison_phase` accepts `playoffs` as an alias
    for "any phase except gruppenphase", and `ausstehend` includes today.
    """

    # Resolved here, never as a field default, which cannot reach the database.
    if filters.saison_id is None:
        filters.saison_id = await pull_current_saison_id(saisons_collection=saisons_collection)

    db_filter = build_spiele_filter(filters=filters, today=today)
    db_sort = build_spiele_sort(sort_by=filters.sort_by, order=filters.order)

    # An aggregation, not a find: a plain `find` misses the joined `disqualifikation` and returns a
    # shape `FLSpielJoined` refuses.
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(db_filter=db_filter, sort_by=db_sort, limit=filters.limit),
        limit=filters.limit,
    )
    spiele = FLSpielJoinedListAdapter.validate_python(spiele_raw)

    return FLSpieleListResponse(spiele=spiele)


@router.get(by_id("spiel_id"), response_model=FLSpieleSingleResponse, summary="One Spiel")
async def get_spiel(spiel_id: CustomRouteObjectId, spiele_collection: SpieleCollection) -> FLSpieleSingleResponse:
    """
    Return one match by its id.

    No season is resolved and no status derived: the match carries its own `saison_id`, and
    `spiel_status` is a property of a query rather than of a match.
    """

    # The 404 is raised here because an aggregation returning nothing is an empty list, not `None`.
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(db_filter={"_id": spiel_id}),
        limit=1,
    )
    if not spiele_raw:
        raise DocumentNotFoundException(filter={"_id": spiel_id}, error_code=DOCUMENT_NOT_FOUND)

    return FLSpieleSingleResponse(spiel=FLSpielJoined.model_validate(spiele_raw[0]))
