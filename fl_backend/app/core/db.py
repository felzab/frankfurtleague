from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.core.config import BackendConfig, get_config
from app.core.constraints import apply_constraints
from app.core.exceptions import NO_DATABASE_CLIENT, DatabaseUnavailableException
from app.core.logging import fl_logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = get_config()

    app.state.db_client = AsyncMongoClient(
        host=config.mongodb_uri.get_secret_value(),
        serverSelectionTimeoutMS=config.db_server_selection_timeout,
        minPoolSize=config.db_min_connections,
        maxPoolSize=config.db_max_connections,
        uuidRepresentation="standard",
    )

    try:
        await app.state.db_client.admin.command("ping")

        # Reapplied on every boot, and a failure refuses the start (`docs/backend/spec.md :: I15`).
        try:
            constraints = await apply_constraints(app.state.db_client[config.db_base_name])
        except Exception:
            fl_logger.critical(
                "Database constraints could not be applied, so the application will not start. Run "
                "`python -m app.core.constraints --check` for the offending documents and the collMod privilege.",
                exc_info=True,
            )
            raise
        fl_logger.info(
            f"Database constraints applied: {constraints.validators} validators, "
            f"{constraints.unique_indexes} unique, {constraints.support_indexes} support "
            f"and {constraints.ttl_indexes} TTL indexes."
        )

        yield

    finally:
        if app.state.db_client:
            await app.state.db_client.close()


async def get_db_client(request: Request) -> AsyncMongoClient:
    if not hasattr(request.app.state, "db_client"):
        raise DatabaseUnavailableException(error_code=NO_DATABASE_CLIENT)
    return request.app.state.db_client


async def get_database(
    request: Request,
    config: BackendConfig = Depends(get_config),
) -> AsyncDatabase:
    # Through `Depends`, not `get_config()`: reading the global would resolve every collection
    # dependency against the real database rather than an injected one.
    if not hasattr(request.app.state, "db_client"):
        raise DatabaseUnavailableException(error_code=NO_DATABASE_CLIENT)
    return request.app.state.db_client[config.db_base_name]


async def get_spiele_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.SPIELE]


async def get_spieler_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.SPIELER]


async def get_spieltage_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.SPIELTAGE]


async def get_teams_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.TEAMS]


async def get_saisons_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.SAISONS]


async def get_spielorte_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.SPIELORTE]


async def get_schiedsrichter_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.SCHIEDSRICHTER]


# The two junctions. A READ reaches them by name inside a `$lookup`; a write opens them directly,
# there being nothing to join.
async def get_saison_teams_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.SAISON_TEAMS]


async def get_aktionen_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.AKTIONEN]


async def get_saison_spieler_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.SAISON_SPIELER]


async def get_bewerbungen_collection(
    db: AsyncDatabase = Depends(get_database),
) -> AsyncCollection:
    return db[Collection.BEWERBUNGEN]
