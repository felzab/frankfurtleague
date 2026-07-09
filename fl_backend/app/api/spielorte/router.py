from fastapi import APIRouter, Depends

from app.api.spielorte.schemas import (
    FLSpielorteFilterParams,
    FLSpielorteListAdapter,
    FLSpielorteListResponse,
)
from app.api.spielorte.services import build_spielorte_filter, build_spielorte_sort
from app.core.config import backend_config
from app.core.crud import pull_many_from_db
from app.core.dependencies import SpielorteCollection
from app.core.security import verify_access_base

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/spielorte",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSpielorteListResponse)
async def get_spielorte(
    spielorte_collection: SpielorteCollection,
    filters: FLSpielorteFilterParams = Depends(),
) -> FLSpielorteListResponse:

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
