import functools
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from http import HTTPStatus
from typing import Final, NamedTuple

import pymongo
from fastapi import Depends, FastAPI, Request
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import ConfigurationError, OperationFailure

from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import MONGODB_URI_FILE, BackendConfig, get_app_config
from app.core.constraints import apply_constraints
from app.core.exceptions import APIError
from app.core.logging import fl_logger


class Refusal(NamedTuple):
    """A boot refusal's log line key and the sentence its error carries.

    One object rather than two constants, so a cause cannot be given a key and left without a sentence.
    """

    event: str
    sentence: str


# The secret file's name and the fact, in one sentence each, for the error. The three share their
# opening, so an operator who found one of them reads which by its continuation.
UNREACHABLE = Refusal("db.unreachable", f"{MONGODB_URI_FILE}: the MongoDB server could not be reached, so the application will not start.")
NO_SERVER = Refusal("db.no_server", f"{MONGODB_URI_FILE}: the value did not yield a server to connect to, so the application will not start.")
REJECTED = Refusal("db.rejected", f"{MONGODB_URI_FILE}: the server refused to authenticate this value, so the application will not start.")


class DatabaseUnreachableError(Exception):
    """The boot's database refusal, named by the secret file that configures it and nothing else.

    Its own type rather than the driver's: pymongo quotes what it parsed out of the URI, which is how
    a mistyped value reaches a log.
    """


def _refusal_for(error: BaseException) -> Refusal:
    """Which of the three refusals an operator is handed, taken from the driver's exception class.

    `str(error)` quotes what the driver parsed or resolved, so nothing derived from it is read here.
    """
    # The server answered and refused: a password restored from a manager that does not match lands
    # here, and it sends an operator to the secret file rather than to the network.
    if isinstance(error, OperationFailure):
        return REJECTED
    # `AsyncMongoClient.__init__` parses the URI, so these arrive from the construction as well as
    # the ping: `InvalidURI` is a `ConfigurationError`, and a bad port is a plain `ValueError`.
    if isinstance(error, (ConfigurationError, ValueError)):
        return NO_SERVER
    # The residual takes the reachability sentence rather than a fourth: past the classes above, a
    # driver failure at the boot is the server not answering.
    return UNREACHABLE


# The two lines the boot goes on past: nobody can enter the administration, or no grant is out of an
# administrator's reach. Warnings rather than refusals: the public site needs no administrator, and a
# boot refused over the grants would take it down to repair a state only a Playground paste repairs.
NO_GRANT = "grants.no_grant"
NO_OWNER = "grants.no_owner"


async def warn_about_the_grants(grants_collection: AsyncCollection) -> None:
    """Name a list that admits nobody or protects nobody, at boot.

    Counts alone reach the line and never an address: the log outlives the grants it describes.
    """

    grants = await grants_collection.find({}, projection={"admin_tier": 1}).to_list(length=None)

    if not grants:
        fl_logger.warning(NO_GRANT)
        return

    if all(grant.get("admin_tier") != "owner" for grant in grants):
        fl_logger.warning(NO_OWNER)


# Wider than the frontend's, which a visitor's first request waits on: here a request's shorter
# deadline governs, so only the boot waits this long. Kept well inside the time a deploy waits for the
# stack's health, so a failed ping's reason is logged while the deploy still waits, and the log lines
# it prints on a failure carry it.
SERVER_SELECTION_TIMEOUT_MS = 15_000

# The stop's last step, which must end before the kill. Compose's `stop_grace_period` gives the backend
# 12 s from the signal; uvicorn spends up to 0.2 s before its graceful wait and up to 11 s in it
# (`--timeout-graceful-shutdown`), which leaves 0.8 s for this close and the process's exit. `close`
# selects a server for its `endSessions`, and with no member answering that selection would otherwise
# wait out the boot's 15 s above. Cutting it loses nothing: the sessions specification says "Drivers
# MUST ignore any errors returned by the endSessions command", and the server ends a session left open
# after 30 minutes.
CLOSE_TIMEOUT_S: Final = 0.5


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The settings the application was built with, which its requests read too.
    config: BackendConfig = app.state.config
    client: AsyncMongoClient | None = None

    try:
        try:
            # Constructed inside the handled region: the driver parses the URI here rather than at
            # the ping, so a value the scheme check passed and the parser refuses would otherwise
            # leave as the driver's own traceback, quoting what it read.
            client = AsyncMongoClient(
                host=config.mongodb_uri.get_secret_value(),
                serverSelectionTimeoutMS=SERVER_SELECTION_TIMEOUT_MS,
                uuidRepresentation="standard",
            )
            app.state.db_client = client
            await client.admin.command("ping")
        except Exception as error:
            refusal = _refusal_for(error)
            # The file by its name, the one an operator goes and fixes; never its value.
            fl_logger.critical(refusal.event, extra={"file": MONGODB_URI_FILE})
            # No `exc_info`, and a new error `from None`: the driver's own message carries the host
            # it resolved out of the value, which is the half an operator must not be handed.
            raise DatabaseUnreachableError(refusal.sentence) from None

        # Reapplied on every boot, and a failure refuses the start.
        try:
            constraints = await apply_constraints(app.state.db_client[config.db_base_name])
        except Exception:
            fl_logger.critical("db.indexes_failed", exc_info=True)
            raise
        fl_logger.info(
            "db.indexes_applied",
            extra={
                "unique_indexes": constraints.unique_indexes,
                "support_indexes": constraints.support_indexes,
                "ttl_indexes": constraints.ttl_indexes,
            },
        )

        await warn_about_the_grants(app.state.db_client[config.db_base_name][Collection.GRANTS])

        # The one line per start that says which build runs: the json-file driver records no image version of its own.
        fl_logger.info("system.started", extra={"version": config.app_version})

        yield

    finally:
        # The local rather than `app.state`, which the construction above may not have reached: a
        # lookup that raises here would replace the refusal on its way out with an `AttributeError`.
        if client is not None:
            # A deadline rather than a client setting: the driver bounds the selection by the
            # deadline's remaining time wherever one is set, as every request's is.
            with pymongo.timeout(CLOSE_TIMEOUT_S):
                await client.close()


# What a 503 for an absent or unanswering database asks the caller to wait, in seconds.
RETRY_AFTER: Final = {"Retry-After": "30"}


async def get_db_client(request: Request) -> AsyncMongoClient:
    if not hasattr(request.app.state, "db_client"):
        raise APIError(HTTPStatus.SERVICE_UNAVAILABLE, Code.NO_DATABASE_CLIENT, headers=RETRY_AFTER)
    return request.app.state.db_client


async def get_database(
    request: Request,
    config: BackendConfig = Depends(get_app_config),
) -> AsyncDatabase:
    # The application's settings, not `get_config()`: reading the environment would resolve every
    # collection dependency against its database rather than the one the application was built with.
    if not hasattr(request.app.state, "db_client"):
        raise APIError(HTTPStatus.SERVICE_UNAVAILABLE, Code.NO_DATABASE_CLIENT, headers=RETRY_AFTER)
    return request.app.state.db_client[config.db_base_name]


async def get_snapshot_session(client: AsyncMongoClient = Depends(get_db_client)) -> AsyncIterator[AsyncClientSession]:
    """A session whose reads all see one moment, for an operation writing nothing that reads several times.

    The session alone rather than the client it came from, so such an operation holds no handle to write through.
    """

    async with client.start_session(snapshot=True) as session:
        yield session


@functools.cache
def collection_dependency(collection: Collection) -> Callable[..., Awaitable[AsyncCollection]]:
    """The one dependency per collection, the same object on every call, so an override and FastAPI's per-request cache both key on it."""

    async def get_collection(db: AsyncDatabase = Depends(get_database)) -> AsyncCollection:
        return db[collection]

    return get_collection
