from fastapi import APIRouter, Depends

from app.api.bewerbungen.schemas import (
    FLBewerbung,
    FLBewerbungenFilterParams,
    FLBewerbungenListResponse,
    FLBewerbungListAdapter,
    FLBewerbungSingleResponse,
)
from app.core.config import API_VERSION
from app.core.crud import build_query, build_sort, pull_many_from_db, pull_one_from_db
from app.core.dependencies import BewerbungenCollection
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
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
    taken against.
    """

    # Null is the caller naming no bound; a named `limit` bounds its own read and trips nothing.
    requested = filters.limit

    bewerbungen_raw = await pull_many_from_db(
        collection=bewerbungen_collection,
        db_filter=build_query(filters, terms={"saison_id", "status"}),
        limit=LIST_LIMIT_DEFAULT + 1 if requested is None else requested,
        # `_id` breaks the tie: two applications can arrive on one day, and an order moving between
        # two reads is one nobody can work down. Descending, as the log's is: ascending reads two
        # same-day rows backwards inside a newest-first queue.
        sort_by=build_sort(sort_by=filters.sort_by, order=filters.order, chain=(("_id", -1),)),
    )

    # One over the cap, as `withheld_saison_ids` asks (`docs/backend/spec.md :: I45`): the archive
    # never shrinks, and newest-first drops the OLDEST rows -- an early season would read back empty
    # as though the filter had answered it.
    if requested is None and len(bewerbungen_raw) > LIST_LIMIT_DEFAULT:
        # 500 `SRV-FAIL-001`, as the sibling tripwires answer. Serving the list flagged PARTIAL would
        # need a field on the response shape, which is not this change's to decide.
        raise ValueError(f"the archive holds more than {LIST_LIMIT_DEFAULT} applications, which is more than one read can list")

    return FLBewerbungenListResponse(bewerbungen=FLBewerbungListAdapter.validate_python(bewerbungen_raw))


@router.get(by_id("bewerbung_id"), response_model=FLBewerbungSingleResponse, summary="One Bewerbung")
async def get_bewerbung_by_id(
    bewerbung_id: CustomRouteObjectId,
    bewerbungen_collection: BewerbungenCollection,
) -> FLBewerbungSingleResponse:
    """One application in full, which is what the triage decides against."""

    bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id})

    return FLBewerbungSingleResponse(bewerbung=FLBewerbung(**bewerbung_raw))
