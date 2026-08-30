from fastapi import APIRouter, Depends

from app.api.aktionen.schemas import FLAktionenFilterParams, FLAktionenListAdapter, FLAktionenListResponse
from app.api.aktionen.services import build_aktionen_sort
from app.core.config import API_VERSION
from app.core.crud import build_query, pull_many_from_db
from app.core.dependencies import AktionenCollection
from app.core.security import bind_actor, verify_access_admin

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/aktionen",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


@router.get("", response_model=FLAktionenListResponse, summary="List recorded admin actions")
async def get_aktionen(
    aktionen_collection: AktionenCollection,
    filters: FLAktionenFilterParams = Depends(),
) -> FLAktionenListResponse:
    """List what administrators changed, newest first.

    Admin-tier for the obvious reason and one less obvious: a row carries the document a write
    replaced, so this read answers with data from every collection at once, public or not.
    """

    aktionen_raw = await pull_many_from_db(
        collection=aktionen_collection,
        db_filter=build_query(filters, terms={"collection", "operation", "correlation_id"}),
        limit=filters.limit,
        sort_by=build_aktionen_sort(order=filters.order),
    )

    return FLAktionenListResponse(aktionen=FLAktionenListAdapter.validate_python(aktionen_raw))
