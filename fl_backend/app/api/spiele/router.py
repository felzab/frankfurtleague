from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_current_saison_id
from app.api.saisons.visibility import refuse_withheld_saison, saison_is_withheld
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

    Omitting `saison_id` returns the CURRENT season; one this tier may not read lists nothing.
    `saison_phase` aliases `playoffs` to "any phase but gruppenphase"; `ausstehend` includes today.
    """

    # Resolved here, never as a field default, which cannot reach the database.
    if filters.saison_id is None:
        filters.saison_id = await pull_current_saison_id(saisons_collection=saisons_collection)

    # Only where the caller NAMED one: the resolve above answers with the `active` season or 404s.
    # Empty rather than 404, because an id naming no season already lists nothing here and a
    # withheld one must not read differently.
    elif await saison_is_withheld(saisons_collection=saisons_collection, saison_id=filters.saison_id):
        return FLSpieleListResponse(spiele=[])

    db_filter = build_spiele_filter(filters=filters, today=today)
    db_sort = build_spiele_sort(sort_by=filters.sort_by, order=filters.order)

    # An aggregation, not a find: a plain `find` misses the joined `austritt` and returns a
    # shape `FLSpielJoined` refuses.
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(db_filter=db_filter, sort_by=db_sort, limit=filters.limit),
        limit=filters.limit,
    )
    spiele = FLSpielJoinedListAdapter.validate_python(spiele_raw)

    return FLSpieleListResponse(spiele=spiele)


@router.get(by_id("spiel_id"), response_model=FLSpieleSingleResponse, summary="One Spiel")
async def get_spiel(
    spiel_id: CustomRouteObjectId,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
) -> FLSpieleSingleResponse:
    """
    Return one match by its id.

    The season is read to gate it and for nothing else: the match carries its own `saison_id`, and
    `spiel_status` is a property of a query. 404 for a season this tier may not read.
    """

    # The 404 is raised here because an aggregation returning nothing is an empty list, not `None`.
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(db_filter={"_id": spiel_id}),
        limit=1,
    )
    if not spiele_raw:
        raise DocumentNotFoundException(filter={"_id": spiel_id}, error_code=DOCUMENT_NOT_FOUND)

    # The fixture's OWN season, after the read: a match of a season being drawn up then misses for
    # the same reason an id naming no match does.
    await refuse_withheld_saison(saisons_collection=saisons_collection, saison_id=str(spiele_raw[0]["saison_id"]))

    return FLSpieleSingleResponse(spiel=FLSpielJoined.model_validate(spiele_raw[0]))
