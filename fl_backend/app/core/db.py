"""
CORE · database lifecycle and collection providers

One Motor client, created in the FastAPI lifespan and attached to `app.state`. Collections are reached
through the typed dependencies in `dependencies.py`, never constructed ad hoc.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • The application REFUSES TO START if MongoDB is unreachable: lifespan pings the server and re-raises
    anything that fails. A container that starts without a database is a container that serves errors,
    and the healthcheck would rather it never come up.
  • It refuses to start for the same reason if the CONSTRAINTS cannot be applied. `apply_constraints`
    runs on every boot, after the ping, and a failure there is fatal on purpose (ADR-0027): a database
    enforcing eight of nine validators is indistinguishable from one enforcing all nine. The likeliest
    cause is a database user without `collMod` -- see `constraints.py`.
  • `get_teams_collection` returns `db.teams`, which is the SEASON-INDEPENDENT team document. `gruppe`
    and `is_disqualified` are season-scoped and live in the separate `saison_teams` collection, joined
    at read time; `statistik` is season-scoped as well and is derived from `spiele` in the same
    pipeline rather than stored anywhere (ADR-0026). See `app/api/teams/services.py`.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- invariant I9
  docs/glossary.md -- "Team", for the junction model
"""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from motor.motor_asyncio import (
    AsyncIOMotorClient,
    AsyncIOMotorCollection,
    AsyncIOMotorDatabase,
)

from app.core.config import BackendConfig, get_config
from app.core.constraints import apply_constraints
from app.core.exceptions import DatabaseUnavailableException
from app.core.logging import fl_logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = get_config()

    # Attach connection to app state
    app.state.db_client = AsyncIOMotorClient(
        host=config.mongodb_uri.get_secret_value(),
        serverSelectionTimeoutMS=config.db_server_selection_timeout,
        minPoolSize=config.db_min_connections,
        maxPoolSize=config.db_max_connections,
        uuidRepresentation="standard",
    )

    try:
        # Verify connection
        await app.state.db_client.admin.command("ping")

        # The database's own constraints, declared in this repository and reapplied on every boot so
        # the cluster can never quietly hold a different set (ADR-0027).
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


async def get_database(
    request: Request,
    config: BackendConfig = Depends(get_config),
) -> AsyncIOMotorDatabase:
    # Through `Depends`, not `get_config()` directly: an app built with injected settings must reach
    # THAT database name. Reading the global here would have every collection dependency quietly
    # resolve against the real one while the guards used the injected keys.
    if not hasattr(request.app.state, "db_client"):
        raise DatabaseUnavailableException(error_code="DB-CONN-001")
    return request.app.state.db_client[config.db_base_name]


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


# The two junctions. A READ never opens either directly -- they are reached by name inside the `$lookup`
# stages of the teams and spieler pipelines. A write does, because there is nothing to join: adding a
# team to a season IS a row here.
async def get_saison_teams_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db.saison_teams


async def get_saison_spieler_collection(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AsyncIOMotorCollection:
    return db.saison_spieler
