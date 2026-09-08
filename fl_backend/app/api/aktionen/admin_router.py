import asyncio
from typing import Annotated, Any, Final, Mapping, Sequence

from fastapi import APIRouter, Depends, Query
from pymongo import ASCENDING

from app.api.aktionen.schemas import (
    HERKUNFT_JE_KIND,
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

# One `$group` over the three the bar narrows on: every dimension's counts off a single pass, and a
# row per (area, operation, kind) the log holds.
FACET_TALLY: Final[Sequence[Mapping[str, Any]]] = (
    # Asked for in `aktionen_facets`'s key order, which is what makes the planner reach for it: the
    # `$group` alone scans the log, images and all
    # (`fl_backend/tests/core/test_constraints_execution.py :: AKTIONEN_TALLY_FILTERS`).
    {"$sort": {"collection": ASCENDING, "operation": ASCENDING, "actor.kind": ASCENDING}},
    {
        "$group": {
            "_id": {"collection": "$collection", "operation": "$operation", "kind": "$actor.kind"},
            "anzahl": {"$sum": 1},
        }
    },
)


def _facet_term(field: str, picked: Sequence[str] | None) -> dict[str, Any]:
    """`$in` rather than an equality, so a bar that offers every area has a request expressing any two of them."""

    return {} if picked is None else {field: {"$in": list(picked)}}


def _herkunft_term(picked: Sequence[str] | None) -> dict[str, Any]:
    """The kinds the picked origins are filed under, since `herkunft` names no stored field.

    Derived from `HERKUNFT_JE_KIND` rather than listed, so a kind placed there is narrowed on without
    a second edit here.
    """

    if picked is None:
        return {}

    return _facet_term("actor.kind", [kind for kind, herkunft in HERKUNFT_JE_KIND.items() if herkunft in picked])


def _facet_cells(grouped: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """`$group` omits a key whose path did not resolve, so a row missing a field reads as `None` here.

    Counted for the dimensions it does carry rather than taking the whole page down.
    """

    cells: list[dict[str, Any]] = []
    for cell in grouped:
        pair = cell["_id"]
        kind = pair.get("kind")
        cells.append(
            {
                "collection": pair.get("collection"),
                "operation": pair.get("operation"),
                # Folded once here rather than inside each tally. `None` where no category names the
                # kind, which belongs under no origin and still counts for its area.
                "herkunft": None if kind is None else HERKUNFT_JE_KIND.get(str(kind)),
                "anzahl": cell["anzahl"],
            }
        )

    return cells


def _tally(cells: Sequence[Mapping[str, Any]], *, counted: str, held: Mapping[str, Sequence[str] | None]) -> dict[str, int]:
    """Each value of `counted`, over the cells every other dimension's selection keeps.

    Its own selection is excluded, so an option answers what picking it would leave rather than what
    the page already shows.
    """

    totals: dict[str, int] = {}
    for cell in cells:
        if any(picked is not None and cell[dimension] not in picked for dimension, picked in held.items()):
            continue

        value = cell[counted]
        # Skipped rather than bucketed under an origin: `_herkunft_term` narrows on the kinds a
        # category names, so a bucketed one would count rows the term cannot fetch.
        if value is None:
            continue

        totals[value] = totals.get(value, 0) + cell["anzahl"]

    return totals


@router.get("", response_model=FLAktionenListResponse, summary="List recorded admin actions")
async def get_aktionen(
    aktionen_collection: AktionenCollection,
    filters: FLAktionenFilters,
) -> FLAktionenListResponse:
    """List what administrators changed, newest first; `vollstaendig` is false on a cut answer.

    Admin-tier twice over: every recorded write across every collection is here, public or not,
    and each row names the administrator behind it.

    `collection`, `operation` and `herkunft` each take a comma-joined selection, or the parameter
    repeated, and all three narrow this read. `herkunft` names no stored field: it is the category the
    actor's kind is filed under, `person` covering every kind that authenticates somebody.

    `anzahl_je_collection`, `anzahl_je_operation` and `anzahl_je_herkunft` count every row `trace_id`
    and `document_id` leave, with the other two facets applied and their own ignored, so a caller
    narrowed to one area still knows what asking for another would fetch; a value nothing was recorded
    under is absent rather than zero. While either of those two terms is in force the counts are that
    trace's or that document's and not the log's.

    `trace_id` selects one request's whole fan-out, which this read serves under the same cap as any
    other; a write made outside a request carries the sentinel `SYSTEM` there, which gathers every
    such write rather than one (`docs/glossary.md :: Vorgangsnummer`).
    """

    # Every term the three facets do not write, so the tally below narrows by these and by nothing else.
    beyond_the_facets = build_query(filters, terms={"trace_id"}, compiled=document_id_term(filters.document_id))

    # Gathered, so the tally costs no round trip of its own.
    grouped, read = await asyncio.gather(
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
                **_herkunft_term(filters.herkunft),
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
    cells = _facet_cells(grouped)

    return FLAktionenListResponse(
        aktionen=FLAktionenListAdapter.validate_python(served),
        vollstaendig=len(read) <= filters.limit,
        anzahl_je_collection=_tally(cells, counted="collection", held={"operation": filters.operation, "herkunft": filters.herkunft}),
        anzahl_je_operation=_tally(cells, counted="operation", held={"collection": filters.collection, "herkunft": filters.herkunft}),
        anzahl_je_herkunft=_tally(cells, counted="herkunft", held={"collection": filters.collection, "operation": filters.operation}),
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
