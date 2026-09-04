from fastapi import APIRouter, Depends

from app.api.bewerbungen.schemas import (
    FLBewerbung,
    FLBewerbungenFilterParams,
    FLBewerbungenListResponse,
    FLBewerbungListAdapter,
    FLBewerbungSingleResponse,
)
from app.api.bewerbungen.services import WITHOUT_TOKEN_HASHES, build_bewerbungen_sort
from app.core.config import API_VERSION
from app.core.crud import build_query, pull_many_from_db, pull_one_from_db
from app.core.dependencies import BewerbungenCollection
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

# Admin-guarded, not base, as `schiedsrichter` is: an application carries three people's names,
# addresses, telephone numbers and dates of birth (`READ-CONTACT-001`), and says which schools
# asked and were turned down.

# `public_router.py` shares this prefix at base tier and reads no stored application.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen",
    dependencies=[Depends(verify_access_admin)],
)


@router.get("", response_model=FLBewerbungenListResponse, summary="List Bewerbungen")
async def get_bewerbungen(
    bewerbungen_collection: BewerbungenCollection,
    filters: FLBewerbungenFilterParams = Depends(),
) -> FLBewerbungenListResponse:
    """
    Every application, newest first, narrowable by season and by status.

    Decided ones stay listed: what the league turned down, and why, is the record the decision was
    taken against. `vollstaendig` is false where more rows exist than one read serves.
    """

    # One row over what is served, and the extra never is: it answers whether the list is whole
    # without a count, and counting the filtered set is the unbounded work this read must not do.

    # The projection keeps the token hashes from crossing the wire at all, where the read model
    # would drop them only after they had (`app/api/bewerbungen/public_router.py :: get_schulen`).
    read = await pull_many_from_db(
        collection=bewerbungen_collection,
        db_filter=build_query(filters, terms={"saison_id", "status"}),
        limit=filters.limit + 1,
        sort_by=build_bewerbungen_sort(sort_by=filters.sort_by, order=filters.order),
        projection=WITHOUT_TOKEN_HASHES,
    )

    # Sliced before validation, so the probe row is never parsed and never reaches the wire.
    served = read[: filters.limit]

    # Degrades rather than refusing: the rows are written by an anonymous public form, so a tripwire
    # would hand whoever writes them the power to 500 this page. Answering short leaves the
    # administrator a usable list, and `vollstaendig` reports the cut.
    return FLBewerbungenListResponse(
        bewerbungen=FLBewerbungListAdapter.validate_python(served),
        vollstaendig=len(read) <= filters.limit,
    )


@router.get(by_id("bewerbung_id"), response_model=FLBewerbungSingleResponse, summary="One Bewerbung")
async def get_bewerbung_by_id(
    bewerbung_id: CustomRouteObjectId,
    bewerbungen_collection: BewerbungenCollection,
) -> FLBewerbungSingleResponse:
    """One application in full, which is what the triage decides against."""

    bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, projection=WITHOUT_TOKEN_HASHES)

    return FLBewerbungSingleResponse(bewerbung=FLBewerbung(**bewerbung_raw))
