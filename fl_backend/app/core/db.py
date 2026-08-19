"""
CORE · database lifecycle and collection providers

One Motor client, created in the FastAPI lifespan and attached to `app.state`. Collections are
reached through the typed dependencies in `dependencies.py`, never constructed ad hoc.

Invariants:
- The app refuses to start if MongoDB is unreachable or the constraints cannot apply.
- `get_teams_collection` is the season-independent club document — the junction is separate.

See:
- docs/backend/spec.md — invariant I9
- docs/glossary.md — "Team", for the junction model
"""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from motor.motor_asyncio import (
    AsyncIOMotorClient,
    AsyncIOMotorCollection,
    AsyncIOMotorDatabase,
)

from app.core.collections import Collection
from app.core.config import BackendConfig, get_config
from app.core.constraints import apply_constraints
from app.core.exceptions import NO_DATABASE_CLIENT, DatabaseUnavailableException
from app.core.logging import fl_logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = get_config()

    app.state.db_client = AsyncIOMotorClient(
        host=config.mongodb_uri.get_secret_value(),
        serverSelectionTimeoutMS=config.db_server_selection_timeout,
        minPoolSize=config.db_min_connections,
        maxPoolSize=config.db_max_connections,
        uuidRepresentation="standard",
    )

    try:
        await app.state.db_client.admin.command("ping")

        # The database's own constraints, declared in this repository and reapplied on every boot so
        # the cluster can never quietly hold a different set.
        try:
            constraints = await apply_constraints(app.state.db_client[config.db_base_name])
        except Exception:
            fl_logger.critical(
                "Database constraints could not be applied, so the application will not start. Run "
                "`python -m app.core.constraints --check` for the offending documents and the collMod privilege.",
                exc_info=True,
            )
            raise
        fl_logger.info(f"Database constraints applied: {constraints.validators} validators, {constraints.indexes} unique indexes.")

        yield

    finally:
        if app.state.db_client:
            app.state.db_client.close()


async def get_db_client(request: Request) -> AsyncIOMotorClient:
    if not hasattr(request.app.state, "db_client"):
        raise DatabaseUnavailableException(error_code=NO_DATABASE_CLIENT)
    return request.app.state.db_client


async def get_database(
    request: Request,
    config: BackendConfig = Depends(get_config),
) -> AsyncIOMotorDatabase:
    # Through `Depends`, not `get_config()` directly: an app built with injected settings must reach
    # that database name. Reading the global would resolve every collection dependency against the
    # real one.
    if not hasattr(request.app.state, "db_client"):
        raise DatabaseUnavailableException(error_code=NO_DATABASE_CLIENT)
    return request.app.state.db_client[config.db_base_name]


async def get_spiele_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db[Collection.SPIELE]


async def get_spieler_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db[Collection.SPIELER]


async def get_spieltage_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db[Collection.SPIELTAGE]


async def get_teams_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db[Collection.TEAMS]


async def get_saisons_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db[Collection.SAISONS]


async def get_spielorte_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db[Collection.SPIELORTE]


async def get_schiedsrichter_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db[Collection.SCHIEDSRICHTER]


# The two junctions. A READ never opens either directly -- they are reached by name inside the `$lookup`
# stages of the teams and spieler pipelines. A write does, because there is nothing to join: adding a
# team to a season IS a row here.
async def get_saison_teams_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db[Collection.SAISON_TEAMS]


async def get_saison_spieler_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db[Collection.SAISON_SPIELER]
