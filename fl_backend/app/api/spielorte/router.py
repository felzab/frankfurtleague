"""
SPIELORTE · read endpoint

Venues. Read-only; create, update and delete are admin-authorized and live in the admin router.

Invariants:
- Deletion is soft (`inactive_since`, ADR-0025); retired venues stay readable.
- `maps_link` is free text — a Google Maps search string, not a URL; never render it into an href.
- `default_mietpreis` is whole euros with no default: the patch writes wholesale, so one zeroes rents.
"""

from fastapi import APIRouter, Depends

from app.api.spielorte.schemas import (
    FLSpielort,
    FLSpielorteFilterParams,
    FLSpielorteListAdapter,
    FLSpielorteListResponse,
    FLSpielorteSingleResponse,
)
from app.api.spielorte.services import build_spielorte_filter, build_spielorte_sort
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db, pull_one_from_db
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

    Deactivated venues are soft-deleted rather than removed, so they remain retrievable for historical
    matches. `maps_link` is a Maps search string, not a URL.
    """

    db_filter = build_spielorte_filter(filters=filters)
    db_sort = build_spielorte_sort(sort_by=filters.sort_by, order=filters.order)

    spielorte_raw = await pull_many_from_db(
        collection=spielorte_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    spielorte = FLSpielorteListAdapter.validate_python(spielorte_raw)

    return FLSpielorteListResponse(spielorte=spielorte)


@router.get(by_id("spielort_id"), response_model=FLSpielorteSingleResponse, summary="One Spielort")
async def get_spielort(spielort_id: CustomRouteObjectId, spielorte_collection: SpielorteCollection) -> FLSpielorteSingleResponse:
    """
    Return one venue by its id, deactivated ones included.

    A caller holding an id was given it by something, and a historical match's venue is exactly the
    case worth answering.
    """

    spielort_raw = await pull_one_from_db(collection=spielorte_collection, db_filter={"_id": spielort_id})

    return FLSpielorteSingleResponse(spielort=FLSpielort(**spielort_raw))
