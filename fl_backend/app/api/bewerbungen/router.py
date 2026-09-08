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
from app.api.bewerbungen.services import (
    WITHOUT_TOKEN_HASHES,
    build_bewerbungen_saison_term,
    build_bewerbungen_saisonbezug_terms,
    build_bewerbungen_sort,
    build_bewerbungen_status_term,
    build_dubletten_pipeline,
    dubletten_schluessel_of,
)
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, pull_many_from_db, pull_one_from_db
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

    `saisonbezug` says which side of `saison_id` this read covers — `diese_saison` for that season,
    `andere_saison` for every other one — and is ignored without a `saison_id` to stand against.
    Both values is every season, as omitting the parameter is; `saison_id` alone is that season.

    `anzahl_je_status` counts every status over the seasons this request selected and never over the
    statuses it named, and `anzahl_je_saisonbezug` counts each side of the season relation over those
    statuses and never over the relation, so a caller narrowed to one of either still knows what
    asking for the other would fetch. Repeating a parameter and comma-joining its values are one
    request; omitting one is every value, and sending it empty is too.

    `dubletten_schluessel` names every key two or more OPEN applications share, over every season the
    request selected rather than over the rows served, so a colliding pair the cap parted is named at
    both ends; a key carries its own season, so no selection can part one. A key
    is the season and the club id, or the season and the upper-cased Kürzel, parted by the word
    `team` or `kuerzel`; a caller composes a served row's own key and marks the row where the two
    match.
    """

    # The season term alone, because each count answers for the status it names: counted with the
    # request's own status term applied, every status the caller did not ask for would read zero.
    beyond_status = build_bewerbungen_saison_term(saison_id=filters.saison_id, saisonbezug=filters.saisonbezug)
    # And the mirror: a relation counted with the season term applied would read zero for the side
    # the read left out, leaving the other season's queue reachable from nothing on this page.
    beyond_saison = build_bewerbungen_status_term(filters.status)
    saisonbezug_terms = build_bewerbungen_saisonbezug_terms(saison_id=filters.saison_id)

    # Concurrently, so five counts and the collision pass cost one round trip's latency rather than six.
    counted, bezogen, cells = await asyncio.gather(
        asyncio.gather(
            # `bewerbungen_saison_id_status_queue` carries both terms, so a count walks keys and
            # fetches nothing; measured, the complement loses the COUNT_SCAN and stays an IXSCAN.
            *(bewerbungen_collection.count_documents({**beyond_status, "status": status}) for status in get_args(FLBewerbungStatus))
        ),
        asyncio.gather(*(bewerbungen_collection.count_documents({**beyond_saison, **term}) for term in saisonbezug_terms.values())),
        aggregate_many_from_db(collection=bewerbungen_collection, pipeline=build_dubletten_pipeline(beyond_status)),
    )

    # One row over what is served, and the extra never is: it answers whether the list is whole
    # without a count, and counting the filtered set is the unbounded work this read must not do.

    # The projection keeps the token hashes from crossing the wire at all, where the read model
    # would drop them only after they had (`app/api/bewerbungen/public_router.py :: get_schulen`).
    read = await pull_many_from_db(
        collection=bewerbungen_collection,
        db_filter={**beyond_status, **beyond_saison},
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
        anzahl_je_saisonbezug=dict(zip(saisonbezug_terms, bezogen, strict=True)),
        dubletten_schluessel=dubletten_schluessel_of(cells),
    )


@router.get(by_id("bewerbung_id"), response_model=FLBewerbungSingleResponse, summary="One Bewerbung")
async def get_bewerbung_by_id(
    bewerbung_id: CustomRouteObjectId,
    bewerbungen_collection: BewerbungenCollection,
) -> FLBewerbungSingleResponse:
    """One application in full, which is what the triage decides against."""

    bewerbung_raw = await pull_one_from_db(collection=bewerbungen_collection, db_filter={"_id": bewerbung_id}, projection=WITHOUT_TOKEN_HASHES)

    return FLBewerbungSingleResponse(bewerbung=FLBewerbung(**bewerbung_raw))
