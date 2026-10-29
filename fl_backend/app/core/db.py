import functools
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from http import HTTPStatus
from typing import NamedTuple

from fastapi import Depends, FastAPI, Request
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import ConfigurationError, OperationFailure

from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import MONGODB_URI_FILE, BackendConfig, get_app_config
from app.core.constraints import apply_constraints
from app.core.exceptions import APIError
from app.core.logging import fl_logger
from app.shared.folding import is_stored_identifier


class Refusal(NamedTuple):
    """A boot refusal's sentence and the code its log line carries.

    One object rather than two constants, so a cause cannot be given a sentence and left without a code.
    """

    sentence: str
    error_code: str


# The secret file's NAME and the fact, in one sentence each, used by the log line and the error alike.
# The three share their opening, so an operator who found one of them reads which by its continuation.
UNREACHABLE = Refusal(f"{MONGODB_URI_FILE}: the MongoDB server could not be reached, so the application will not start.", "SRV-BOOT-001")
NO_SERVER = Refusal(f"{MONGODB_URI_FILE}: the value did not yield a server to connect to, so the application will not start.", "SRV-BOOT-002")
REJECTED = Refusal(f"{MONGODB_URI_FILE}: the server refused to authenticate this value, so the application will not start.", "SRV-BOOT-003")


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


class BootWarning(NamedTuple):
    """`Refusal`'s pair for a line the boot goes on past.

    Warnings rather than refusals: the public site needs no administrator, and a boot refused over the
    grants would take it down to repair a state only a Playground paste repairs.
    """

    sentence: str
    error_code: str


NO_GRANT = BootWarning("berechtigungen holds no live grant, so nobody can enter the administration.", "SRV-BOOT-005")
NO_OWNER = BootWarning("berechtigungen holds no live owner row, so no grant is out of an administrator's reach.", "SRV-BOOT-006")
DEAD_GRANT = BootWarning(
    "berechtigungen holds {count} grant(s) whose address is empty, unfolded or refused by the address rule, which admit nobody.",
    "SRV-BOOT-007",
)


async def warn_about_the_grants(berechtigungen_collection: AsyncCollection) -> None:
    """Name a list that admits nobody, protects nobody, or holds a row no request matches: at boot, and after an erasure took a grant.

    Counts alone reach the line and never an address: the log outlives the grants it describes.
    """

    grants = await berechtigungen_collection.find({}, projection={"adresse": 1, "verwaltung": 1}).to_list(length=None)
    # The one reading every reader of a grant takes: the store refuses no spelling, so a hand-typed
    # row may be stored that no request matches.
    live = [grant for grant in grants if is_stored_identifier(grant.get("adresse"))]

    if len(live) < len(grants):
        fl_logger.warning(DEAD_GRANT.sentence.format(count=len(grants) - len(live)), extra={"error_code": DEAD_GRANT.error_code})

    if not live:
        fl_logger.warning(NO_GRANT.sentence, extra={"error_code": NO_GRANT.error_code})
        return

    if all(grant.get("verwaltung") != "owner" for grant in live):
        fl_logger.warning(NO_OWNER.sentence, extra={"error_code": NO_OWNER.error_code})


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The settings the application was built with (`app/main.py :: create_app`), which its requests read too.
    config: BackendConfig = app.state.config
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

        # Reapplied on every boot, and a failure refuses the start.
        try:
            constraints = await apply_constraints(app.state.db_client[config.db_base_name])
        except Exception:
            fl_logger.critical(
                "Database indexes could not be applied, so the application will not start.",
                exc_info=True,
                extra={"error_code": "SRV-BOOT-004"},
            )
            raise
        fl_logger.info(
            "db.indexes_applied",
            extra={
                "unique_indexes": constraints.unique_indexes,
                "support_indexes": constraints.support_indexes,
                "ttl_indexes": constraints.ttl_indexes,
            },
        )

        await warn_about_the_grants(app.state.db_client[config.db_base_name][Collection.BERECHTIGUNGEN])

        yield

    finally:
        # The local rather than `app.state`, which the construction above may not have reached: a
        # lookup that raises here would replace the refusal on its way out with an `AttributeError`.
        if client is not None:
            await client.close()


async def get_db_client(request: Request) -> AsyncMongoClient:
    if not hasattr(request.app.state, "db_client"):
        raise APIError(HTTPStatus.SERVICE_UNAVAILABLE, Code.NO_DATABASE_CLIENT, headers={"Retry-After": "30"})
    return request.app.state.db_client


async def get_database(
    request: Request,
    config: BackendConfig = Depends(get_app_config),
) -> AsyncDatabase:
    # The application's settings, not `get_config()`: reading the environment would resolve every
    # collection dependency against its database rather than the one the application was built with.
    if not hasattr(request.app.state, "db_client"):
        raise APIError(HTTPStatus.SERVICE_UNAVAILABLE, Code.NO_DATABASE_CLIENT, headers={"Retry-After": "30"})
    return request.app.state.db_client[config.db_base_name]


@functools.cache
def collection_dependency(collection: Collection) -> Callable[..., Awaitable[AsyncCollection]]:
    """The one dependency per collection, the same object on every call, so an override and FastAPI's per-request cache both key on it."""

    async def get_collection(db: AsyncDatabase = Depends(get_database)) -> AsyncCollection:
        return db[collection]

    return get_collection
