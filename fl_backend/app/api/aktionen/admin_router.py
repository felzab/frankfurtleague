import asyncio
from typing import Annotated, Any, Final, Mapping, Sequence

from fastapi import APIRouter, Depends, Query

from app.api.aktionen.schemas import (
    FLAktionenFilterParams,
    FLAktionenListAdapter,
    FLAktionenListResponse,
    FLAktionMitStand,
    FLAktionSingleResponse,
)
from app.api.aktionen.services import build_aktionen_sort, document_id_term
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, build_query, pull_many_from_db, pull_one_from_db
from app.core.dependencies import AktionenCollection
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/aktionen",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)

# `Query()` and never `Depends()`: on a `Depends()` model a `list` field is read as a BODY field, so
# it publishes no query parameter at all and answers `None` whatever the query string holds.
FLAktionenFilters = Annotated[FLAktionenFilterParams, Query()]

# One `$group` over the pair the bar narrows on: both dimensions' counts off a single pass, and a row
# per (area, operation) the log holds.
FACET_TALLY: Final[Sequence[Mapping[str, Any]]] = (
    {"$group": {"_id": {"collection": "$collection", "operation": "$operation"}, "anzahl": {"$sum": 1}}},
)


def _facet_term(field: str, picked: Sequence[str] | None) -> dict[str, Any]:
    """`$in` rather than an equality, so a bar that offers every area has a request expressing any two of them."""

    return {} if picked is None else {field: {"$in": list(picked)}}


def _tally(cells: Sequence[Mapping[str, Any]], *, counted: str, held: str, picked: Sequence[str] | None) -> dict[str, int]:
    """Each value of `counted`, over the cells the other dimension's selection keeps.

    Its own selection is excluded, so an option answers what picking it would leave rather than what
    the page already shows.
    """

    totals: dict[str, int] = {}
    for cell in cells:
        pair = cell["_id"]
        if picked is not None and pair[held] not in picked:
            continue
        totals[pair[counted]] = totals.get(pair[counted], 0) + cell["anzahl"]

    return totals


@router.get("", response_model=FLAktionenListResponse, summary="List recorded admin actions")
async def get_aktionen(
    aktionen_collection: AktionenCollection,
    filters: FLAktionenFilters,
) -> FLAktionenListResponse:
    """List what administrators changed, newest first; `vollstaendig` is false on a cut answer.

    Admin-tier twice over: every recorded write across every collection is here, public or not,
    and each row names the administrator behind it.

    `collection` and `operation` each take a comma-joined selection, or the parameter repeated, and
    both narrow this read. `anzahl_je_collection` and `anzahl_je_operation` count the WHOLE log with
    the other of the two applied and their own ignored, so a caller narrowed to one area still knows
    what asking for another would fetch; a value nothing was recorded under is absent rather than
    zero. `trace_id` selects one request's whole fan-out, which the log answers complete.
    """

    # Every term the two facets do not write, so the tally below narrows by these and by nothing else.
    beyond_the_facets = build_query(filters, terms={"trace_id"}, compiled=document_id_term(filters.document_id))

    # Gathered, so the tally costs no round trip of its own.
    cells, read = await asyncio.gather(
        # Counted per option instead, this is a read per option, and `aktionen_target` indexes the
        # area alone: every operation's own count would scan the log.
        aggregate_many_from_db(
            collection=aktionen_collection,
            pipeline=[{"$match": beyond_the_facets}, *FACET_TALLY],
        ),
        pull_many_from_db(
            collection=aktionen_collection,
            db_filter={
                **beyond_the_facets,
                **_facet_term("collection", filters.collection),
                **_facet_term("operation", filters.operation),
            },
            # One row past what is served, `get_bewerbungen`'s shape (`docs/backend/spec.md :: I45`):
            # the log holds twelve months of recorded writes, and whether that reaches the cap is
            # what the extra row answers.
            limit=filters.limit + 1,
            sort_by=build_aktionen_sort(order=filters.order),
        ),
    )

    # Sliced before validation, so the probe row is never parsed and never reaches the wire.
    served = read[: filters.limit]

    return FLAktionenListResponse(
        aktionen=FLAktionenListAdapter.validate_python(served),
        vollstaendig=len(read) <= filters.limit,
        anzahl_je_collection=_tally(cells, counted="collection", held="operation", picked=filters.operation),
        anzahl_je_operation=_tally(cells, counted="operation", held="collection", picked=filters.collection),
    )


@router.get(by_id("aktion_id"), response_model=FLAktionSingleResponse, summary="One recorded admin action")
async def get_aktion_by_id(
    aktion_id: CustomRouteObjectId,
    aktionen_collection: AktionenCollection,
) -> FLAktionSingleResponse:
    """One row with the document its write replaced, which the list withholds.

    The read a restore of one write would start from.
    """

    aktion_raw = await pull_one_from_db(collection=aktionen_collection, db_filter={"_id": aktion_id})

    return FLAktionSingleResponse(aktion=FLAktionMitStand(**aktion_raw))
