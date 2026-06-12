from typing import Annotated

from fastapi import Depends
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase

from app.core.db import (
    get_database,
    get_db_client,
    get_saisons_collection,
    get_spiele_collection,
    get_spieler_collection,
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
