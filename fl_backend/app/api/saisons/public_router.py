import asyncio
from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter, Depends
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.crud import pull_active_saison
from app.api.saisons.schemas import (
    FLSaison,
    FLSaisonFrameEntryListAdapter,
    FLSaisonFrameResponse,
    FLSaisonListAdapter,
    FLSaisonsFilterParams,
    FLSaisonsListResponse,
    FLSaisonsSingleResponse,
)
from app.api.saisons.services import base_tier_status_term, with_schedule
from app.api.saisons.visibility import PublicSaison, resolve_public_saison
from app.api.spiele.services import build_spiele_pipeline
from app.api.spieltage.schemas import FLKoRundeResponse, FLSpielplanResponse, FLSpielplanSpieltag
from app.api.spieltage.services import build_spielplan, current_spieltag_id
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, build_query, build_sort, pull_many_from_db, pull_one_from_db
from app.core.dependencies import SaisonsCollection, SpieleCollection, SpieltageCollection
from app.core.security import verify_access_base
from app.shared.schemas.bounds import LIST_LIMIT_MAX

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/saisons",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSaisonsListResponse, summary="List Saisons")
async def get_saisons(saisons_collection: SaisonsCollection, filters: FLSaisonsFilterParams = Depends()) -> FLSaisonsListResponse:
    """
    List the seasons the public may read, optionally narrowed to `past` or `active`.

    Unlike the other resources, this does NOT default to the current season. A `future` season is
    withheld here and served by `GET /saisons/list/verwaltung`.
    """

    # `compiled` last, so the narrowing replaces the raw `status` the dump wrote for the caller.
    db_filter = build_query(filters, terms={"status"}, compiled=base_tier_status_term(filters.status))
    db_sort = build_sort(sort_by=filters.sort_by, order=filters.order)

    saisons_raw = await pull_many_from_db(
        collection=saisons_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    saisons = FLSaisonListAdapter.validate_python([with_schedule(raw) for raw in saisons_raw])

    return FLSaisonsListResponse(saisons=saisons)


@router.get("/active", response_model=FLSaisonsSingleResponse, summary="The active Saison")
async def get_active_saison(
    saisons_collection: SaisonsCollection,
) -> FLSaisonsSingleResponse:
    """Return the season currently marked active -- what every other endpoint resolves an omitted `saison_id` against."""

    saison_raw = await pull_active_saison(saisons_collection=saisons_collection)

    saison = FLSaison.model_validate(with_schedule(saison_raw))

    return FLSaisonsSingleResponse(saison=saison)


@router.get("/frame", response_model=FLSaisonFrameResponse, summary="The season pages' frame")
async def get_frame(saisons_collection: SaisonsCollection) -> FLSaisonFrameResponse:
    """Every season the public may read, the newest first, and the one the site is on; that one is null for a league that has none."""

    saisons_raw = await pull_many_from_db(
        collection=saisons_collection,
        db_filter=base_tier_status_term(),
        sort_by=[("_id", -1)],
        projection=["_id", "start_date", "end_date", "status"],
        limit=LIST_LIMIT_MAX,
    )
    saisons = FLSaisonFrameEntryListAdapter.validate_python(saisons_raw)

    # The stored status alone: `uniq_saison_active` holds at most one, and activating the next
    # season is the one write that moves it, so a finished season stays the site's until then.
    active_saison_id = next((saison.id for saison in saisons if saison.status == "active"), None)

    return FLSaisonFrameResponse(saisons=saisons, active_saison_id=active_saison_id)


# Declared after `/active` and `/frame`: routes match in declaration order, and the `objectid`
# convertor cannot help here, a season id being a four-character string.
@router.get("/{saison_id}", response_model=FLSaisonsSingleResponse, summary="One Saison")
async def get_saison(saison_id: str, saisons_collection: SaisonsCollection) -> FLSaisonsSingleResponse:
    """Return one season by its id; 404 when none carries it, rather than an empty list.

    A `future` season is one of those: it is withheld from this tier by the FILTER, so the miss is a
    genuine one and nothing here has to know it was withheld.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id, **base_tier_status_term()})

    return FLSaisonsSingleResponse(saison=FLSaison.model_validate(with_schedule(saison_raw)))


# The knockout phases, which the K.-o.-Runde shows of the same matchdays and matches the Spielplan does.
_KNOCKOUT_TERM: Mapping[str, Any] = {"saison_phase": {"$ne": "gruppenphase"}}


async def _spielplan_of(
    *,
    saison_id: str,
    saisons_collection: AsyncCollection,
    spieltage_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
    phase_term: Mapping[str, Any],
) -> tuple[PublicSaison, list[FLSpielplanSpieltag]]:
    """The season and its matchdays holding their matches, in one round trip.

    The two contents are read beside the resolve rather than after it: the id is the path's, so neither waits on it,
    and nothing they hold is served before the resolve has passed.
    """

    db_filter = {"saison_id": saison_id, **phase_term}
    saison, spieltage_raw, spiele_raw = await asyncio.gather(
        resolve_public_saison(saisons_collection=saisons_collection, saison_id=saison_id),
        pull_many_from_db(collection=spieltage_collection, db_filter=db_filter),
        aggregate_many_from_db(collection=spiele_collection, pipeline=build_spiele_pipeline(db_filter=db_filter)),
    )

    return saison, build_spielplan(spieltage_raw, spiele_raw, saison.rules)


@router.get("/{saison_id}/spielplan", response_model=FLSpielplanResponse, summary="One Saison's Spielplan")
async def get_spielplan(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spieltage_collection: SpieltageCollection,
    spiele_collection: SpieleCollection,
) -> FLSpielplanResponse:
    """Every matchday of one season with its matches, in playing order, and the matchday to open on.

    The Spielplan and the Spielsuche both show this. 404 for a season this tier may not read.
    """

    saison, spieltage = await _spielplan_of(
        saison_id=saison_id,
        saisons_collection=saisons_collection,
        spieltage_collection=spieltage_collection,
        spiele_collection=spiele_collection,
        phase_term={},
    )

    return FLSpielplanResponse(spieltage=spieltage, current_spieltag_id=current_spieltag_id(spieltage, saison_status=saison.status))


@router.get("/{saison_id}/ko_runde", response_model=FLKoRundeResponse, summary="One Saison's K.-o.-Runde")
async def get_ko_runde(
    saison_id: str,
    saisons_collection: SaisonsCollection,
    spieltage_collection: SpieltageCollection,
    spiele_collection: SpieleCollection,
) -> FLKoRundeResponse:
    """Every knockout matchday of one season with its matches, in playing order; empty before the draw.

    A side whose club is not yet known is null beside the `quelle` it comes from. 404 for a season this tier may not
    read.
    """

    _, spieltage = await _spielplan_of(
        saison_id=saison_id,
        saisons_collection=saisons_collection,
        spieltage_collection=spieltage_collection,
        spiele_collection=spiele_collection,
        phase_term=_KNOCKOUT_TERM,
    )

    return FLKoRundeResponse(spieltage=spieltage)
