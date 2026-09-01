from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import Depends
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import (
    get_aktionen_collection,
    get_bewerbungen_collection,
    get_database,
    get_db_client,
    get_saison_spieler_collection,
    get_saison_teams_collection,
    get_saisons_collection,
    get_schiedsrichter_collection,
    get_spiele_collection,
    get_spieler_collection,
    get_spielorte_collection,
    get_spieltage_collection,
    get_teams_collection,
)

DBClient = Annotated[AsyncMongoClient, Depends(get_db_client)]

DB = Annotated[AsyncDatabase, Depends(get_database)]

SpieleCollection = Annotated[AsyncCollection, Depends(get_spiele_collection)]

SpielerCollection = Annotated[AsyncCollection, Depends(get_spieler_collection)]

SpieltageCollection = Annotated[AsyncCollection, Depends(get_spieltage_collection)]

TeamsCollection = Annotated[AsyncCollection, Depends(get_teams_collection)]

SaisonsCollection = Annotated[AsyncCollection, Depends(get_saisons_collection)]

SpielorteCollection = Annotated[AsyncCollection, Depends(get_spielorte_collection)]

SchiedsrichterCollection = Annotated[AsyncCollection, Depends(get_schiedsrichter_collection)]

SaisonTeamsCollection = Annotated[AsyncCollection, Depends(get_saison_teams_collection)]

SaisonSpielerCollection = Annotated[AsyncCollection, Depends(get_saison_spieler_collection)]

AktionenCollection = Annotated[AsyncCollection, Depends(get_aktionen_collection)]

BewerbungenCollection = Annotated[AsyncCollection, Depends(get_bewerbungen_collection)]


# Injected rather than read at the call site, which is what keeps "today" substitutable in tests.
def get_germany_now() -> datetime:
    return datetime.now(ZoneInfo("Europe/Berlin"))


def get_german_date_str(germany_now: datetime = Depends(get_germany_now)) -> str:
    return germany_now.strftime("%Y-%m-%d")
