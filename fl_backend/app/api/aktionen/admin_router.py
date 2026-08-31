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
    """List what administrators changed, newest first; `vollstaendig` is false on a cut answer.

    Admin-tier twice over: a row carries the document a write replaced, so this read answers
    with data from every collection at once, public or not.
    """

    # One row past what is served, `get_bewerbungen`'s shape (`docs/backend/spec.md :: I45`): the
    # log only grows, so the cap arrives by ordinary use, and a short page must say so.
    read = await pull_many_from_db(
        collection=aktionen_collection,
        db_filter=build_query(filters, terms={"collection", "operation", "correlation_id"}),
        limit=filters.limit + 1,
        sort_by=build_aktionen_sort(order=filters.order),
    )

    # Sliced before validation, so the probe row is never parsed and never reaches the wire.
    served = read[: filters.limit]

    return FLAktionenListResponse(
        aktionen=FLAktionenListAdapter.validate_python(served),
        vollstaendig=len(read) <= filters.limit,
    )
