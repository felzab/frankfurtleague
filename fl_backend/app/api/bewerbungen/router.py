import asyncio
from typing import Annotated, get_args

from fastapi import APIRouter, Depends, Query

from app.api.bewerbungen.schemas import (
    FLBewerbung,
    FLBewerbungenFilterParams,
    FLBewerbungenListResponse,
    FLBewerbungListAdapter,
    FLBewerbungSingleResponse,
    FLBewerbungStatus,
)
from app.api.bewerbungen.services import WITHOUT_TOKEN_HASHES, build_bewerbungen_sort, build_bewerbungen_status_term
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

# `Query()` and never `Depends()`: on a `Depends()` model a `list` field is read as a BODY field, so
# it publishes no query parameter at all and answers `None` whatever the query string holds.
FLBewerbungenFilters = Annotated[FLBewerbungenFilterParams, Query()]


@router.get("", response_model=FLBewerbungenListResponse, summary="List Bewerbungen")
async def get_bewerbungen(
    bewerbungen_collection: BewerbungenCollection,
    filters: FLBewerbungenFilters,
) -> FLBewerbungenListResponse:
    """
    Every application, newest first, narrowable by season and by any number of the three statuses.

    Decided ones stay listed: what the league turned down, and why, is the record the decision was
    taken against. `vollstaendig` is false where more rows exist than one read serves.

    `anzahl_je_status` counts every status over the season this request named and never over the
    statuses it named, so a caller that narrowed to one still knows what asking for another would
    fetch. Repeating the parameter and comma-joining its values are one request; omitting it is every
    status, and sending it empty is too.
    """

    # The season term alone, because each count answers for the status it names: counted with the
    # request's own status term applied, every status the caller did not ask for would read zero.
    beyond_status = build_query(filters, terms={"saison_id"})

    # Concurrently, so three counts cost one round trip's latency rather than three. Each is a
    # COUNT_SCAN off `bewerbungen_status_queue`'s leading key, which walks keys and fetches nothing.
    counted = await asyncio.gather(
        *(bewerbungen_collection.count_documents({**beyond_status, "status": status}) for status in get_args(FLBewerbungStatus))
    )

    # One row over what is served, and the extra never is: it answers whether the list is whole
    # without a count, and counting the filtered set is the unbounded work this read must not do.

    # The projection keeps the token hashes from crossing the wire at all, where the read model
    # would drop them only after they had (`app/api/bewerbungen/public_router.py :: get_schulen`).
    read = await pull_many_from_db(
        collection=bewerbungen_collection,
        db_filter={**beyond_status, **build_bewerbungen_status_term(filters.status)},
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
        anzahl_je_status=dict(zip(get_args(FLBewerbungStatus), counted, strict=True)),
    )


@router.get(by_id("bewerbung_id"), response_model=FLBewerbungSingleResponse, summary="One Bewerbung")
async def get_bewerbung_by_id(
    bewerbung_id: CustomRouteObjectId,
    bewerbungen_collection: BewerbungenCollection,
) -> FLBewerbungSingleResponse:
    """One application in full, which is what the triage decides against."""

    bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, projection=WITHOUT_TOKEN_HASHES)

    return FLBewerbungSingleResponse(bewerbung=FLBewerbung(**bewerbung_raw))
