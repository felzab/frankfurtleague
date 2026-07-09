from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from motor.motor_asyncio import (
    AsyncIOMotorClient,
    AsyncIOMotorCollection,
    AsyncIOMotorDatabase,
)

from app.core.config import backend_config
from app.core.exceptions import DatabaseUnavailableException


@asynccontextmanager
async def lifespan(app: FastAPI):

    # Attach connection to app state
    app.state.db_client = AsyncIOMotorClient(
        host=backend_config.mongodb_uri.get_secret_value(),
        serverSelectionTimeoutMS=backend_config.db_server_selection_timeout,
        minPoolSize=backend_config.db_min_connections,
        maxPoolSize=backend_config.db_max_connections,
        uuidRepresentation="standard",
    )

    try:
        # Verify connection
        await app.state.db_client.admin.command("ping")

        yield

    # No check for specific exceptions, so the server crashes immediately
    except Exception:
        raise
    finally:
        if app.state.db_client:
            app.state.db_client.close()


async def get_db_client(request: Request) -> AsyncIOMotorClient:
    if not hasattr(request.app.state, "db_client"):
        raise DatabaseUnavailableException(error_code="DB-CONN-001")
    return request.app.state.db_client


async def get_database(request: Request) -> AsyncIOMotorDatabase:
    if not hasattr(request.app.state, "db_client"):
        raise DatabaseUnavailableException(error_code="DB-CONN-001")
    return request.app.state.db_client[backend_config.db_base_name]


async def get_spiele_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db.spiele


async def get_spieler_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db.spieler


async def get_spieltage_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db.spieltage


async def get_teams_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db.teams


async def get_saisons_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db.saisons


async def get_spielorte_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db.spielorte


async def get_schiedsrichter_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db.schiedsrichter
