from fastapi import APIRouter, Depends

from app.api.spielorte.schemas import (
    FLSpielort,
    FLSpielorteFilterParams,
    FLSpielorteListResponse,
    FLSpielorteSingleResponse,
    FLSpielortListAdapter,
)
from app.core.config import API_VERSION
from app.core.crud import build_query, build_sort, pull_many_from_db, pull_one_from_db
from app.core.dependencies import SpielorteCollection
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielorte",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSpielorteListResponse, summary="List Spielorte")
async def get_spielorte(
    spielorte_collection: SpielorteCollection,
    filters: FLSpielorteFilterParams = Depends(),
) -> FLSpielorteListResponse:
    """
    List venues.

    Deactivated venues are soft-deleted rather than removed, so they stay retrievable for historical
    matches. `maps_link` is a Maps search string, not a URL.
    """

    # Empty `terms`: nothing here is matched by value -- `include_inactive` is translated, and
    # the rest is paging and ordering.
    db_filter = build_query(filters, terms=frozenset(), include_inactive=filters.include_inactive)
    db_sort = build_sort(sort_by=filters.sort_by, order=filters.order)

    spielorte_raw = await pull_many_from_db(
        collection=spielorte_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    spielorte = FLSpielortListAdapter.validate_python(spielorte_raw)

    return FLSpielorteListResponse(spielorte=spielorte)


@router.get(by_id("spielort_id"), response_model=FLSpielorteSingleResponse, summary="One Spielort")
async def get_spielort(spielort_id: CustomRouteObjectId, spielorte_collection: SpielorteCollection) -> FLSpielorteSingleResponse:
    """Return one venue by its id, deactivated ones included -- a historical match's venue is the case worth answering."""

    spielort_raw = await pull_one_from_db(collection=spielorte_collection, db_filter={"_id": spielort_id})

    return FLSpielorteSingleResponse(spielort=FLSpielort(**spielort_raw))
