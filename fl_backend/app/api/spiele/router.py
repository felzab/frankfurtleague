import datetime

import pymongo
from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse

from app.api.spiele.schemas import (
    FLSpielListAdapter,
    FLSpieltagListAdapter,
    FLSpieltagWithSpiele,
    FLSpieltagWithSpieleListAdapter,
)
from app.core.config import backend_config
from app.core.crud import pull_from_db
from app.core.dependencies import SpieleCollection, SpieltageCollection
from app.core.security import verify_access_base

router = APIRouter(prefix=f"/api/v{backend_config.api_version}/spiele", dependencies=[Depends(verify_access_base)])


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


@router.get("/all_spiele")
async def get_spiele(request: Request, spiele_collection: SpieleCollection) -> JSONResponse:

    spiele_raw = await pull_from_db(collection=spiele_collection, filter={})
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    return JSONResponse(
        content={"acknowledged": 1, "all_spiele": FLSpielListAdapter.dump_python(spiele, mode="json")},
        status_code=status.HTTP_200_OK,
    )


@router.get("/spiele_preview")
async def get_games_preview(request: Request, spiele_collection: SpieleCollection) -> JSONResponse:

    today = datetime.datetime.now().strftime("%Y-%m-%d")

    # Fetches next 6 games
    next_games_raw = await pull_from_db(
        collection=spiele_collection,
        filter={"datum": {"$gt": today}},
        sort_by=[("datum", pymongo.ASCENDING), ("spiel_nr", pymongo.ASCENDING)],
        limit=6,
    )
    next_games = FLSpielListAdapter.validate_python(next_games_raw)

    # Fetches previous 6 games
    previous_games_raw = await pull_from_db(
        collection=spiele_collection,
        filter={"datum": {"$lt": today}},
        sort_by=[("datum", pymongo.DESCENDING), ("spiel_nr", pymongo.ASCENDING)],
        limit=6,
    )
    previous_games = FLSpielListAdapter.validate_python(previous_games_raw)

    return JSONResponse(
        content={
            "acknowledged": 1,
            "previous_games": FLSpielListAdapter.dump_python(previous_games, mode="json"),
            "next_games": FLSpielListAdapter.dump_python(next_games, mode="json"),
        },
        status_code=status.HTTP_200_OK,
    )
