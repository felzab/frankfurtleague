"""
CORE · injectable dependencies

Typed aliases for the nine collections, plus the German-time providers. Endpoints declare what they
need rather than reaching for it, which is what makes them testable without a database.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Time is Europe/Berlin wall-clock, injected as a STRING, never `datetime.now()` inside a handler.
    Match dates are `YYYY-MM-DD` strings compared lexicographically -- which works only because the
    format sorts, so the format is not negotiable.
  • Injecting the date also makes "today" substitutable in tests. A handler calling the clock itself
    cannot be tested across a date boundary.
"""

from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import Depends
from motor.motor_asyncio import (
    AsyncIOMotorClient,
    AsyncIOMotorCollection,
    AsyncIOMotorDatabase,
)

from app.core.db import (
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

DBClient = Annotated[AsyncIOMotorClient, Depends(get_db_client)]

DB = Annotated[AsyncIOMotorDatabase, Depends(get_database)]

SpieleCollection = Annotated[AsyncIOMotorCollection, Depends(get_spiele_collection)]

SpielerCollection = Annotated[AsyncIOMotorCollection, Depends(get_spieler_collection)]

SpieltageCollection = Annotated[AsyncIOMotorCollection, Depends(get_spieltage_collection)]

TeamsCollection = Annotated[AsyncIOMotorCollection, Depends(get_teams_collection)]

SaisonsCollection = Annotated[AsyncIOMotorCollection, Depends(get_saisons_collection)]

SpielorteCollection = Annotated[AsyncIOMotorCollection, Depends(get_spielorte_collection)]

SchiedsrichterCollection = Annotated[AsyncIOMotorCollection, Depends(get_schiedsrichter_collection)]

SaisonTeamsCollection = Annotated[AsyncIOMotorCollection, Depends(get_saison_teams_collection)]

SaisonSpielerCollection = Annotated[AsyncIOMotorCollection, Depends(get_saison_spieler_collection)]


def get_germany_now() -> datetime:
    return datetime.now(ZoneInfo("Europe/Berlin"))


def get_german_date_str(germany_now: datetime = Depends(get_germany_now)) -> str:
    return germany_now.strftime("%Y-%m-%d")  # YYYY-MM-DD


def get_german_time_str(germany_now: datetime = Depends(get_germany_now)) -> str:
    return germany_now.strftime("%H:%M:%S")  # HH:MM:SS
