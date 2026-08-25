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
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

# Admin-guarded, not base. `default_mietpreis` is money (`READ-MONEY-001`) and the only field
# withheld: `address` moves with it because no public page reads the parts, not to hide them --
# `maps_link` publishes the address whole (`READ-ADDRESS-001`).
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielorte",
    dependencies=[Depends(verify_access_admin)],
)


@router.get("", response_model=FLSpielorteListResponse, summary="List Spielorte")
async def get_spielorte(
    spielorte_collection: SpielorteCollection,
    filters: FLSpielorteFilterParams = Depends(),
) -> FLSpielorteListResponse:
    """An admin-tier read: the rent is money (`READ-MONEY-001`) and the address parts serve no public page (`READ-ADDRESS-001`).

    Deactivated venues stay retrievable for a historical match. `maps_link` is a Maps search string, not a URL.
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
    """Admin-tier as the list is, and for the same two rules (`READ-MONEY-001`, `READ-ADDRESS-001`).

    Deactivated ones included -- a historical match's venue is the case worth answering.
    """

    spielort_raw = await pull_one_from_db(collection=spielorte_collection, db_filter={"_id": spielort_id})

    return FLSpielorteSingleResponse(spielort=FLSpielort(**spielort_raw))
