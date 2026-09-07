from contextlib import asynccontextmanager
from typing import NamedTuple

from fastapi import Depends, FastAPI, Request
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import ConfigurationError, OperationFailure

from app.core.collections import Collection
from app.core.config import BackendConfig, get_config
from app.core.constraints import apply_constraints
from app.core.exceptions import NO_DATABASE_CLIENT, DatabaseUnavailableException
from app.core.logging import fl_logger


class Refusal(NamedTuple):
    """A boot refusal's sentence and the code its log line carries (`docs/logging/spec.md` §1.2).

    One object rather than two constants, so a cause cannot be given a sentence and left without a code.
    """

    sentence: str
    error_code: str


# The variable's NAME and the fact, in one sentence each, used by the log line and the error alike.
# The three share their opening, so an operator who found one of them reads which by its continuation.
UNREACHABLE = Refusal("MONGODB_URI: the MongoDB server could not be reached, so the application will not start.", "SRV-BOOT-001")
NO_SERVER = Refusal("MONGODB_URI: the value did not yield a server to connect to, so the application will not start.", "SRV-BOOT-002")
REJECTED = Refusal("MONGODB_URI: the server refused to authenticate this value, so the application will not start.", "SRV-BOOT-003")


class DatabaseUnreachableError(Exception):
    """The boot's database refusal, named by the variable that configures it and nothing else.

    Its own type rather than the driver's: pymongo quotes what it parsed out of `MONGODB_URI`, which
    is how a mistyped value reaches a log.
    """


def _refusal_for(error: BaseException) -> Refusal:
    """Which of the three refusals an operator is handed, taken from the driver's exception class.

    `str(error)` quotes what the driver parsed or resolved, so nothing derived from it is read here.
    """
    # The server answered and refused: a password restored from a manager that does not match lands
    # here, and it sends an operator to the environment file rather than to the network.
    if isinstance(error, OperationFailure):
        return REJECTED
    # `AsyncMongoClient.__init__` parses the URI, so these arrive from the construction as well as
    # the ping: `InvalidURI` is a `ConfigurationError`, and a bad port is a plain `ValueError`.
    if isinstance(error, (ConfigurationError, ValueError)):
        return NO_SERVER
    # The residual takes the reachability sentence rather than a fourth: past the classes above, a
    # driver failure at the boot is the server not answering.
    return UNREACHABLE


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = get_config()
    client: AsyncMongoClient | None = None

    try:
        try:
            # Constructed inside the handled region: the driver parses the URI here rather than at
            # the ping, so a value the scheme check passed and the parser refuses would otherwise
            # leave as the driver's own traceback, quoting what it read.
            client = AsyncMongoClient(
                host=config.mongodb_uri.get_secret_value(),
                serverSelectionTimeoutMS=config.db_server_selection_timeout,
                minPoolSize=config.db_min_connections,
                maxPoolSize=config.db_max_connections,
                uuidRepresentation="standard",
            )
            app.state.db_client = client
            await client.admin.command("ping")
        except Exception as error:
            refusal = _refusal_for(error)
            fl_logger.critical(refusal.sentence, extra={"error_code": refusal.error_code})
            # No `exc_info`, and a new error `from None`: the driver's own message carries the host
            # it resolved out of the value, which is the half an operator must not be handed.
            raise DatabaseUnreachableError(refusal.sentence) from None

        # Reapplied on every boot, and a failure refuses the start (`docs/backend/spec.md :: I15`).
        try:
            constraints = await apply_constraints(app.state.db_client[config.db_base_name])
        except Exception:
            fl_logger.critical(
                "Database constraints could not be applied, so the application will not start. Run "
                "`python -m app.core.constraints --check` for the offending documents and the collMod privilege.",
                exc_info=True,
                extra={"error_code": "SRV-BOOT-004"},
            )
            raise
        fl_logger.info(
            f"Database constraints applied: {constraints.validators} validators, "
            f"{constraints.unique_indexes} unique, {constraints.support_indexes} support "
            f"and {constraints.ttl_indexes} TTL indexes."
        )

        yield

    finally:
        # The local rather than `app.state`, which the construction above may not have reached: a
        # lookup that raises here would replace the refusal on its way out with an `AttributeError`.
        if client is not None:
            await client.close()


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
