import datetime

import pymongo
from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import JSONResponse

from app.api.spiele.schemas import (
    FLSpieleFilterParams,
    FLSpieleListResponse,
    FLSpielListAdapter,
    FLSpieltagListAdapter,
    FLSpieltagWithSpiele,
    FLSpieltagWithSpieleListAdapter,
)
from app.api.spiele.services import build_spiele_filter, build_spiele_sort
from app.core.config import backend_config
from app.core.crud import pull_from_db, pull_many_from_db
from app.core.dependencies import SpieleCollection, SpieltageCollection, get_german_date_str
from app.core.security import verify_access_base

router = APIRouter(prefix=f"/api/v{backend_config.api_version}/spiele", dependencies=[Depends(verify_access_base)])


@router.get("", response_model=FLSpieleListResponse)
async def get_spiele(
    spiele_collection: SpieleCollection, filters: FLSpieleFilterParams = Depends(), today: str = Depends(get_german_date_str)
) -> FLSpieleListResponse:

    db_filter = build_spiele_filter(filters=filters, today=today)
    db_sort = build_spiele_sort(sort_by=filters.sort_by, order=filters.order)

    spiele_raw = await pull_many_from_db(
        collection=spiele_collection, db_filter=db_filter, limit=filters.limit, sort_by=db_sort
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    return FLSpieleListResponse(spiele=spiele)


@router.get("/spielplan")
async def get_spielplan(
    request: Request, spiele_collection: SpieleCollection, spieltage_collection: SpieltageCollection
) -> JSONResponse:

    # Get all the Spieltage
    spieltage_raw = await pull_from_db(collection=spieltage_collection, filter={}, sort_by=[("order_val", pymongo.ASCENDING)])
    spieltage = FLSpieltagListAdapter.validate_python(spieltage_raw)

    # Get all Spiele, that match one of the spieltag_ids
    spiele_raw = await pull_from_db(
        collection=spiele_collection,
        filter={"spieltag_id": {"$in": [spieltag.id for spieltag in spieltage]}},
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    # Add all the games associated with a certain game day to that game days dictionary
    spieltage_with_spiele = [
        FLSpieltagWithSpiele(
            **spieltag.model_dump(by_alias=True), spiele=[spiel for spiel in spiele if spiel.spieltag_id == spieltag.id]
        )
        for spieltag in spieltage
    ]

    return JSONResponse(
        content={
            "acknowledged": 1,
            "spielplan": {"spieltage": FLSpieltagWithSpieleListAdapter.dump_python(spieltage_with_spiele, mode="json")},
        },
        status_code=status.HTTP_200_OK,
    )


@router.get("/spielhistorie")
async def get_spielhistorie(request: Request, spiele_collection: SpieleCollection) -> JSONResponse:

    today = datetime.datetime.now().strftime("%Y-%m-%d")

    past_games_raw = await pull_from_db(
        collection=spiele_collection,
        filter={"datum": {"$lt": today}},
        sort_by=[("datum", pymongo.DESCENDING)],
    )
    past_games = FLSpielListAdapter.validate_python(past_games_raw)

    return JSONResponse(
        content={"acknowledged": 1, "spielhistorie": FLSpielListAdapter.dump_python(past_games, mode="json")},
        status_code=status.HTTP_200_OK,
    )


@router.get("/recent_and_upcoming_spiele")
async def get_games_preview(
    request: Request, spiele_collection: SpieleCollection, amount: int = Query(default=6)
) -> JSONResponse:

    today = datetime.datetime.now().strftime("%Y-%m-%d")

    # Fetches upcoming 6 games
    upcoming_games_raw = await pull_from_db(
        collection=spiele_collection,
        filter={"datum": {"$gte": today}},
        sort_by=[("datum", pymongo.ASCENDING), ("spiel_nr", pymongo.ASCENDING)],
        limit=amount,
    )
    upcoming_games = FLSpielListAdapter.validate_python(upcoming_games_raw)

    # Fetches recent 6 games
    recent_games_raw = await pull_from_db(
        collection=spiele_collection,
        filter={"datum": {"$lt": today}},
        sort_by=[("datum", pymongo.DESCENDING), ("spiel_nr", pymongo.ASCENDING)],
        limit=amount,
    )
    recent_games = FLSpielListAdapter.validate_python(recent_games_raw)

    return JSONResponse(
        content={
            "acknowledged": 1,
            "recent_spiele": FLSpielListAdapter.dump_python(recent_games, mode="json"),
            "upcoming_spiele": FLSpielListAdapter.dump_python(upcoming_games, mode="json"),
        },
        status_code=status.HTTP_200_OK,
    )


@router.get("/playoffs_spiele")
async def get_playoffs_spiele(
    request: Request, spieltage_collection: SpieltageCollection, spiele_collection: SpieleCollection
) -> JSONResponse:

    spieltage_raw = await pull_from_db(
        collection=spieltage_collection,
        filter={"saison_phase": {"$ne": "gruppenphase"}},
        sort_by=[("order_val", pymongo.ASCENDING)],
    )
    spieltage = FLSpieltagListAdapter.validate_python(spieltage_raw)

    spiele_raw = await pull_from_db(
        collection=spiele_collection,
        filter={"spieltag_id": {"$in": [spieltag.id for spieltag in spieltage]}},
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    spieltage_with_spiele = [
        FLSpieltagWithSpiele(
            **spieltag.model_dump(by_alias=True), spiele=[spiel for spiel in spiele if spiel.spieltag_id == spieltag.id]
        )
        for spieltag in spieltage
    ]

    return JSONResponse(
        content={
            "acknowledged": 1,
            "playoffs_spieltage": FLSpieltagWithSpieleListAdapter.dump_python(spieltage_with_spiele, mode="json"),
        },
        status_code=status.HTTP_200_OK,
    )
